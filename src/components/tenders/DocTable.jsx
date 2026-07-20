import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Download, Trash2, FolderOpen, FolderClosed, ChevronRight, ChevronDown, Eye, FolderInput } from 'lucide-react';
import { format } from 'date-fns';

const CATEGORIES = ['Plans', 'Specifications', 'Bill of Quantities', 'Schedule', 'Contract', 'Other'];
const PREVIEWABLE_RE = /\.(pdf|png|jpe?g|gif|webp|svg)$/i;

const FILE_ICONS = {
  pdf: '📄', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊',
  png: '🖼', jpg: '🖼', jpeg: '🖼', dwg: '📐', dxf: '📐', zip: '🗜',
};

function getExt(name) {
  return (name || '').split('.').pop()?.toLowerCase() || '';
}

/**
 * Build a recursive tree from flat docs with folder_path strings.
 * folder_path examples: '', 'Tender Package/', 'Tender Package/Architectural/'
 *
 * Tree nodes: { name, files: [{doc, idx}], children: Map<name, node> }
 */
function buildTree(docs) {
  const root = { name: '', files: [], children: new Map() };

  docs.forEach((doc, idx) => {
    // Normalise: strip trailing slash, split by /
    const fp = (doc.folder_path || '').replace(/\/+$/, '');

    if (!fp) {
      root.files.push({ doc, idx });
      return;
    }

    const parts = fp.split('/').filter(Boolean);
    let node = root;
    for (const part of parts) {
      if (!node.children.has(part)) {
        node.children.set(part, { name: part, files: [], children: new Map() });
      }
      node = node.children.get(part);
    }
    node.files.push({ doc, idx });
  });

  return root;
}

function DocRow({ doc, idx, canManage, onCategoryChange, onDelete, onPreview, onMove, folderPaths, depth }) {
  const isPreviewable = PREVIEWABLE_RE.test(doc.name || '') || PREVIEWABLE_RE.test(doc.file_url || '');
  const currentFolder = doc.folder_path || '';

  return (
    <tr className="hover:bg-muted/30 transition-colors">
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2" style={{ paddingLeft: `${depth * 20}px` }}>
          <span className="text-sm">{FILE_ICONS[getExt(doc.name)] || '📎'}</span>
          <span className="font-medium text-sm break-words max-w-[280px]" title={doc.name}>{doc.name}</span>
        </div>
      </td>
      <td className="px-4 py-2.5">
        {canManage ? (
          <Select value={doc.category || 'Other'} onValueChange={v => onCategoryChange(idx, v)}>
            <SelectTrigger className="h-7 text-xs w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-xs text-muted-foreground">{doc.category || 'Other'}</span>
        )}
      </td>
      <td className="px-4 py-2.5 hidden sm:table-cell">
        <span className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
          {doc.file_type || getExt(doc.name).toUpperCase()}
        </span>
      </td>
      <td className="px-4 py-2.5 hidden md:table-cell">
        <span className="text-xs text-muted-foreground">
          {doc.uploaded_at ? format(new Date(doc.uploaded_at), 'dd MMM yyyy') : '—'}
        </span>
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1 justify-end">
          {isPreviewable && (
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Preview"
              onClick={() => onPreview(doc)}>
              <Eye className="w-3.5 h-3.5" />
            </Button>
          )}
          <a href={doc.file_url} target="_blank" rel="noopener noreferrer">
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Download">
              <Download className="w-3.5 h-3.5" />
            </Button>
          </a>
          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" title="Move to…">
                  <FolderInput className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {folderPaths.map(({ path, label }) => (
                  <DropdownMenuItem
                    key={path}
                    disabled={path === currentFolder}
                    onClick={() => onMove(idx, path)}
                  >
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {canManage && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
              onClick={() => onDelete(idx)}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

function countAllFiles(node) {
  let n = node.files.length;
  for (const child of node.children.values()) n += countAllFiles(child);
  return n;
}

function FolderNode({ node, depth, canManage, onCategoryChange, onDelete, onPreview, onMove, folderPaths }) {
  const [open, setOpen] = useState(true);
  const total = countAllFiles(node);
  const childKeys = [...node.children.keys()].sort();

  return (
    <>
      {/* Folder header row */}
      <tr className="bg-muted/30 border-b border-border/20">
        <td colSpan={5} className="py-1">
          <button
            className="flex items-center gap-1.5 w-full text-left text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors px-4"
            style={{ paddingLeft: `${depth * 20 + 16}px` }}
            onClick={() => setOpen(o => !o)}
          >
            {open
              ? <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
              : <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />}
            {open
              ? <FolderOpen className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
              : <FolderClosed className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />}
            <span>{node.name}</span>
            <span className="font-normal text-muted-foreground/60 ml-1">({total})</span>
          </button>
        </td>
      </tr>

      {open && (
        <>
          {/* Direct files in this folder */}
          {node.files.map(({ doc, idx }) => (
            <DocRow
              key={idx}
              doc={doc}
              idx={idx}
              depth={depth + 1}
              canManage={canManage}
              onCategoryChange={onCategoryChange}
              onDelete={onDelete}
              onPreview={onPreview}
              onMove={onMove}
              folderPaths={folderPaths}
            />
          ))}
          {/* Sub-folders */}
          {childKeys.map(key => (
            <FolderNode
              key={key}
              node={node.children.get(key)}
              depth={depth + 1}
              canManage={canManage}
              onCategoryChange={onCategoryChange}
              onDelete={onDelete}
              onPreview={onPreview}
              onMove={onMove}
              folderPaths={folderPaths}
            />
          ))}
        </>
      )}
    </>
  );
}

// Build the "Move to…" option list: every distinct folder_path present in
// this tender's documents, plus root. Used identically for every row so the
// destination set always reflects the tender's current folder structure.
function buildFolderPathOptions(docs) {
  const paths = new Set();
  docs.forEach(d => {
    const fp = (d.folder_path || '').replace(/\/+$/, '');
    if (!fp) return;
    // Include every ancestor too, so nested folders are reachable even if no
    // file lives directly at the intermediate level.
    const parts = fp.split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i++) paths.add(parts.slice(0, i).join('/'));
  });
  const sorted = [...paths].sort();
  return [
    { path: '', label: 'Root (no folder)' },
    ...sorted.map(p => ({ path: p, label: p })),
  ];
}

export default function DocTable({ docs, canManage, onCategoryChange, onDelete, onPreview, onMove }) {
  const tree = buildTree(docs);
  const folderKeys = [...tree.children.keys()].sort();
  const folderPaths = buildFolderPathOptions(docs);

  return (
    <div className="border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase">Name</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase w-44">Category</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase w-20 hidden sm:table-cell">Type</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase w-28 hidden md:table-cell">Uploaded</th>
            <th className="w-20"></th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {/* Root-level files (no folder) */}
          {tree.files.map(({ doc, idx }) => (
            <DocRow
              key={idx}
              doc={doc}
              idx={idx}
              depth={0}
              canManage={canManage}
              onCategoryChange={onCategoryChange}
              onDelete={onDelete}
              onPreview={onPreview}
              onMove={onMove}
              folderPaths={folderPaths}
            />
          ))}
          {/* Folder tree */}
          {folderKeys.map(key => (
            <FolderNode
              key={key}
              node={tree.children.get(key)}
              depth={0}
              canManage={canManage}
              onCategoryChange={onCategoryChange}
              onDelete={onDelete}
              onPreview={onPreview}
              onMove={onMove}
              folderPaths={folderPaths}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}