/**
 * upsertTenderContact
 *
 * Shared write-back into the tender_contacts master directory. Used whenever a
 * person is added to a project team (TeamManager / ProjectSubcontractors) so
 * they also show up as a suggestion in InviteeManager's tender invitee search,
 * and vice versa. Matches by email first, falling back to full_name+business_name
 * when no email is given. Non-fatal — callers should not let this block the
 * primary action if it fails.
 */
export async function upsertTenderContact(
  admin: any,
  { fullName, businessName, email, phone, trade }: {
    fullName: string;
    businessName?: string;
    email?: string;
    phone?: string;
    trade?: string;
  },
): Promise<string | null> {
  if (!fullName) return null;
  try {
    const { data: contactRows } = await admin
      .from('tender_contacts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1000);
    const contacts: any[] = contactRows ?? [];
    const emailLower = email?.toLowerCase();
    const contact = emailLower
      ? contacts.find((c: any) => c.email?.toLowerCase() === emailLower)
      : contacts.find((c: any) =>
          c.full_name?.toLowerCase() === fullName.toLowerCase() &&
          c.business_name?.toLowerCase() === (businessName || '').toLowerCase()
        );

    if (contact) {
      await admin.from('tender_contacts').update({
        full_name:     fullName,
        business_name: businessName || contact.business_name || '',
        phone:         phone        || contact.phone         || '',
        trade:         trade        || contact.trade         || '',
      }).eq('id', contact.id);
      return contact.id;
    }

    const { data: created } = await admin
      .from('tender_contacts')
      .insert({
        full_name:     fullName,
        business_name: businessName || '',
        email:         email        || '',
        phone:         phone        || '',
        trade:         trade        || '',
      })
      .select()
      .single();
    return created?.id ?? null;
  } catch (_e) {
    return null;
  }
}
