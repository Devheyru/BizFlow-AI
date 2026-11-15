-- ============================================================================
-- Migration: 20261115000020_revoke_inventory_service_role_privileges.sql
-- Description: Revoke unauthorized service_role EXECUTE privileges on Feature 004
--              inventory mutation functions to enforce dual-layer security boundary
--              and least privilege constraints per authoritative contracts.
-- ============================================================================

-- 1. Layer 1: Internal mutation engine
-- Strictly ungranted to all client roles including service_role
REVOKE EXECUTE ON FUNCTION public._execute_inventory_mutation_core(
    UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, TEXT, UUID, INTEGER
) FROM service_role;

-- 2. Layer 2: Public authenticated stock movement RPC
-- Only authenticated users holding active membership and granular permissions can execute
REVOKE EXECUTE ON FUNCTION public.execute_stock_movement(
    UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, INTEGER, TEXT
) FROM service_role;

-- 3. Layer 2: Public authenticated inventory thresholds RPC
-- Only authenticated users holding active membership and granular permissions can execute
REVOKE EXECUTE ON FUNCTION public.update_inventory_thresholds(
    UUID, UUID, NUMERIC, NUMERIC, INTEGER
) FROM service_role;

-- 4. Verification assertion: Ensure 0 privileges remain granted to service_role on mutation routines
DO $$
DECLARE
    v_service_role_count INTEGER;
BEGIN
    SELECT count(*) INTO v_service_role_count
    FROM information_schema.routine_privileges
    WHERE grantee = 'service_role'
      AND specific_schema = 'public'
      AND routine_name IN (
          '_execute_inventory_mutation_core',
          'execute_stock_movement',
          'update_inventory_thresholds'
      );

    IF v_service_role_count > 0 THEN
        RAISE EXCEPTION 'Security verification failed: % privileges still granted to service_role on Feature 004 mutation routines', v_service_role_count;
    END IF;
END $$;
