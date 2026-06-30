-- Migration 77: Supplier production-update RPCs — Phase 5a (APPLIED, additive)
--
-- Context: submit_production_update is SECURITY DEFINER, anon-executable, and
-- validates NOTHING — anon could pass any project_id to inject production records
-- AND overwrite that project's ETD/ETA milestones. production_updates also had
-- public USING(true) SELECT + INSERT policies (anon read-all / insert-all).
--
-- These RPCs replace the anon path with token+code-validated access. Migration 78
-- (staged) removes the permissive anon table access + ungated RPC execute once the
-- frontend is deployed.

CREATE OR REPLACE FUNCTION public.submit_supplier_production_update(
  p_supplier_token text, p_code text, p_project_id uuid,
  p_previous_etd timestamptz, p_new_etd timestamptz,
  p_is_on_time boolean, p_delay_reason text, p_notes text, p_updated_by text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_record jsonb; v_milestones jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.projects p
    JOIN public.suppliers s ON s.id = p.supplier_id
    WHERE p.id = p_project_id AND s.portal_token = p_supplier_token AND s.access_code = p_code
  ) THEN
    RAISE EXCEPTION 'Not authorized for this project';
  END IF;

  INSERT INTO public.production_updates
    (project_id, previous_etd, new_etd, is_on_time, delay_reason, notes, updated_by, is_supplier_update)
  VALUES
    (p_project_id, p_previous_etd, p_new_etd, p_is_on_time, p_delay_reason, p_notes, p_updated_by, true)
  RETURNING to_jsonb(production_updates.*) INTO v_record;

  SELECT milestones INTO v_milestones FROM public.projects WHERE id = p_project_id;
  IF FOUND THEN
    v_milestones := jsonb_set(COALESCE(v_milestones, '{}'::jsonb), '{etd}', to_jsonb(p_new_etd));
    UPDATE public.projects SET milestones = v_milestones WHERE id = p_project_id;
  END IF;

  RETURN v_record;
END $$;

CREATE OR REPLACE FUNCTION public.get_production_updates_by_supplier(p_supplier_token text, p_code text)
RETURNS SETOF public.production_updates
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT pu.* FROM public.production_updates pu
  JOIN public.projects p ON p.id = pu.project_id
  JOIN public.suppliers s ON s.id = p.supplier_id
  WHERE s.portal_token = p_supplier_token AND s.access_code = p_code
  ORDER BY pu.created_at DESC;
$$;

DO $$
DECLARE fn text;
BEGIN
  FOR fn IN
    SELECT format('%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid))
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('submit_supplier_production_update','get_production_updates_by_supplier')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM public;', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO anon, authenticated;', fn);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
