-- CY-018: Row Level Security (RLS) policies per tenant_id
-- Rules enforced:
-- 1. All 8 business tables force RLS and isolate records strictly by tenant_id.
-- 2. Authenticated user's tenant_id and role are resolved via SECURITY DEFINER helpers
--    (filtering by auth.uid() and is_active = true) to prevent infinite RLS recursion on public.users.
-- 3. Authenticated user from tenant A can never read or mutate records belonging to tenant B.

-- =============================================================================
-- 1. Force Row Level Security on all tables
-- =============================================================================

ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sports FORCE ROW LEVEL SECURITY;
ALTER TABLE public.courts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pricing FORCE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;
ALTER TABLE public.customers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.bookings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payments FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- 2. Helper Functions for Tenant & Role Resolution (SECURITY DEFINER)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.current_user_tenant_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.tenant_id
  FROM public.users u
  WHERE u.id = auth.uid()
    AND u.is_active = true
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_user_tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_tenant_id() TO authenticated;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.role
  FROM public.users u
  WHERE u.id = auth.uid()
    AND u.is_active = true
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

-- =============================================================================
-- 3. RLS Policies per Table
-- =============================================================================

-- 3.1 tenants: active members can read their own tenant; only owner can update it
CREATE POLICY tenants_select_own_tenant
  ON public.tenants
  FOR SELECT
  TO authenticated
  USING (id = public.current_user_tenant_id());

CREATE POLICY tenants_update_own_tenant_owner
  ON public.tenants
  FOR UPDATE
  TO authenticated
  USING (
    id = public.current_user_tenant_id()
    AND public.current_user_role() = 'owner'
  )
  WITH CHECK (
    id = public.current_user_tenant_id()
    AND public.current_user_role() = 'owner'
  );

-- 3.2 sports: active members can read their tenant sports; owner can insert/update/delete
CREATE POLICY sports_select_tenant
  ON public.sports
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_user_tenant_id());

CREATE POLICY sports_insert_tenant_owner
  ON public.sports
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = public.current_user_tenant_id()
    AND public.current_user_role() = 'owner'
  );

CREATE POLICY sports_update_tenant_owner
  ON public.sports
  FOR UPDATE
  TO authenticated
  USING (
    tenant_id = public.current_user_tenant_id()
    AND public.current_user_role() = 'owner'
  )
  WITH CHECK (
    tenant_id = public.current_user_tenant_id()
    AND public.current_user_role() = 'owner'
  );

CREATE POLICY sports_delete_tenant_owner
  ON public.sports
  FOR DELETE
  TO authenticated
  USING (
    tenant_id = public.current_user_tenant_id()
    AND public.current_user_role() = 'owner'
  );

-- 3.3 courts: active members can read their tenant courts; owner can insert/update/delete
CREATE POLICY courts_select_tenant
  ON public.courts
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_user_tenant_id());

CREATE POLICY courts_insert_tenant_owner
  ON public.courts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = public.current_user_tenant_id()
    AND public.current_user_role() = 'owner'
  );

CREATE POLICY courts_update_tenant_owner
  ON public.courts
  FOR UPDATE
  TO authenticated
  USING (
    tenant_id = public.current_user_tenant_id()
    AND public.current_user_role() = 'owner'
  )
  WITH CHECK (
    tenant_id = public.current_user_tenant_id()
    AND public.current_user_role() = 'owner'
  );

CREATE POLICY courts_delete_tenant_owner
  ON public.courts
  FOR DELETE
  TO authenticated
  USING (
    tenant_id = public.current_user_tenant_id()
    AND public.current_user_role() = 'owner'
  );

-- 3.4 pricing: active members can read their tenant pricing; owner can insert/update/delete
CREATE POLICY pricing_select_tenant
  ON public.pricing
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_user_tenant_id());

CREATE POLICY pricing_insert_tenant_owner
  ON public.pricing
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = public.current_user_tenant_id()
    AND public.current_user_role() = 'owner'
  );

CREATE POLICY pricing_update_tenant_owner
  ON public.pricing
  FOR UPDATE
  TO authenticated
  USING (
    tenant_id = public.current_user_tenant_id()
    AND public.current_user_role() = 'owner'
  )
  WITH CHECK (
    tenant_id = public.current_user_tenant_id()
    AND public.current_user_role() = 'owner'
  );

CREATE POLICY pricing_delete_tenant_owner
  ON public.pricing
  FOR DELETE
  TO authenticated
  USING (
    tenant_id = public.current_user_tenant_id()
    AND public.current_user_role() = 'owner'
  );

-- 3.5 users: active members can read users of their own tenant; owner can insert/update/delete
CREATE POLICY users_select_tenant
  ON public.users
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_user_tenant_id());

CREATE POLICY users_insert_tenant_owner
  ON public.users
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = public.current_user_tenant_id()
    AND public.current_user_role() = 'owner'
  );

CREATE POLICY users_update_tenant_owner
  ON public.users
  FOR UPDATE
  TO authenticated
  USING (
    tenant_id = public.current_user_tenant_id()
    AND public.current_user_role() = 'owner'
  )
  WITH CHECK (
    tenant_id = public.current_user_tenant_id()
    AND public.current_user_role() = 'owner'
  );

CREATE POLICY users_delete_tenant_owner
  ON public.users
  FOR DELETE
  TO authenticated
  USING (
    tenant_id = public.current_user_tenant_id()
    AND public.current_user_role() = 'owner'
  );

-- 3.6 customers: active members (owner or staff) can select/insert/update customers of their tenant
CREATE POLICY customers_select_tenant
  ON public.customers
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_user_tenant_id());

CREATE POLICY customers_insert_tenant
  ON public.customers
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = public.current_user_tenant_id());

CREATE POLICY customers_update_tenant
  ON public.customers
  FOR UPDATE
  TO authenticated
  USING (tenant_id = public.current_user_tenant_id())
  WITH CHECK (tenant_id = public.current_user_tenant_id());

-- 3.7 bookings: active members (owner or staff) can select/insert/update bookings of their tenant
CREATE POLICY bookings_select_tenant
  ON public.bookings
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_user_tenant_id());

CREATE POLICY bookings_insert_tenant
  ON public.bookings
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = public.current_user_tenant_id());

CREATE POLICY bookings_update_tenant
  ON public.bookings
  FOR UPDATE
  TO authenticated
  USING (tenant_id = public.current_user_tenant_id())
  WITH CHECK (tenant_id = public.current_user_tenant_id());

-- 3.8 payments: active members (owner or staff) can select/insert/update payments of their tenant
CREATE POLICY payments_select_tenant
  ON public.payments
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_user_tenant_id());

CREATE POLICY payments_insert_tenant
  ON public.payments
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = public.current_user_tenant_id());

CREATE POLICY payments_update_tenant
  ON public.payments
  FOR UPDATE
  TO authenticated
  USING (tenant_id = public.current_user_tenant_id())
  WITH CHECK (tenant_id = public.current_user_tenant_id());

