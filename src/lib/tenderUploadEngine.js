import { uploadFile } from '@/api/supabaseClient';
/**
 * Tender Document Package Upload Engine
 *
 * Phases implemented:
 *   2 – Drag & drop via webkitGetAsEntry / walkEntry
 *   4 – extractUploadPackage (unified pipeline for both inputs)
 *   5 – createFolders (shortest-path-first, deduplication)
 *   6 – runBatchUpload (CONCURRENT_UPLOADS = 5, Promise.all batches)
 *   7 – uploadWithRetry (maxRetries=3, delays 1s/2s/4s)
 *   8 – findDuplicates + per-file action (version / skip / replace)
 */

import { Folder } from '@/api/entities';

export const ALLOWED_EXTS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'dwg', 'dxf', 'png', 'jpg', 'jpeg', 'zip'];
const CONCURRENT_UPLOADS = 5;

function getExt(name) {
  return (name || '').split('.').pop()?.toLowerCase() || '';
}

// ---------------------------------------------------------------------------
// Phase 2 – walkEntry
// Recursively walks a FileSystemEntry (drag & drop) and returns
// [{ file: File, relativePath: string }] with full path preserved.
// Handles readEntries() batching (browsers cap at 100 entries per call).
// ---------------------------------------------------------------------------
export async function walkEntry(entry, currentPath = '') {
  const results = [];

  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    const relativePath = currentPath ? `${currentPath}/${file.name}` : file.name;
    results.push({ file, relativePath });
  } else if (entry.isDirectory) {
    const dirPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
    const reader = entry.createReader();
    const allEntries = [];
    let batch;
    // Must loop until readEntries returns empty array (browser batches at 100)
    do {
      batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      allEntries.push(...batch);
    } while (batch.length > 0);

    for (const child of allEntries) {
      const childResults = await walkEntry(child, dirPath);
      results.push(...childResults);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Phase 4 – extractUploadPackage
// Unified normalizer. Accepts [{ file, relativePath }] from either
// walkEntry (drag-drop) or webkitRelativePath (folder picker).
// Returns { folders: string[], files: [{ file, relativePath }] }
// Folders are sorted shortest-path-first so parents are created before children.
// ---------------------------------------------------------------------------
export function extractUploadPackage(filesWithRelPaths) {
  // Filter to allowed extensions only
  const allowed = filesWithRelPaths.filter(({ file }) => ALLOWED_EXTS.includes(getExt(file.name)));

  const folderSet = new Set();
  for (const { relativePath } of allowed) {
    const parts = relativePath.split('/');
    // Collect every ancestor folder path (exclude the file itself = last segment)
    for (let i = 1; i < parts.length; i++) {
      folderSet.add(parts.slice(0, i).join('/'));
    }
  }

  // Sort ascending by depth so parent folders are created before children
  const folders = [...folderSet].sort((a, b) => {
    const diff = a.split('/').length - b.split('/').length;
    return diff !== 0 ? diff : a.localeCompare(b);
  });

  return { folders, files: allowed };
}

// ---------------------------------------------------------------------------
// Phase 8 – findDuplicates
// Returns array of relativePaths that already exist in existingDocs.
// Check key: folder_path + document name (without extension).
// ---------------------------------------------------------------------------
export function findDuplicates(files, existingDocs) {
  const duplicates = [];
  for (const { file, relativePath } of files) {
    const parts = relativePath.split('/');
    const fileName = parts[parts.length - 1];
    const docName = fileName.replace(/\.[^.]+$/, '');
    const folderPath = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    const isDup = (existingDocs || []).some(
      d => d.name === docName && (d.folder_path || '') === folderPath
    );
    if (isDup) duplicates.push(relativePath);
  }
  return duplicates;
}

// ---------------------------------------------------------------------------
// Phase 5 – createFolders
// Fetches existing Folder records for tender to build initial folderMap,
// then creates only missing folders in order (parents first).
// Returns folderMap: { fullPath -> folderId }
// ---------------------------------------------------------------------------
export async function createFolders(folders, tenderId, onProgress) {
  // Fetch existing folders to avoid duplicates
  const existingFolders = await Folder.filter({ tender_id: tenderId });
  const folderMap = {};
  for (const f of existingFolders) {
    folderMap[f.full_path] = f.id;
  }

  let created = 0;
  for (const fullPath of folders) {
    if (folderMap[fullPath]) continue; // already exists — skip

    const parts = fullPath.split('/');
    const name = parts[parts.length - 1];
    const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : null;
    const parent_folder_id = parentPath ? (folderMap[parentPath] || null) : null;

    const newFolder = await Folder.create({
      name,
      full_path: fullPath,
      tender_id: tenderId,
      parent_folder_id,
    });

    folderMap[fullPath] = newFolder.id;
    created++;
    onProgress({ foldersCreated: created });
  }

  return folderMap;
}

// ---------------------------------------------------------------------------
// Phase 7 – uploadWithRetry
// maxRetries = 3 → up to 4 total attempts.
// Retry delays: 1s, 2s, 4s (exponential backoff).
// Throws after all retries exhausted.
// ---------------------------------------------------------------------------
async function uploadWithRetry(file, maxRetries = 3) {
  const delays = [1000, 2000, 4000];
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Tender documents are downloaded by unauthenticated suppliers on the public
      // portal — keep them in the public Documents bucket (permanent public URL).
      const { file_url } = await uploadFile(file, 'Documents');
      return file_url;
    } catch (err) {
      lastErr = err;
      // Unreadable-from-disk failures (long Windows paths, unsynced OneDrive
      // placeholders) can never succeed on retry — surface them immediately.
      if (err?.unreadableFile) throw err;
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, delays[attempt]));
      }
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Phase 6 – runBatchUpload
// Processes files in batches of CONCURRENT_UPLOADS using Promise.all.
// Each file uses uploadWithRetry. Failures are collected but do NOT
// abort the batch — processing continues (Phase 10).
//
// duplicateAction: 'version' | 'skip' | 'replace'
//   version → append _v2, _v3, ... to the document name
//   skip    → count as processed, do not upload
//   replace → upload with same name (caller removes old doc when saving)
//
// onProgress({ uploaded, failedCount, current })
// Returns { successDocs, failedFiles }
// ---------------------------------------------------------------------------
export async function runBatchUpload({
  files,
  folderMap,
  tenderId,
  batchId,
  duplicateAction,
  existingDocs,
  onProgress,
  category,
}) {
  const successDocs = [];
  const failedFiles = [];
  let uploaded = 0;

  // Pre-resolve duplicate strategy for every file
  const resolved = files.map(({ file, relativePath }) => {
    const parts = relativePath.split('/');
    const fileName = parts[parts.length - 1];
    const docName = fileName.replace(/\.[^.]+$/, '');
    const folderPath = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    const existing = (existingDocs || []).find(
      d => d.name === docName && (d.folder_path || '') === folderPath
    );
    return { file, relativePath, fileName, docName, folderPath, existing };
  });

  async function processOne({ file, relativePath, fileName, docName, folderPath, existing }) {
    onProgress({ current: fileName });

    // Skip duplicates when action is 'skip'
    if (existing && duplicateAction === 'skip') {
      uploaded++;
      onProgress({ uploaded, failedCount: failedFiles.length });
      return;
    }

    // Determine final document name
    let finalName = docName;
    if (existing && duplicateAction === 'version') {
      let v = 2;
      while ((existingDocs || []).some(
        d => d.name === `${docName}_v${v}` && (d.folder_path || '') === folderPath
      )) {
        v++;
      }
      finalName = `${docName}_v${v}`;
    }

    try {
      const fileUrl = await uploadWithRetry(file);
      const folderId = folderMap[folderPath] || null;

      successDocs.push({
        name: finalName,
        file_url: fileUrl,
        file_type: (fileName.split('.').pop() || 'File').toUpperCase(),
        category: category || 'Other',
        folder_path: folderPath,
        relative_path: relativePath,
        folder_id: folderId,
        upload_batch_id: batchId,
        uploaded_at: new Date().toISOString(),
      });

      uploaded++;
      onProgress({ uploaded, failedCount: failedFiles.length, current: fileName });
    } catch (err) {
      failedFiles.push({ file, relativePath, error: err.message });
      uploaded++;
      onProgress({ uploaded, failedCount: failedFiles.length, current: fileName });
    }
  }

  // Process in batches of CONCURRENT_UPLOADS — no sequential awaiting per file
  for (let i = 0; i < resolved.length; i += CONCURRENT_UPLOADS) {
    const batch = resolved.slice(i, i + CONCURRENT_UPLOADS);
    await Promise.all(batch.map(item => processOne(item)));
  }

  return { successDocs, failedFiles };
}