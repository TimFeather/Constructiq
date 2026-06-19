/**
 * repairUserSchema — one-time migration
 * Flattens data.data nesting into data for all User records.
 * Safe to run multiple times (idempotent).
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    const users = await base44.asServiceRole.entities.User.list();
    const repaired = [];
    const clean = [];

    for (const u of users) {
      const d = u.data;
      if (!d || typeof d !== 'object') {
        clean.push({ id: u.id, email: u.email, reason: 'no data field' });
        continue;
      }

      if (d.data && typeof d.data === 'object' && d.data !== null) {
        // Merge: data.data values first (lower priority), then existing top-level keys win
        const merged = { ...d.data, ...d };
        delete merged.data; // remove the nested data key

        await base44.asServiceRole.entities.User.update(u.id, { data: merged });
        repaired.push({ id: u.id, email: u.email, nested_keys: Object.keys(d.data) });
      } else {
        clean.push({ id: u.id, email: u.email });
      }
    }

    return Response.json({
      total_users: users.length,
      repaired_count: repaired.length,
      repaired,
      clean_count: clean.length,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});