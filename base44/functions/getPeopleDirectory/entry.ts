import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const users = await base44.asServiceRole.entities.User.list();

    const directory = users.map(u => {
      // Custom profile fields are stored at the top level on the User auth record
      // u.data holds only entity-level overrides (e.g. disabled flag)
      const entityData = u.data || {};
      return {
        id: u.id,
        email: u.email,
        role: u.role || 'external',
        disabled: entityData.disabled === true || u.disabled === true || false,
        first_name: u.first_name || '',
        last_name: u.last_name || '',
        phone: u.phone || '',
        business_name: u.business_name || '',
        full_name: u.full_name || '',
      };
    });

    return Response.json({ users: directory });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});