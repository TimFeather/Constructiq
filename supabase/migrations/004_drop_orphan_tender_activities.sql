-- ============================================================
-- Migration 004 — Drop orphan tender_activities (plural)
-- Run in Supabase SQL Editor.
--
-- The app reads/writes tender_activity (SINGULAR) everywhere
-- (entities.js, all edge functions, TenderDetail). tender_activities
-- (plural) is a dead leftover with no code path. Verified empty
-- (count = 0) on 2026-06-28 before dropping. CASCADE clears its
-- RLS policies too.
-- ============================================================

drop table if exists public.tender_activities cascade;
