import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * createTender
 * Uses asServiceRole to bypass RLS, but enforces role check server-side.
 * Fixes: admin/pricing users blocked by RLS when creating tenders.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!['admin', 'pricing'].includes(user.role)) {
      return Response.json({ error: 'Forbidden: admin or pricing role required' }, { status: 403 });
    }

    // Use service role to bypass RLS for creation
    const existing = await base44.asServiceRole.entities.Tender.list('-created_date', 500);
    const nums = existing
      .map(t => parseInt((t.tender_number || '').replace(/\D/g, ''), 10))
      .filter(n => !isNaN(n));
    const nextNum = nums.length > 0 ? Math.max(...nums) + 1 : 1;
    const tenderNumber = `TDR-${String(nextNum).padStart(3, '0')}`;

    const created = await base44.asServiceRole.entities.Tender.create({
      title: 'New Tender',
      status: 'Draft',
      tender_number: tenderNumber,
      created_by_email: user.email,
      scoring_criteria: [
        { criterion: 'Price',       weight_percent: 40 },
        { criterion: 'Experience',  weight_percent: 20 },
        { criterion: 'Programme',   weight_percent: 15 },
        { criterion: 'Methodology', weight_percent: 15 },
        { criterion: 'Compliance',  weight_percent: 10 },
      ],
    });

    // Handle duplicate number edge case
    const all = await base44.asServiceRole.entities.Tender.list('-created_date', 500);
    const dupes = all.filter(t => t.tender_number === tenderNumber && t.id !== created.id);
    if (dupes.length > 0) {
      const suffix = String.fromCharCode(65 + dupes.length);
      await base44.asServiceRole.entities.Tender.update(created.id, {
        tender_number: `${tenderNumber}${suffix}`,
      });
      created.tender_number = `${tenderNumber}${suffix}`;
    }

    console.log(`[createTender] Created tender ${created.tender_number} id=${created.id} by=${user.email}`);
    return Response.json({ tender: created });

  } catch (error) {
    console.error('[createTender] ERROR:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});