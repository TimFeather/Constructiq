-- Add a second, invitee-visible closing date: "THS RFT closing date".
-- Sits alongside the existing `closing_date` (which stays the primary
-- tender-portal closing datetime). Both are shown to invitees.
alter table public.tenders
  add column if not exists ths_rft_closing_date date;
