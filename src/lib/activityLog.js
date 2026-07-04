import { ProjectActivity } from '@/api/entities';

// Best-effort activity logging for the project activity feed. Writes a row to the
// shared project_activity table. Never throws — a logging failure must never break
// the user action that triggered it (mirrors the auditLog.js / storage removeFile()
// best-effort pattern).
//
//   projectId   owning project id (required — project_activity.project_id is NOT NULL)
//   entityType  'project' | 'document' | 'rfi'
//   entityId    id of the document/rfi this event relates to (null for project-level events)
//   eventType   short machine key, e.g. 'project_created' | 'document_uploaded' | 'rfi_response'
//   user        the acting user ({ full_name, email })
//   description human-readable summary shown in the activity feed
//   metadata    optional extra structured data (jsonb)
//
// Note: this is a separate helper from src/lib/auditLog.js (which writes to the
// audit_logs table for the per-document history view). That helper is left untouched.
// Document call sites dual-write: they call logDocumentEvent(...) for the existing
// per-document audit history AND logProjectActivity(...) for the new project-wide
// activity feed, since the two tables serve different UIs and keeping the helpers
// single-purpose is simpler than teaching auditLog.js about project_activity.
export async function logProjectActivity({
  projectId,
  entityType,
  entityId = null,
  eventType,
  user,
  description,
  metadata = {},
}) {
  try {
    await ProjectActivity.create({
      project_id: projectId,
      entity_type: entityType,
      entity_id: entityId,
      event_type: eventType,
      actor_name: user?.full_name || user?.email || 'System',
      actor_email: user?.email || '',
      description,
      metadata,
      occurred_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('[activityLog] project activity not recorded:', eventType, e?.message || e);
  }
}
