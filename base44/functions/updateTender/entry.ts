import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * updateTender — service-role update for Tender entity.
 * Bypasses RLS so records created via service role (createTender) can also be updated.
 *
 * Payload: { tenderId: string, data: object }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only admin or pricing roles can update tenders
    if (!['admin', 'pricing'].includes(user.role)) {
      return Response.json({ error: 'Forbidden: insufficient role' }, { status: 403 });
    }

    const { tenderId, data } = await req.json();

    if (!tenderId) {
      return Response.json({ error: 'tenderId is required' }, { status: 400 });
    }
    if (!data || typeof data !== 'object') {
      return Response.json({ error: 'data is required' }, { status: 400 });
    }

    const { _delete, ...updateData } = data;

    if (_delete) {
      await base44.asServiceRole.entities.Tender.delete(tenderId);
      return Response.json({ success: true, deleted: true });
    }

    const updated = await base44.asServiceRole.entities.Tender.update(tenderId, updateData);

    return Response.json({ success: true, tender: updated });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});