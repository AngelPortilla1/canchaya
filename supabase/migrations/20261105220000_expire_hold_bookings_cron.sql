-- CY-032: Job that expires overdue HOLD bookings and releases the court slot
-- Rules enforced:
-- 1. Any booking in 'HOLD' status whose hold_expires_at <= reference time (UTC)
--    and has no active deposit payment ('pending_validation' or 'approved') is
--    automatically transitioned to 'CANCELLED' with cancellation_reason = 'HOLD_EXPIRED'.
-- 2. Transitioning to 'CANCELLED' immediately releases the court slot in the GiST
--    exclusion constraint (bookings_no_overlapping_active_slots_excl).
-- 3. Scheduled via pg_cron every minute ('* * * * *') as 'expire-overdue-hold-bookings'.

-- =============================================================================
-- 1. Enable pg_cron extension (when available in the PostgreSQL environment)
-- =============================================================================

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION
  WHEN undefined_file OR insufficient_privilege THEN
    RAISE NOTICE 'pg_cron extension is not available in this environment; skipping extension creation.';
END;
$$;

-- =============================================================================
-- 2. Function to expire overdue HOLD bookings without an active deposit
-- =============================================================================

CREATE OR REPLACE FUNCTION public.expire_overdue_hold_bookings(
  p_now TIMESTAMPTZ DEFAULT timezone('utc', now())
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_effective_now TIMESTAMPTZ := COALESCE(p_now, timezone('utc', now()));
  v_expired_count INTEGER := 0;
BEGIN
  UPDATE public.bookings AS b
  SET
    status = 'CANCELLED',
    cancellation_reason = COALESCE(b.cancellation_reason, 'HOLD_EXPIRED'),
    updated_at = v_effective_now
  WHERE b.status = 'HOLD'
    AND b.hold_expires_at IS NOT NULL
    AND b.hold_expires_at <= v_effective_now
    AND NOT EXISTS (
      SELECT 1
      FROM public.payments AS p
      WHERE p.tenant_id = b.tenant_id
        AND p.booking_id = b.id
        AND p.payment_type = 'deposit'
        AND p.status IN ('pending_validation', 'approved')
    );

  GET DIAGNOSTICS v_expired_count = ROW_COUNT;
  RETURN v_expired_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_overdue_hold_bookings(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_overdue_hold_bookings(TIMESTAMPTZ) TO postgres, service_role;

-- =============================================================================
-- 3. Schedule recurring pg_cron job every minute (idempotent)
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (
      SELECT 1
      FROM cron.job
      WHERE jobname = 'expire-overdue-hold-bookings'
    ) THEN
      PERFORM cron.unschedule('expire-overdue-hold-bookings');
    END IF;

    PERFORM cron.schedule(
      'expire-overdue-hold-bookings',
      '* * * * *',
      $cron$SELECT public.expire_overdue_hold_bookings();$cron$
    );
  END IF;
END;
$$;

