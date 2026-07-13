-- Layout v2: section_order + per-field knobs (backward-compatible merge)

CREATE OR REPLACE FUNCTION public.m6_default_document_layout(p_document_type text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_sec jsonb;
  v_order jsonb;
BEGIN
  IF p_document_type = 'kitchen' THEN
    v_order := '["restaurant_name","ticket_header","order_meta","customer_or_table","lines","order_note","thank_you"]'::jsonb;
    v_sec := jsonb_build_object(
      'restaurant_name', jsonb_build_object(
        'visible', true, 'font_pt', 26, 'align', 'center', 'bold', true, 'space_before', 0, 'space_after', 2,
        'fields', jsonb_build_object(
          'name', jsonb_build_object('visible', true, 'font_pt', 26, 'align', 'center', 'bold', true)
        )
      ),
      'ticket_header', jsonb_build_object(
        'visible', true, 'font_pt', 18, 'align', 'center', 'bold', true, 'space_before', 0, 'space_after', 2,
        'fields', jsonb_build_object(
          'title', jsonb_build_object('visible', true, 'font_pt', 18, 'align', 'center', 'bold', true)
        )
      ),
      'order_meta', jsonb_build_object(
        'visible', true, 'font_pt', 17, 'align', 'right', 'bold', true, 'space_before', 0, 'space_after', 2,
        'fields', jsonb_build_object(
          'order_reference', jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', true),
          'datetime', jsonb_build_object('visible', true, 'font_pt', 15, 'align', 'right', 'bold', false),
          'cashier', jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', false),
          'order_type', jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', false),
          'kitchen_ticket', jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', true)
        )
      ),
      'customer_or_table', jsonb_build_object(
        'visible', true, 'font_pt', 17, 'align', 'right', 'bold', true, 'space_before', 0, 'space_after', 2,
        'fields', jsonb_build_object(
          'table_ref', jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', true),
          'customer_name', jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', true)
        )
      ),
      'lines', jsonb_build_object(
        'visible', true, 'font_pt', 22, 'align', 'right', 'bold', true, 'space_before', 2, 'space_after', 2,
        'fields', jsonb_build_object(
          'item_line', jsonb_build_object('visible', true, 'font_pt', 22, 'align', 'right', 'bold', true),
          'modifiers', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', false),
          'note', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', false)
        )
      ),
      'order_note', jsonb_build_object(
        'visible', true, 'font_pt', 17, 'align', 'right', 'bold', true, 'space_before', 2, 'space_after', 2,
        'fields', jsonb_build_object(
          'note', jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', true)
        )
      ),
      'thank_you', jsonb_build_object(
        'visible', false, 'font_pt', 16, 'align', 'center', 'bold', false, 'space_before', 2, 'space_after', 2,
        'fields', jsonb_build_object(
          'message', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'center', 'bold', false)
        )
      )
    );
  ELSE
    v_order := '["restaurant_name","slogan","branch_info","invoice_meta","customer","lines","totals","payment","qr","thank_you"]'::jsonb;
    v_sec := jsonb_build_object(
      'restaurant_name', jsonb_build_object(
        'visible', true, 'font_pt', 30, 'align', 'center', 'bold', true, 'space_before', 0, 'space_after', 2,
        'fields', jsonb_build_object(
          'name', jsonb_build_object('visible', true, 'font_pt', 30, 'align', 'center', 'bold', true)
        )
      ),
      'slogan', jsonb_build_object(
        'visible', true, 'font_pt', 14, 'align', 'center', 'bold', false, 'space_before', 0, 'space_after', 4,
        'fields', jsonb_build_object(
          'text', jsonb_build_object('visible', true, 'font_pt', 14, 'align', 'center', 'bold', false)
        )
      ),
      'branch_info', jsonb_build_object(
        'visible', true, 'font_pt', 14, 'align', 'center', 'bold', false, 'space_before', 0, 'space_after', 2,
        'fields', jsonb_build_object(
          'address', jsonb_build_object('visible', true, 'font_pt', 14, 'align', 'center', 'bold', false),
          'phone', jsonb_build_object('visible', true, 'font_pt', 14, 'align', 'center', 'bold', true)
        )
      ),
      'invoice_meta', jsonb_build_object(
        'visible', true, 'font_pt', 16, 'align', 'right', 'bold', true, 'space_before', 0, 'space_after', 2,
        'fields', jsonb_build_object(
          'invoice_number', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', true),
          'datetime', jsonb_build_object('visible', true, 'font_pt', 14, 'align', 'right', 'bold', false),
          'cashier', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', false),
          'order_type', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', false)
        )
      ),
      'customer', jsonb_build_object(
        'visible', true, 'font_pt', 16, 'align', 'right', 'bold', false, 'space_before', 0, 'space_after', 2,
        'fields', jsonb_build_object(
          'customer_name', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', false),
          'customer_phone', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', false),
          'delivery_address', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', false),
          'table_ref', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', true)
        )
      ),
      'lines', jsonb_build_object(
        'visible', true, 'font_pt', 17, 'align', 'right', 'bold', true, 'space_before', 2, 'space_after', 2,
        'fields', jsonb_build_object(
          'item_line', jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', true),
          'price', jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', true),
          'modifiers', jsonb_build_object('visible', true, 'font_pt', 14, 'align', 'right', 'bold', false),
          'note', jsonb_build_object('visible', true, 'font_pt', 14, 'align', 'right', 'bold', false)
        )
      ),
      'totals', jsonb_build_object(
        'visible', true, 'font_pt', 22, 'align', 'center', 'bold', true, 'space_before', 4, 'space_after', 2,
        'fields', jsonb_build_object(
          'subtotal', jsonb_build_object('visible', true, 'font_pt', 15, 'align', 'center', 'bold', false),
          'discount', jsonb_build_object('visible', true, 'font_pt', 15, 'align', 'center', 'bold', false),
          'total', jsonb_build_object('visible', true, 'font_pt', 22, 'align', 'center', 'bold', true)
        )
      ),
      'payment', jsonb_build_object(
        'visible', true, 'font_pt', 15, 'align', 'center', 'bold', true, 'space_before', 2, 'space_after', 2,
        'fields', jsonb_build_object(
          'method', jsonb_build_object('visible', true, 'font_pt', 15, 'align', 'center', 'bold', true),
          'status', jsonb_build_object('visible', true, 'font_pt', 15, 'align', 'center', 'bold', true),
          'change', jsonb_build_object('visible', true, 'font_pt', 15, 'align', 'center', 'bold', true)
        )
      ),
      'qr', jsonb_build_object(
        'visible', false, 'font_pt', 14, 'align', 'center', 'bold', false, 'space_before', 2, 'space_after', 2,
        'fields', jsonb_build_object(
          'code', jsonb_build_object('visible', true, 'font_pt', 14, 'align', 'center', 'bold', false)
        )
      ),
      'thank_you', jsonb_build_object(
        'visible', true, 'font_pt', 16, 'align', 'center', 'bold', true, 'space_before', 4, 'space_after', 2,
        'fields', jsonb_build_object(
          'message', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'center', 'bold', true)
        )
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'version', 2,
    'paper_width_mm', 80,
    'section_order', v_order,
    'sections', v_sec
  );
