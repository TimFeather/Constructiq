-- ════════════════════════════════════════════════════════════════════
-- Migration 015 — publish_programme: create the programmes row if
-- missing, instead of erroring.
--
-- A project's tasks are created independently of the `programmes`
-- header row (data_date/calendar/status) — that row is only created
-- when someone saves Schedule Settings (see upsertProgramme in
-- src/api/programmeData.js). So a project can have a full schedule of
-- tasks but no `programmes` row yet, and publish_programme's plain
-- UPDATE would match zero rows and raise "No programme exists for
-- this project yet" even though the programme (the tasks) very much
-- exists. Switch to insert-or-update so Publish always works once
-- there's a project to publish for.
--
-- Safe to run once on the live database via the Supabase SQL Editor.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.publish_programme(p_project_id uuid)
returns public.programmes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := get_my_role();
  v_row  public.programmes;
begin
  if v_role not in ('admin','internal','pricing') then
    raise exception 'Only admin, internal or pricing users may publish a programme';
  end if;

  insert into public.programmes (project_id, status, published_at, published_by_id, created_by_id)
  values (p_project_id, 'published', now(), auth.uid(), auth.uid())
  on conflict (project_id) do update
    set status          = 'published',
        published_at    = now(),
        published_by_id = auth.uid(),
        updated_at      = now()
  returning * into v_row;

  return v_row;
end;
$$;
grant execute on function public.publish_programme(uuid) to authenticated, service_role;

-- ============================================================
-- Verification (run after applying):
--
-- -- as admin/internal/pricing, on a project whose programmes row was
-- -- never created (no Schedule Settings save yet), this should now
-- -- succeed and create the row:
-- -- select public.publish_programme('<project_id_with_no_programmes_row>');
-- ============================================================
