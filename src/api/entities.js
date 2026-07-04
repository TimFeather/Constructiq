/**
 * entities.js
 *
 * Drop-in replacement for base44.entities.X calls.
 * Each entity exposes: list(), filter(match), get(id), create(data), update(id, data), delete(id)
 *
 * Usage (same pattern as before, just different import):
 *   import { Project } from '@/api/entities';
 *   const projects = await Project.list();
 *   const project = await Project.get(id);
 *   await Project.create({ name: 'New Project' });
 *   await Project.update(id, { status: 'Complete' });
 *   await Project.delete(id);
 */

import { supabase } from '@/api/supabaseClient';

function entity(table) {
  return {
    async list(sortField, limit) {
      const col = sortField ? sortField.replace(/^-/, '') : 'created_at';
      const ascending = sortField ? !sortField.startsWith('-') : false;
      let query = supabase.from(table).select('*').order(col, { ascending });
      if (limit) query = query.limit(limit);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },

    async filter(match, sortField, limit) {
      let query = supabase.from(table).select('*');
      Object.entries(match).forEach(([key, value]) => {
        query = query.eq(key, value);
      });
      const col = sortField ? sortField.replace(/^-/, '') : 'created_at';
      const ascending = sortField ? !sortField.startsWith('-') : false;
      query = query.order(col, { ascending });
      if (limit) query = query.limit(limit);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },

    async get(id) {
      const { data, error } = await supabase.from(table).select('*').eq('id', id).single();
      if (error) throw error;
      return data;
    },

    async create(payload) {
      const { data, error } = await supabase.from(table).insert(payload).select();
      if (error) throw error;
      return data?.[0] ?? null;
    },

    async bulkCreate(payloads) {
      const { data, error } = await supabase.from(table).insert(payloads).select();
      if (error) throw error;
      return data;
    },

    async update(id, payload) {
      const { data, error } = await supabase.from(table).update(payload).eq('id', id).select();
      if (error) throw error;
      return data?.[0] ?? null;
    },

    async delete(id) {
      const { error } = await supabase.from(table).delete().eq('id', id);
      if (error) throw error;
      return { success: true };
    },
  };
}

export const User                      = entity('users');
export const Project                   = entity('projects');
export const Task                      = entity('tasks');
export const RFI                       = entity('rfis');
export const Document                  = entity('documents');
export const Folder                    = entity('folders');
export const Tender                    = entity('tenders');
export const TenderInvitee             = entity('tender_invitees');
export const TenderInvitation          = entity('tender_invitations');
export const TenderSubmission          = entity('tender_submissions');
export const TenderActivity            = entity('tender_activity');
export const TenderContact             = entity('tender_contacts');
export const TenderCounter             = entity('tender_counter');
export const TenderSettings            = entity('tender_settings');
export const InvitedUser               = entity('invited_users');
export const PendingProjectAssignment  = entity('pending_project_assignments');
export const ProjectRole               = entity('project_roles');
export const AuditLog                  = entity('audit_logs');
export const EmailBranding             = entity('email_branding');
export const TenderNotice              = entity('tender_notices');
export const TenderNoticeAttachment    = entity('tender_notice_attachments');
export const ContractInstruction       = entity('contract_instructions');
export const EmailTemplate             = entity('email_templates');
export const DocumentFolderTemplate    = entity('document_folder_templates');
export const TradeTemplate             = entity('trade_templates');
export const TenderRFI                 = entity('tender_rfis');
export const TenderRFIResponse         = entity('tender_rfi_responses');
export const Programme                 = entity('programmes');
export const TaskDependency            = entity('task_dependencies');
export const TaskBaseline              = entity('task_baselines');
export const TaskBaselineItem          = entity('task_baseline_items');
export const TaskProgressLog           = entity('task_progress_log');
export const TaskChangeLog             = entity('task_change_log');
