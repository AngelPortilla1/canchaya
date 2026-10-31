-- CY-017: Exclusion constraint (tstzrange + GiST) to prevent overlapping bookings per court
-- Rules enforced:
-- 1. Never allow double booking on the same court for overlapping UTC time ranges.
-- 2. Half-open interval '[)' allows back-to-back bookings (e.g., 18:00-19:00 and 19:00-20:00).
-- 3. Cancelled or rescheduled bookings do not block the court slot.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_no_overlapping_active_slots_excl
  EXCLUDE USING gist (
    tenant_id WITH =,
    court_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (status NOT IN ('CANCELLED', 'RESCHEDULED'));
