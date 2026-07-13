-- Bake default printable labels into document layouts so Bridge has no hardcoded copy (BP-15).
-- Client mergeLayout also fills missing labels; this persists them for enqueue/stamp.

CREATE OR REPLACE FUNCTION public.m6_set_field_label_if_missing(
  p_layout jsonb,
  p_section text,
  p_field text,
  p_label_ar text,
  p_label_en text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_field jsonb;
BEGIN
  IF p_layout IS NULL THEN
    RETURN p_layout;
  END IF;
  IF (p_layout #> ARRAY['sections', p_section, 'fields', p_field]) IS NULL THEN
    RETURN p_layout;
  END IF;

  v_field := p_layout #> ARRAY['sections', p_section, 'fields', p_field];
  IF v_field IS NULL OR jsonb_typeof(v_field) <> 'object' THEN
    RETURN p_layout;
  END IF;

  IF NOT (v_field ? 'label_ar') THEN
    v_field := v_field || jsonb_build_object('label_ar', to_jsonb(p_label_ar));
  END IF;
  IF p_label_en IS NOT NULL AND NOT (v_field ? 'label_en') THEN
    v_field := v_field || jsonb_build_object('label_en', to_jsonb(p_label_en));
  END IF;
  IF NOT (v_field ? 'label_mode') THEN
    v_field := v_field || jsonb_build_object('label_mode', '"ar"'::jsonb);
  END IF;

  RETURN jsonb_set(
    p_layout,
    ARRAY['sections', p_section, 'fields', p_field],
    v_field,
    true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.m6_bake_document_field_labels(p_layout jsonb, p_document_type text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v jsonb := p_layout;
BEGIN
  IF v IS NULL THEN
    RETURN v;
  END IF;

  -- Shared / kitchen
  v := public.m6_set_field_label_if_missing(v, 'ticket_header', 'title', 'تذكرة مطبخ', 'Kitchen Ticket');
  v := public.m6_set_field_label_if_missing(v, 'order_meta', 'order_reference', 'طلب', 'Order');
  v := public.m6_set_field_label_if_missing(v, 'order_meta', 'cashier', 'كاشير', 'Cashier');
  v := public.m6_set_field_label_if_missing(v, 'order_meta', 'order_type', 'النوع', 'Type');
  v := public.m6_set_field_label_if_missing(v, 'order_meta', 'kitchen_ticket', 'تذكرة', 'Ticket');
  v := public.m6_set_field_label_if_missing(v, 'customer_or_table', 'table_ref', 'الطاولة', 'Table');
  v := public.m6_set_field_label_if_missing(v, 'customer_or_table', 'customer_name', 'العميل', 'Customer');
  v := public.m6_set_field_label_if_missing(v, 'order_note', 'note', 'ملاحظة', 'Note');

  -- Receipt
  v := public.m6_set_field_label_if_missing(v, 'invoice_meta', 'invoice_number', 'فاتورة', 'Invoice');
  v := public.m6_set_field_label_if_missing(v, 'invoice_meta', 'cashier', 'كاشير', 'Cashier');
  v := public.m6_set_field_label_if_missing(v, 'invoice_meta', 'order_type', 'النوع', 'Type');
  v := public.m6_set_field_label_if_missing(v, 'customer', 'customer_name', 'العميل', 'Customer');
  v := public.m6_set_field_label_if_missing(v, 'customer', 'customer_phone', 'هاتف', 'Phone');
  v := public.m6_set_field_label_if_missing(v, 'customer', 'delivery_address', 'العنوان', 'Address');
  v := public.m6_set_field_label_if_missing(v, 'customer', 'table_ref', 'الطاولة', 'Table');
  v := public.m6_set_field_label_if_missing(v, 'totals', 'subtotal', 'المجموع', 'Subtotal');
  v := public.m6_set_field_label_if_missing(v, 'totals', 'discount', 'الخصم', 'Discount');
  v := public.m6_set_field_label_if_missing(v, 'totals', 'tax', 'الضريبة', 'Tax');
  v := public.m6_set_field_label_if_missing(v, 'totals', 'total', 'الإجمالي', 'Total');
  v := public.m6_set_field_label_if_missing(v, 'payment', 'method', 'الدفع', 'Payment');
  v := public.m6_set_field_label_if_missing(v, 'payment', 'status', 'الحالة', 'Status');
  v := public.m6_set_field_label_if_missing(v, 'payment', 'change', 'الباقي', 'Change');

  -- Ensure tax field exists on receipt totals when section present
  IF p_document_type = 'receipt'
     AND (v #> '{sections,totals,fields}') IS NOT NULL
     AND NOT (v #> '{sections,totals,fields}' ? 'tax') THEN
    v := jsonb_set(
      v,
      '{sections,totals,fields,tax}',
      jsonb_build_object(
        'visible', true,
        'font_pt', coalesce((v #>> '{sections,totals,fields,discount,font_pt}')::int, 15),
        'align', coalesce(v #>> '{sections,totals,fields,discount,align}', 'center'),
        'bold', false,
        'label_ar', 'الضريبة',
        'label_en', 'Tax',
        'label_mode', 'ar'
      ),
      true
    );
  END IF;

  RETURN v;
END;
$$;

-- Keep tax in SQL defaults so upsert_print_document_layout does not drop it.
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
          'title', jsonb_build_object(
            'visible', true, 'font_pt', 18, 'align', 'center', 'bold', true,
            'label_ar', 'تذكرة مطبخ', 'label_en', 'Kitchen Ticket', 'label_mode', 'ar'
          )
        )
      ),
      'order_meta', jsonb_build_object(
        'visible', true, 'font_pt', 17, 'align', 'right', 'bold', true, 'space_before', 0, 'space_after', 2,
        'fields', jsonb_build_object(
          'order_reference', jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', true, 'label_ar', 'طلب', 'label_en', 'Order', 'label_mode', 'ar'),
          'datetime', jsonb_build_object('visible', true, 'font_pt', 15, 'align', 'right', 'bold', false, 'label_ar', '', 'label_mode', 'ar'),
          'cashier', jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', false, 'label_ar', 'كاشير', 'label_en', 'Cashier', 'label_mode', 'ar'),
          'order_type', jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', false, 'label_ar', 'النوع', 'label_en', 'Type', 'label_mode', 'ar'),
          'kitchen_ticket', jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', true, 'label_ar', 'تذكرة', 'label_en', 'Ticket', 'label_mode', 'ar')
        )
      ),
      'customer_or_table', jsonb_build_object(
        'visible', true, 'font_pt', 17, 'align', 'right', 'bold', true, 'space_before', 0, 'space_after', 2,
        'fields', jsonb_build_object(
          'table_ref', jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', true, 'label_ar', 'الطاولة', 'label_en', 'Table', 'label_mode', 'ar'),
          'customer_name', jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', true, 'label_ar', 'العميل', 'label_en', 'Customer', 'label_mode', 'ar')
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
          'note', jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', true, 'label_ar', 'ملاحظة', 'label_en', 'Note', 'label_mode', 'ar')
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
          'invoice_number', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', true, 'label_ar', 'فاتورة', 'label_en', 'Invoice', 'label_mode', 'ar'),
          'datetime', jsonb_build_object('visible', true, 'font_pt', 14, 'align', 'right', 'bold', false, 'label_ar', '', 'label_mode', 'ar'),
          'cashier', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', false, 'label_ar', 'كاشير', 'label_en', 'Cashier', 'label_mode', 'ar'),
          'order_type', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', false, 'label_ar', 'النوع', 'label_en', 'Type', 'label_mode', 'ar')
        )
      ),
      'customer', jsonb_build_object(
        'visible', true, 'font_pt', 16, 'align', 'right', 'bold', false, 'space_before', 0, 'space_after', 2,
        'fields', jsonb_build_object(
          'customer_name', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', false, 'label_ar', 'العميل', 'label_en', 'Customer', 'label_mode', 'ar'),
          'customer_phone', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', false, 'label_ar', 'هاتف', 'label_en', 'Phone', 'label_mode', 'ar'),
          'delivery_address', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', false, 'label_ar', 'العنوان', 'label_en', 'Address', 'label_mode', 'ar'),
          'table_ref', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', true, 'label_ar', 'الطاولة', 'label_en', 'Table', 'label_mode', 'ar')
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
          'subtotal', jsonb_build_object('visible', true, 'font_pt', 15, 'align', 'center', 'bold', false, 'label_ar', 'المجموع', 'label_en', 'Subtotal', 'label_mode', 'ar'),
          'discount', jsonb_build_object('visible', true, 'font_pt', 15, 'align', 'center', 'bold', false, 'label_ar', 'الخصم', 'label_en', 'Discount', 'label_mode', 'ar'),
          'tax', jsonb_build_object('visible', true, 'font_pt', 15, 'align', 'center', 'bold', false, 'label_ar', 'الضريبة', 'label_en', 'Tax', 'label_mode', 'ar'),
          'total', jsonb_build_object('visible', true, 'font_pt', 22, 'align', 'center', 'bold', true, 'label_ar', 'الإجمالي', 'label_en', 'Total', 'label_mode', 'ar')
        )
      ),
      'payment', jsonb_build_object(
        'visible', true, 'font_pt', 15, 'align', 'center', 'bold', true, 'space_before', 2, 'space_after', 2,
        'fields', jsonb_build_object(
          'method', jsonb_build_object('visible', true, 'font_pt', 15, 'align', 'center', 'bold', true, 'label_ar', 'الدفع', 'label_en', 'Payment', 'label_mode', 'ar'),
          'status', jsonb_build_object('visible', true, 'font_pt', 15, 'align', 'center', 'bold', true, 'label_ar', 'الحالة', 'label_en', 'Status', 'label_mode', 'ar'),
          'change', jsonb_build_object('visible', true, 'font_pt', 15, 'align', 'center', 'bold', true, 'label_ar', 'الباقي', 'label_en', 'Change', 'label_mode', 'ar')
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

DO $$
DECLARE
  r record;
  v_next jsonb;
BEGIN
  FOR r IN
    SELECT restaurant_id, document_type, layout
    FROM public.print_document_layouts
  LOOP
    v_next := public.m6_bake_document_field_labels(r.layout, r.document_type);
    IF v_next IS DISTINCT FROM r.layout THEN
      UPDATE public.print_document_layouts
      SET layout = v_next, updated_at = now()
      WHERE restaurant_id = r.restaurant_id
        AND document_type = r.document_type;
    END IF;
  END LOOP;
END;
$$;
