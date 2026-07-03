-- ════════════════════════════════════════════════════════════════════
-- Migration 007 — grants for the migration-006 programme tables
--
-- 006 created the tables + RLS policies, but the Supabase API roles
-- were never GRANTed base table privileges, so every request returned
-- 403 "permission denied for table …" before RLS was even evaluated.
-- RLS (from 006) still controls which rows each role can touch.
-- ════════════════════════════════════════════════════════════════════

grant select, insert, update, delete on
  public.programmes,
  public.task_dependencies,
  public.task_baselines,
  public.task_baseline_items,
  public.task_progress_log,
  public.task_change_log
to authenticated;

-- The service role bypasses RLS and needs full access for edge functions.
grant all on
  public.programmes,
  public.task_dependencies,
  public.task_baselines,
  public.task_baseline_items,
  public.task_progress_log,
  public.task_change_log
to service_role;

grant execute on function public.bulk_update_task_schedule(jsonb) to authenticated, service_role;
