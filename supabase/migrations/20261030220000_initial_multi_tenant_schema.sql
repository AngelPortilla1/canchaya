-- CY-016: Initial multi-tenant database schema for CanchaYa
-- Rules enforced:
-- 1. Every business table includes tenant_id (with composite FK integrity to prevent cross-tenant references) and has RLS enabled.
-- 2. All timestamps use TIMESTAMPTZ (stored in UTC; displayed in America/Bogota).
-- 3. All monetary values in COP are stored as INTEGER (never floating point).

-- =============================================================================
-- 1. Domain Enums
-- =============================================================================

CREATE TYPE public.user_role AS ENUM ('owner', 'staff');

CREATE TYPE public.booking_status AS ENUM (
  'HOLD',
  'CONFIRMED',
  'COMPLETED',
  'NO_SHOW',
  'CANCELLED',
  'RESCHEDULED'
);

CREATE TYPE public.payment_type AS ENUM ('deposit', 'balance');

CREATE TYPE public.payment_method AS ENUM ('transfer', 'cash', 'mixed');

CREATE TYPE public.payment_status AS ENUM (
  'pending_validation',
  'approved',
  'rejected'
);

-- =============================================================================
-- 2. Utility Trigger for updated_at
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$;

-- =============================================================================
-- 3. Tables
-- =============================================================================

-- 3.1 tenants (recintos deportivos)
CREATE TABLE public.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name TEXT NOT NULL CHECK (char_length(btrim(name)) > 0),
  timezone TEXT NOT NULL DEFAULT 'America/Bogota',
  slot_duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (slot_duration_minutes > 0),
  hold_duration_minutes INTEGER NOT NULL DEFAULT 15 CHECK (hold_duration_minutes > 0),
  deposit_percent INTEGER NOT NULL DEFAULT 20 CHECK (deposit_percent BETWEEN 0 AND 100),
  min_reschedule_hours INTEGER NOT NULL DEFAULT 4 CHECK (min_reschedule_hours >= 0),
  whatsapp_phone_number_id TEXT UNIQUE,
  operating_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TRIGGER trg_tenants_set_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- 3.2 sports (deportes habilitados por recinto, ej. padel, futbol_5)
CREATE TABLE public.sports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL CHECK (code IN ('padel', 'futbol_5')),
  name TEXT NOT NULL CHECK (char_length(btrim(name)) > 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT sports_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT sports_tenant_code_unique UNIQUE (tenant_id, code)
);

CREATE INDEX idx_sports_tenant_id ON public.sports(tenant_id);

CREATE TRIGGER trg_sports_set_updated_at
  BEFORE UPDATE ON public.sports
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- 3.3 courts (canchas del recinto)
CREATE TABLE public.courts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sport_id UUID NOT NULL,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) > 0),
  display_order INTEGER NOT NULL DEFAULT 1 CHECK (display_order > 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT courts_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT courts_tenant_name_unique UNIQUE (tenant_id, name),
  CONSTRAINT courts_sport_tenant_fk
    FOREIGN KEY (sport_id, tenant_id)
    REFERENCES public.sports(id, tenant_id)
    ON DELETE RESTRICT
);

CREATE INDEX idx_courts_tenant_sport ON public.courts(tenant_id, sport_id);

CREATE TRIGGER trg_courts_set_updated_at
  BEFORE UPDATE ON public.courts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- 3.4 pricing (tarifas en COP entero y % de anticipo por recinto/deporte/cancha/franja)
CREATE TABLE public.pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sport_id UUID NOT NULL,
  court_id UUID,
  day_of_week SMALLINT CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME,
  end_time TIME,
  price_cop INTEGER NOT NULL CHECK (price_cop > 0),
  deposit_percent INTEGER NOT NULL DEFAULT 20 CHECK (deposit_percent BETWEEN 0 AND 100),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT pricing_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT pricing_time_window_check CHECK (
    (start_time IS NULL AND end_time IS NULL)
    OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
  ),
  CONSTRAINT pricing_sport_tenant_fk
    FOREIGN KEY (sport_id, tenant_id)
    REFERENCES public.sports(id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT pricing_court_tenant_fk
    FOREIGN KEY (court_id, tenant_id)
    REFERENCES public.courts(id, tenant_id)
    ON DELETE CASCADE
);

CREATE INDEX idx_pricing_tenant_sport ON public.pricing(tenant_id, sport_id);
CREATE INDEX idx_pricing_tenant_court ON public.pricing(tenant_id, court_id);

CREATE TRIGGER trg_pricing_set_updated_at
  BEFORE UPDATE ON public.pricing
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- 3.5 users (usuarios internos del recinto: dueño y empleado, vinculados a auth.users)
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  role public.user_role NOT NULL DEFAULT 'staff',
  full_name TEXT NOT NULL CHECK (char_length(btrim(full_name)) > 0),
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT users_id_tenant_unique UNIQUE (id, tenant_id)
);

