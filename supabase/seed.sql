-- CY-021: Seed data for pilot venue in Pamplona, Colombia
-- Includes:
-- 1. Pilot tenant ("CanchaYa Piloto Pamplona", slug "pamplona-piloto", America/Bogota, 60 min slots, 15 min HOLD, 20% deposit).
-- 2. Two sports: padel ("Pádel") and futbol_5 ("Fútbol 5").
-- 3. Four courts: 2 Padel courts + 2 Futbol 5 courts.
-- 4. Base pricing: 60000 COP (integer) per hour and 20% deposit for both sports.
-- 5. Two test accounts (owner and staff) for local/staging verification (no real PII).

BEGIN;

-- =============================================================================
-- 1. Pilot Tenant (Recinto de prueba en Pamplona, Colombia)
-- =============================================================================

INSERT INTO public.tenants (
  id,
  slug,
  name,
  timezone,
  slot_duration_minutes,
  hold_duration_minutes,
  deposit_percent,
  min_reschedule_hours,
  operating_hours,
  is_active
)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  'pamplona-piloto',
  'CanchaYa Piloto Pamplona',
  'America/Bogota',
  60,
  15,
  20,
  4,
  '{
    "monday":    { "open": "14:00", "close": "24:00" },
    "tuesday":   { "open": "14:00", "close": "24:00" },
    "wednesday": { "open": "14:00", "close": "24:00" },
    "thursday":  { "open": "14:00", "close": "24:00" },
    "friday":    { "open": "14:00", "close": "24:00" },
    "saturday":  { "open": "14:00", "close": "24:00" },
    "sunday":    { "open": "14:00", "close": "24:00" }
  }'::jsonb,
  true
)
ON CONFLICT (id) DO UPDATE
SET
  slug = EXCLUDED.slug,
  name = EXCLUDED.name,
  timezone = EXCLUDED.timezone,
  slot_duration_minutes = EXCLUDED.slot_duration_minutes,
  hold_duration_minutes = EXCLUDED.hold_duration_minutes,
  deposit_percent = EXCLUDED.deposit_percent,
  min_reschedule_hours = EXCLUDED.min_reschedule_hours,
  operating_hours = EXCLUDED.operating_hours,
  is_active = EXCLUDED.is_active;

-- =============================================================================
-- 2. Sports (Pádel y Fútbol 5)
-- =============================================================================

INSERT INTO public.sports (id, tenant_id, code, name, is_active)
VALUES
  (
    '22222222-2222-4222-8222-222222222201',
    '11111111-1111-4111-8111-111111111111',
    'padel',
    'Pádel',
    true
  ),
  (
    '22222222-2222-4222-8222-222222222202',
    '11111111-1111-4111-8111-111111111111',
    'futbol_5',
    'Fútbol 5',
    true
  )
ON CONFLICT (tenant_id, code) DO UPDATE
SET
  name = EXCLUDED.name,
  is_active = EXCLUDED.is_active;

-- =============================================================================
-- 3. Courts (4 canchas: 2 de Pádel + 2 de Fútbol 5)
-- =============================================================================

INSERT INTO public.courts (id, tenant_id, sport_id, name, display_order, is_active)
VALUES
  (
    '33333333-3333-4333-8333-333333333301',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222201',
    'Cancha Pádel 1',
    1,
    true
  ),
  (
    '33333333-3333-4333-8333-333333333302',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222201',
    'Cancha Pádel 2',
    2,
    true
  ),
  (
    '33333333-3333-4333-8333-333333333303',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222202',
    'Cancha Fútbol 5 - 1',
    3,
    true
  ),
  (
    '33333333-3333-4333-8333-333333333304',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222202',
    'Cancha Fútbol 5 - 2',
    4,
    true
  )
ON CONFLICT (tenant_id, name) DO UPDATE
SET
  sport_id = EXCLUDED.sport_id,
  display_order = EXCLUDED.display_order,
  is_active = EXCLUDED.is_active;

-- =============================================================================
-- 4. Pricing (Tarifas en COP entero: 60000 COP/hora y anticipo 20%)
-- =============================================================================

INSERT INTO public.pricing (
  id,
  tenant_id,
  sport_id,
  court_id,
  day_of_week,
  start_time,
  end_time,
  price_cop,
  deposit_percent,
  is_active
)
VALUES
  (
    '44444444-4444-4444-8444-444444444401',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222201',
    NULL,
    NULL,
    NULL,
    NULL,
    60000,
    20,
    true
  ),
  (
    '44444444-4444-4444-8444-444444444402',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222202',
    NULL,
    NULL,
    NULL,
    NULL,
    60000,
    20,
    true
  )
ON CONFLICT (id) DO UPDATE
SET
  price_cop = EXCLUDED.price_cop,
  deposit_percent = EXCLUDED.deposit_percent,
  is_active = EXCLUDED.is_active;

-- =============================================================================
-- 5. Test Users (Dueño y Empleado del recinto piloto para entorno de pruebas)
-- =============================================================================

INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
)
VALUES
  (
    '00000000-0000-0000-0000-000000000000',
    '55555555-5555-4555-8555-555555555501',
    'authenticated',
    'authenticated',
    'dueno@canchaya.test',
    extensions.crypt('CanchaYa2026!', extensions.gen_salt('bf')),
    timezone('utc', now()),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    timezone('utc', now()),
    timezone('utc', now()),
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '55555555-5555-4555-8555-555555555502',
    'authenticated',
    'authenticated',
    'empleado@canchaya.test',
    extensions.crypt('CanchaYa2026!', extensions.gen_salt('bf')),
    timezone('utc', now()),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    timezone('utc', now()),
    timezone('utc', now()),
    '',
    '',
    '',
    ''
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (
  id,
  user_id,
  provider_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
VALUES
  (
    '55555555-5555-4555-8555-555555555501',
    '55555555-5555-4555-8555-555555555501',
    '55555555-5555-4555-8555-555555555501',
    '{"sub":"55555555-5555-4555-8555-555555555501","email":"dueno@canchaya.test","email_verified":true}'::jsonb,
    'email',
    timezone('utc', now()),
    timezone('utc', now()),
    timezone('utc', now())
  ),
  (
    '55555555-5555-4555-8555-555555555502',
    '55555555-5555-4555-8555-555555555502',
    '55555555-5555-4555-8555-555555555502',
    '{"sub":"55555555-5555-4555-8555-555555555502","email":"empleado@canchaya.test","email_verified":true}'::jsonb,
    'email',
    timezone('utc', now()),
    timezone('utc', now()),
    timezone('utc', now())
  )
ON CONFLICT (provider_id, provider) DO NOTHING;

INSERT INTO public.users (id, tenant_id, role, full_name, phone, is_active)
VALUES
  (
    '55555555-5555-4555-8555-555555555501',
    '11111111-1111-4111-8111-111111111111',
    'owner',
    'Dueño Piloto Pamplona',
    NULL,
    true
  ),
  (
    '55555555-5555-4555-8555-555555555502',
    '11111111-1111-4111-8111-111111111111',
    'staff',
    'Empleado Piloto Pamplona',
    NULL,
    true
  )
ON CONFLICT (id) DO UPDATE
SET
  tenant_id = EXCLUDED.tenant_id,
  role = EXCLUDED.role,
  full_name = EXCLUDED.full_name,
  is_active = EXCLUDED.is_active;

COMMIT;

