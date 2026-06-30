import { AuditLog } from '@/api/entities';

// Best-effort audit logging for document events. Writes a row to the shared audit_logs
// table (entity_type 'document'). Never throws — an audit failure must not break the
// user action that triggered it (mirrors the storage removeFile() best-effort pattern).
//
//   action      short machine key, e.g. 'document.uploaded' | 'document.status_changed'
//   document    the document row (needs id; name used in the description)
//   projectId   owning project id
//   user        the acting user ({ id, full_name, email })
//   description human-readable summary shown in the history view
export async function logDocumentEvent({ action, document, projectId, user, description }) {
  try {
    await AuditLog.create({
      action,
      entity_type: 'document',
      entity_id: document?.id ?? null,
      project_id: projectId ?? null,
      user_id: user?.id ?? null,
      user_name: user?.full_name || user?.email || 'Unknown',
      description: description || '',
    });
  } catch (e) {
    console.warn('[auditLog] document event not recorded:', action, e?.message || e);
  }
}