CREATE INDEX idx_users_tenant_role ON public.users(tenant_id, role);

CREATE TRIGGER trg_users_set_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- 3.6 customers (clientes jugadores por recinto)
CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  phone TEXT NOT NULL CHECK (char_length(btrim(phone)) > 0),
  full_name TEXT NOT NULL CHECK (char_length(btrim(full_name)) > 0),
  data_consent_at TIMESTAMPTZ,
  no_show_count INTEGER NOT NULL DEFAULT 0 CHECK (no_show_count >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT customers_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT customers_tenant_phone_unique UNIQUE (tenant_id, phone)
);

CREATE INDEX idx_customers_tenant_phone ON public.customers(tenant_id, phone);

CREATE TRIGGER trg_customers_set_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- 3.7 bookings (reservas de cancha en UTC y montos en COP entero)
CREATE TABLE public.bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  court_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  status public.booking_status NOT NULL DEFAULT 'HOLD',
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  hold_expires_at TIMESTAMPTZ,
  total_price_cop INTEGER NOT NULL CHECK (total_price_cop > 0),
  deposit_required_cop INTEGER NOT NULL CHECK (
    deposit_required_cop >= 0 AND deposit_required_cop <= total_price_cop
  ),
  balance_due_cop INTEGER NOT NULL CHECK (
    balance_due_cop >= 0 AND balance_due_cop <= total_price_cop
  ),
  rescheduled_from_booking_id UUID,
  created_by_user_id UUID,
  cancellation_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT bookings_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT bookings_time_range_check CHECK (ends_at > starts_at),
  CONSTRAINT bookings_hold_expiration_check CHECK (
    status <> 'HOLD' OR hold_expires_at IS NOT NULL
  ),
  CONSTRAINT bookings_court_tenant_fk
    FOREIGN KEY (court_id, tenant_id)
    REFERENCES public.courts(id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT bookings_customer_tenant_fk
    FOREIGN KEY (customer_id, tenant_id)
    REFERENCES public.customers(id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT bookings_rescheduled_from_tenant_fk
    FOREIGN KEY (rescheduled_from_booking_id, tenant_id)
    REFERENCES public.bookings(id, tenant_id)
    ON DELETE SET NULL,
  CONSTRAINT bookings_created_by_user_tenant_fk
    FOREIGN KEY (created_by_user_id, tenant_id)
    REFERENCES public.users(id, tenant_id)
    ON DELETE SET NULL
);

CREATE INDEX idx_bookings_tenant_court_starts_at
  ON public.bookings(tenant_id, court_id, starts_at);
CREATE INDEX idx_bookings_tenant_customer
  ON public.bookings(tenant_id, customer_id);
CREATE INDEX idx_bookings_hold_expires_at
  ON public.bookings(hold_expires_at)
  WHERE status = 'HOLD';

CREATE TRIGGER trg_bookings_set_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- 3.8 payments (anticipos y saldos en COP entero: efectivo, transferencia o mixto)
CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL,
  payment_type public.payment_type NOT NULL,
  method public.payment_method NOT NULL,
  status public.payment_status NOT NULL DEFAULT 'pending_validation',
  amount_cop INTEGER NOT NULL CHECK (amount_cop > 0),
  cash_amount_cop INTEGER NOT NULL DEFAULT 0 CHECK (cash_amount_cop >= 0),
  transfer_amount_cop INTEGER NOT NULL DEFAULT 0 CHECK (transfer_amount_cop >= 0),
  receipt_media_url TEXT,
  validated_by_user_id UUID,
  validated_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT payments_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT payments_breakdown_sum_check CHECK (
    cash_amount_cop + transfer_amount_cop = amount_cop
  ),
  CONSTRAINT payments_method_breakdown_check CHECK (
    (method = 'cash' AND cash_amount_cop = amount_cop AND transfer_amount_cop = 0)
    OR (method = 'transfer' AND transfer_amount_cop = amount_cop AND cash_amount_cop = 0)
    OR (method = 'mixed' AND cash_amount_cop > 0 AND transfer_amount_cop > 0)
  ),
  CONSTRAINT payments_booking_tenant_fk
    FOREIGN KEY (booking_id, tenant_id)
    REFERENCES public.bookings(id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT payments_validated_by_user_tenant_fk
    FOREIGN KEY (validated_by_user_id, tenant_id)
    REFERENCES public.users(id, tenant_id)
    ON DELETE SET NULL
);

CREATE INDEX idx_payments_tenant_booking
  ON public.payments(tenant_id, booking_id);
CREATE INDEX idx_payments_tenant_status
  ON public.payments(tenant_id, status);

CREATE TRIGGER trg_payments_set_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- 4. Row Level Security (enabled on all tables; policies defined in CY-018)
-- =============================================================================

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