END; $$;

CREATE OR REPLACE FUNCTION public.m6_normalize_field_style(p_sec jsonb, p_def jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  RETURN jsonb_build_object(
    'visible', coalesce((p_sec->>'visible')::boolean, (p_def->>'visible')::boolean, true),
    'font_pt', LEAST(40, GREATEST(10, coalesce((p_sec->>'font_pt')::int, (p_def->>'font_pt')::int, 16))),
    'align', CASE coalesce(p_sec->>'align', p_def->>'align', 'right')
      WHEN 'left' THEN 'left' WHEN 'center' THEN 'center' ELSE 'right' END,
    'bold', coalesce((p_sec->>'bold')::boolean, (p_def->>'bold')::boolean, false)
  );
END; $$;

CREATE OR REPLACE FUNCTION public.upsert_print_document_layout(
  p_document_type text,
  p_layout jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_layout jsonb;
  v_default jsonb;
  v_sections jsonb := '{}'::jsonb;
  v_key text;
  v_sec jsonb;
  v_def jsonb;
  v_paper int;
  v_order jsonb := '[]'::jsonb;
  v_id text;
  v_seen text[] := ARRAY[]::text[];
  v_fields jsonb;
  v_fkey text;
  v_fdef jsonb;
  v_fout jsonb;
BEGIN
  IF p_document_type NOT IN ('receipt', 'kitchen') THEN
    RAISE EXCEPTION 'INVALID_DOCUMENT_TYPE';
  END IF;
  IF p_layout IS NULL OR jsonb_typeof(p_layout) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;

  v_default := public.m6_default_document_layout(p_document_type);
  v_paper := CASE
    WHEN (p_layout->>'paper_width_mm')::int IN (58, 80) THEN (p_layout->>'paper_width_mm')::int
    ELSE coalesce((v_default->>'paper_width_mm')::int, 80)
  END;

  -- section_order: keep valid ids, append missing defaults
  IF jsonb_typeof(p_layout->'section_order') = 'array' THEN
    FOR v_id IN SELECT jsonb_array_elements_text(p_layout->'section_order')
    LOOP
      IF v_default->'sections' ? v_id AND NOT (v_id = ANY (v_seen)) THEN
        v_order := v_order || to_jsonb(v_id);
        v_seen := array_append(v_seen, v_id);
      END IF;
    END LOOP;
  END IF;
  FOR v_id IN SELECT jsonb_array_elements_text(v_default->'section_order')
  LOOP
    IF NOT (v_id = ANY (v_seen)) THEN
      v_order := v_order || to_jsonb(v_id);
      v_seen := array_append(v_seen, v_id);
    END IF;
  END LOOP;

  FOR v_key, v_def IN SELECT * FROM jsonb_each(v_default->'sections')
  LOOP
    v_sec := coalesce(p_layout->'sections'->v_key, v_def);
    v_fout := '{}'::jsonb;
    FOR v_fkey, v_fdef IN SELECT * FROM jsonb_each(coalesce(v_def->'fields', '{}'::jsonb))
    LOOP
      v_fields := coalesce(v_sec->'fields'->v_fkey, v_fdef);
      v_fout := v_fout || jsonb_build_object(
        v_fkey,
        public.m6_normalize_field_style(v_fields, v_fdef)
      );
    END LOOP;

    v_sections := v_sections || jsonb_build_object(
      v_key,
      jsonb_build_object(
        'visible', coalesce((v_sec->>'visible')::boolean, (v_def->>'visible')::boolean, true),
        'font_pt', LEAST(40, GREATEST(10, coalesce((v_sec->>'font_pt')::int, (v_def->>'font_pt')::int, 16))),
        'align', CASE coalesce(v_sec->>'align', v_def->>'align', 'right')
          WHEN 'left' THEN 'left' WHEN 'center' THEN 'center' ELSE 'right' END,
        'bold', coalesce((v_sec->>'bold')::boolean, (v_def->>'bold')::boolean, false),
        'space_before', LEAST(12, GREATEST(0, coalesce((v_sec->>'space_before')::int, (v_def->>'space_before')::int, 0))),
        'space_after', LEAST(12, GREATEST(0, coalesce((v_sec->>'space_after')::int, (v_def->>'space_after')::int, 2))),
        'fields', v_fout
      )
    );
  END LOOP;

  v_layout := jsonb_build_object(
    'version', 2,
    'paper_width_mm', v_paper,
    'section_order', v_order,
    'sections', v_sections
  );

  INSERT INTO public.print_document_layouts (restaurant_id, document_type, layout, updated_at)
  VALUES (v_rest, p_document_type, v_layout, now())
  ON CONFLICT (restaurant_id, document_type) DO UPDATE SET
    layout = excluded.layout,
    updated_at = now();

  RETURN public.get_print_document_layout(p_document_type);
END; $$;

-- Migrate existing rows: normalize via upsert-style merge into v2
DO $$
DECLARE
  r record;
  v_norm jsonb;
BEGIN
  FOR r IN SELECT restaurant_id, document_type, layout FROM public.print_document_layouts
  LOOP
    -- Force re-save through upsert logic by temporary merge:
    -- keep section-level knobs; fill fields/order from defaults
    PERFORM set_config('app.tmp', '', false);
    v_norm := public.m6_default_document_layout(r.document_type);
    -- Prefer existing paper + section visible/font when present
    IF r.layout ? 'paper_width_mm' AND (r.layout->>'paper_width_mm')::int IN (58, 80) THEN
      v_norm := jsonb_set(v_norm, '{paper_width_mm}', r.layout->'paper_width_mm');
    END IF;
    IF r.layout ? 'section_order' AND jsonb_typeof(r.layout->'section_order') = 'array' THEN
      v_norm := jsonb_set(v_norm, '{section_order}', r.layout->'section_order');
    END IF;
    -- Deep-merge sections: overlay old section props onto defaults (fields filled by default)
    IF r.layout ? 'sections' THEN
      v_norm := jsonb_set(
        v_norm,
        '{sections}',
        (
          SELECT jsonb_object_agg(def.key, coalesce(def.val, '{}'::jsonb) || coalesce(old.val, '{}'::jsonb) ||
            jsonb_build_object(
              'fields',
              coalesce(def.val->'fields', '{}'::jsonb) || coalesce(old.val->'fields', '{}'::jsonb)
            ))
          FROM jsonb_each(v_norm->'sections') def(key, val)
          LEFT JOIN jsonb_each(r.layout->'sections') old(key, val) ON old.key = def.key
        )
      );
    END IF;
    UPDATE public.print_document_layouts
    SET layout = v_norm, updated_at = now()
    WHERE restaurant_id = r.restaurant_id AND document_type = r.document_type;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
