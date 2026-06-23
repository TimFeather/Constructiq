-- ============================================================
-- ConstructIQ — Test Data Seed
-- Run in Supabase SQL Editor (runs as postgres, bypasses RLS)
-- Safe to re-run — uses DO blocks with conflict handling
-- ============================================================

DO $$
DECLARE
  admin_id       uuid;
  proj_id        uuid := gen_random_uuid();
  proj2_id       uuid := gen_random_uuid();
  tender_id      uuid := gen_random_uuid();
  tender2_id     uuid := gen_random_uuid();
  ntt1_id        uuid := gen_random_uuid();
  ntt2_id        uuid := gen_random_uuid();
  ci1_id         uuid := gen_random_uuid();
  ci2_id         uuid := gen_random_uuid();
  ci3_id         uuid := gen_random_uuid();
  rfi1_id        uuid := gen_random_uuid();
  rfi2_id        uuid := gen_random_uuid();
  rfi3_id        uuid := gen_random_uuid();
BEGIN

  -- Get the admin user id
  SELECT id INTO admin_id FROM public.users WHERE role = 'admin' LIMIT 1;

  IF admin_id IS NULL THEN
    RAISE EXCEPTION 'No admin user found. Make sure you have logged in at least once.';
  END IF;

  -- ──────────────────────────────────────────────────────────
  -- PROJECTS
  -- ──────────────────────────────────────────────────────────

  INSERT INTO public.projects (id, name, description, status, start_date, end_date, created_by_id, team)
  VALUES (
    proj_id,
    'Thorndon Community Centre Renovation',
    'Full internal refurbishment of the Thorndon Community Centre including new HVAC, electrical upgrades, and interior fitout across 3 levels.',
    'Active',
    '2026-04-01',
    '2026-11-30',
    admin_id,
    jsonb_build_array(
      jsonb_build_object(
        'user_email', 'sarah.pm@constructiq.co.nz',
        'full_name',  'Sarah Mitchell',
        'role',       'Project Manager',
        'trade',      '',
        'business_name', 'Total Home Solutions'
      ),
      jsonb_build_object(
        'user_email', 'james.site@constructiq.co.nz',
        'full_name',  'James Tūhoe',
        'role',       'Site Manager',
        'trade',      '',
        'business_name', 'Total Home Solutions'
      ),
      jsonb_build_object(
        'user_email', 'dean@kiwispark.co.nz',
        'full_name',  'Dean Parata',
        'role',       'Subcontractor',
        'trade',      'Electrical',
        'business_name', 'KiwiSpark Electrical Ltd'
      ),
      jsonb_build_object(
        'user_email', 'mike@alpineplumb.co.nz',
        'full_name',  'Mike Ōrbell',
        'role',       'Subcontractor',
        'trade',      'Plumbing & Mechanical',
        'business_name', 'Alpine Plumbing & Mechanical'
      ),
      jsonb_build_object(
        'user_email', 'rachel@southernframes.co.nz',
        'full_name',  'Rachel Ngāti',
        'role',       'Subcontractor',
        'trade',      'Carpentry',
        'business_name', 'Southern Frames & Joinery'
      )
    )
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.projects (id, name, description, status, start_date, end_date, created_by_id, team)
  VALUES (
    proj2_id,
    'Hutt Valley Childcare Centre — New Build',
    'Design and construct a new single-storey childcare centre for 60 children on Council-owned land in Naenae.',
    'On Hold',
    '2026-07-01',
    '2027-03-31',
    admin_id,
    jsonb_build_array(
      jsonb_build_object(
        'user_email', 'sarah.pm@constructiq.co.nz',
        'full_name',  'Sarah Mitchell',
        'role',       'Project Manager',
        'trade',      '',
        'business_name', 'Total Home Solutions'
      )
    )
  )
  ON CONFLICT (id) DO NOTHING;

  -- ──────────────────────────────────────────────────────────
  -- CONTRACT INSTRUCTIONS (for proj_id)
  -- ──────────────────────────────────────────────────────────

  INSERT INTO public.contract_instructions
    (id, project_id, ci_number, title, description, instruction_type, status, issue_date, issued_by, attachments)
  VALUES
  (
    ci1_id, proj_id, 'CI-001',
    'Approved Variation — Additional Lighting in Level 2 Corridor',
    'The client has approved a variation to install 12 additional LED downlights in the Level 2 east corridor as per the revised electrical plan ref E-L2-007 Rev C. Variation value: $4,850 + GST. Proceed immediately.',
    'Variation Approval',
    'Issued',
    now() - interval '14 days',
    'Sarah Mitchell',
    '[]'
  ),
  (
    ci2_id, proj_id, 'CI-002',
    'Direction — Revise Acoustic Treatment in Meeting Rooms 3 & 4',
    'Following acoustic testing on 10 June 2026, the specified acoustic panels are insufficient. Contractor is directed to replace with Autex Quietspace Panel 25mm in all wall positions as shown on drawing A-MR-003. No variation in value.',
    'Direction',
    'Issued',
    now() - interval '7 days',
    'Sarah Mitchell',
    '[]'
  ),
  (
    ci3_id, proj_id, 'CI-003',
    'Scope Change — Inclusion of Level 1 Breakout Space',
    'Client has requested inclusion of new breakout space on Level 1 (approx 45m²) not in the original scope. Contractor to submit pricing within 5 working days. Do not proceed until variation is formally approved.',
    'Scope Change',
    'Draft',
    NULL,
    NULL,
    '[]'
  )
  ON CONFLICT (id) DO NOTHING;

  -- ──────────────────────────────────────────────────────────
  -- RFIs (for proj_id)
  -- ──────────────────────────────────────────────────────────

  INSERT INTO public.rfis
    (id, number, title, description, project_id, status, priority, due_date,
     created_by_email, created_by_name, assigned_to_email, assigned_to_name, created_by_id)
  VALUES
  (
    rfi1_id, 1,
    'Confirm slab thickness at Grid C/3 penetration',
    'The structural drawings show 175mm slab at Grid C/3 but the services drawings show a 300mm penetration sleeve. Please confirm actual slab thickness and whether a lintel is required.',
    proj_id, 'Open', 'High',
    (CURRENT_DATE + interval '3 days')::date,
    'james.site@constructiq.co.nz', 'James Tūhoe',
    'sarah.pm@constructiq.co.nz', 'Sarah Mitchell',
    admin_id
  ),
  (
    rfi2_id, 2,
    'Tile selection — Toilets Level 1 and Level 2',
    'Specification references "Tile Option B from Approved Palette" but no palette has been issued. Please provide the approved tile schedule for all wet areas so procurement can proceed.',
    proj_id, 'Open', 'Medium',
    (CURRENT_DATE + interval '7 days')::date,
    'james.site@constructiq.co.nz', 'James Tūhoe',
    'sarah.pm@constructiq.co.nz', 'Sarah Mitchell',
    admin_id
  ),
  (
    rfi3_id, 3,
    'Fire rating clarification — Level 2 partition wall between Rooms 201 and 202',
    'Drawing A-L2-001 shows FRR 60/60/60 but the fire engineer report (Section 4.2) states FRR 30/30/30 is sufficient. Which rating applies? Contractor has paused framing pending clarification.',
    proj_id, 'Answered', 'Critical',
    (CURRENT_DATE - interval '2 days')::date,
    'dean@kiwispark.co.nz', 'Dean Parata',
    'sarah.pm@constructiq.co.nz', 'Sarah Mitchell',
    admin_id
  )
  ON CONFLICT (id) DO NOTHING;

  -- ──────────────────────────────────────────────────────────
  -- TENDER 1 — Open tender with invitees and NTTs
  -- ──────────────────────────────────────────────────────────

  INSERT INTO public.tenders (
    id, tender_number, title, description, status,
    issue_date, closing_date, site_visit_date, questions_date,
    estimated_value, location,
    client_name, client_contact, client_email,
    created_by_id, created_by_name,
    trade_packages,
    documents,
    notes
  ) VALUES (
    tender_id,
    'TDR-2026-007',
    'Commercial Office Fitout — Level 3, 120 Queen Street',
    'Fitout of approximately 850m² of commercial office space on Level 3. Works include new partitioning, ceiling grid, services distribution, kitchen and breakout areas, server room, and full floor finish package.',
    'Issued',
    '2026-06-10',
    '2026-07-11T16:00:00+12:00',
    '2026-06-27',
    '2026-07-04',
    875000,
    '120 Queen Street, Wellington 6011',
    'Wellington Property Holdings Ltd',
    'Aroha Tūhoe',
    'aroha.tuhoe@wph.co.nz',
    admin_id,
    'Tim Blackwell',
    jsonb_build_array(
      jsonb_build_object('name','General Building Works','trade','General Builder'),
      jsonb_build_object('name','Mechanical & Electrical','trade','Services'),
      jsonb_build_object('name','Joinery & Fitout','trade','Joinery')
    ),
    jsonb_build_array(
      jsonb_build_object(
        'name',      'Tender Drawing Package Rev B',
        'file_url',  'https://axrknhdinnjhrjrmwher.supabase.co/storage/v1/object/public/Documents/sample-drawings.pdf',
        'file_type', 'application/pdf',
        'size',      2400000
      ),
      jsonb_build_object(
        'name',      'Specification — Division 09 Finishes',
        'file_url',  'https://axrknhdinnjhrjrmwher.supabase.co/storage/v1/object/public/Documents/sample-spec.pdf',
        'file_type', 'application/pdf',
        'size',      980000
      ),
      jsonb_build_object(
        'name',      'Bill of Quantities — Preliminaries',
        'file_url',  'https://axrknhdinnjhrjrmwher.supabase.co/storage/v1/object/public/Documents/sample-boq.pdf',
        'file_type', 'application/pdf',
        'size',      540000
      )
    ),
    'Three trade packages — tenderers may price one or all. Lump sum pricing required. Site visit attendance is strongly recommended.'
  )
  ON CONFLICT (id) DO NOTHING;

  -- Invitees for tender 1
  INSERT INTO public.tender_invitees (tender_id, full_name, business_name, email, phone, trade, status)
  VALUES
    (tender_id, 'Dean Parata',   'KiwiSpark Electrical Ltd',    'dean@kiwispark.co.nz',       '+64 21 555 0101', 'Electrical',           'Submitted'),
    (tender_id, 'Rachel Ngāti',  'Southern Frames & Joinery',   'rachel@southernframes.co.nz','+64 27 555 0102', 'Carpentry',            'Invited'),
    (tender_id, 'Hemi Walker',   'Walker Construction Ltd',     'hemi@walkerconstruction.co.nz','+64 9 555 0103','General Builder',       'Invited'),
    (tender_id, 'Priya Sharma',  'Prestige Interiors NZ',       'priya@prestigeinteriors.co.nz','+64 21 555 0104','Fitout',              'Declined'),
    (tender_id, 'Craig Bowen',   'Bowen Building Services',     'craig@bowenbuilding.co.nz',  '+64 4 555 0105',  'Mechanical',           'Invited')
  ON CONFLICT DO NOTHING;

  -- NTTs for tender 1
  INSERT INTO public.tender_notices
    (id, tender_id, notice_number, title, description, notice_type, status, issue_date, issued_by)
  VALUES
  (
    ntt1_id, tender_id, 'NTT-001',
    'Clarification — Server Room Cooling Requirements',
    'Several tenderers have asked whether the server room cooling is included in this contract. To clarify: the IT cooling unit (min 3kW capacity) is to be supplied and installed by the successful contractor as part of the Mechanical & Electrical package. Refer to drawing ME-SR-001 Rev A for layout. No change to the tender documents; this NTT is for information only.',
    'Clarification',
    'Issued',
    now() - interval '5 days',
    'Tim Blackwell'
  ),
  (
    ntt2_id, tender_id, 'NTT-002',
    'Revised Documents — Updated Floor Plan Level 3',
    'Drawing A-L3-001 has been revised to Rev C following structural engineer review. The open plan area between Grids D-F / 4-6 has been reconfigured. Tenderers must price from Rev C only. Rev B is superseded and must not be used.',
    'Revised Documents',
    'Draft',
    NULL,
    NULL
  )
  ON CONFLICT (id) DO NOTHING;

  -- ──────────────────────────────────────────────────────────
  -- TENDER 2 — Closed tender (for archive/scoring testing)
  -- ──────────────────────────────────────────────────────────

  INSERT INTO public.tenders (
    id, tender_number, title, description, status,
    issue_date, closing_date,
    estimated_value, location,
    client_name, client_contact, client_email,
    created_by_id, created_by_name,
    trade_packages, documents
  ) VALUES (
    tender2_id,
    'TDR-2026-003',
    'Newlands Warehouse Roof Replacement',
    'Strip and replace 2,200m² of long run steel roofing including penetrations, flashings, gutters and downpipes. Building remains operational throughout.',
    'Closed',
    '2026-05-01',
    '2026-05-30T12:00:00+12:00',
    420000,
    '45 Broken Hill Road, Newlands, Wellington 6037',
    'Newlands Storage Ltd',
    'Barry Hicks',
    'barry@newlandsstorage.co.nz',
    admin_id,
    'Tim Blackwell',
    jsonb_build_array(
      jsonb_build_object('name','Roofing Works','trade','Roofing')
    ),
    jsonb_build_array(
      jsonb_build_object(
        'name',      'Roof Plan & Details',
        'file_url',  'https://axrknhdinnjhrjrmwher.supabase.co/storage/v1/object/public/Documents/sample-drawings.pdf',
        'file_type', 'application/pdf',
        'size',      1200000
      )
    )
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.tender_invitees (tender_id, full_name, business_name, email, phone, trade, status)
  VALUES
    (tender2_id, 'Tony Roofman',  'Capital Roofing Ltd',      'tony@capitalroofing.co.nz',   '+64 4 555 0201', 'Roofing', 'Submitted'),
    (tender2_id, 'Ben Ngatai',    'Pacific Roofing Systems',  'ben@pacificroofing.co.nz',    '+64 21 555 0202', 'Roofing', 'Submitted'),
    (tender2_id, 'Steve Downs',   'Downs Roofing & Cladding', 'steve@downsroofing.co.nz',   '+64 27 555 0203', 'Roofing', 'Declined')
  ON CONFLICT DO NOTHING;

  RAISE NOTICE '✓ Test data seeded successfully.';
  RAISE NOTICE '  Projects:  Thorndon Community Centre (Active), Hutt Valley Childcare (On Hold)';
  RAISE NOTICE '  Tenders:   TDR-2026-007 Office Fitout (Issued), TDR-2026-003 Roof (Closed)';
  RAISE NOTICE '  NTTs:      NTT-001 (Issued), NTT-002 (Draft)';
  RAISE NOTICE '  CIs:       CI-001 (Issued), CI-002 (Issued), CI-003 (Draft)';
  RAISE NOTICE '  RFIs:      3 RFIs on Thorndon Community Centre';

END $$;
