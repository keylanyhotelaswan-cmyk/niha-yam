-- Fix kitchen tickets cutting before thank-you:
-- SQL default had thank_you.visible = false while the editor preview defaulted it on.

CREATE OR REPLACE FUNCTION public.m6_default_document_layout(p_document_type text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
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
        'visible', true, 'font_pt', 16, 'align', 'center', 'bold', true, 'space_before', 2, 'space_after', 4,
        'fields', jsonb_build_object(
          'message', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'center', 'bold', true)
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
END;
$$;

-- Turn on thank_you for existing kitchen layouts + ensure it is last in section_order.
DO $$
DECLARE
  r record;
  v_order jsonb;
  v_has boolean;
BEGIN
  FOR r IN
    SELECT restaurant_id, layout
    FROM public.print_document_layouts
    WHERE document_type = 'kitchen'
  LOOP
    v_order := coalesce(r.layout->'section_order', '[]'::jsonb);
    v_has := false;
    SELECT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(v_order) x(id) WHERE x.id = 'thank_you'
    ) INTO v_has;

    IF NOT v_has THEN
      v_order := v_order || '"thank_you"'::jsonb;
    END IF;

    UPDATE public.print_document_layouts
    SET
      layout = jsonb_set(
        jsonb_set(
          jsonb_set(
            r.layout,
            '{section_order}',
            v_order,
            true
          ),
          '{sections,thank_you,visible}',
          'true'::jsonb,
          true
        ),
        '{sections,thank_you,space_after}',
        '4'::jsonb,
        true
      ),
      updated_at = now()
    WHERE restaurant_id = r.restaurant_id
      AND document_type = 'kitchen';
  END LOOP;
END;
$$;
