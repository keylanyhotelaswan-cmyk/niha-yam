-- Fix: print.skipped was recorded when printer inactive/missing but never
-- allowlisted on chk_order_events_type → sale/print ops failed after disabling a printer.

ALTER TABLE public.order_events DROP CONSTRAINT IF EXISTS chk_order_events_type;
ALTER TABLE public.order_events ADD CONSTRAINT chk_order_events_type CHECK (
  event_type IN (
    'order.created',
    'collection.recorded', 'collection.approved', 'collection.rejected', 'collection.reversed',
    'order.amended',
    'order.item_added', 'order.item_removed', 'order.qty_changed', 'order.modifiers_changed',
    'order.customer_changed', 'order.tender_changed', 'order.total_changed',
    'order.review_flagged', 'order.review_cleared',
    'kitchen.sent', 'print.enqueued', 'print.skipped',
    'fulfillment.updated', 'order.delivered', 'order.cancelled',
    'delivery.driver_assigned', 'delivery.driver_changed'
  )
);

CREATE OR REPLACE FUNCTION public.m5c_timeline_label(p_event_type text, p_payload jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN CASE p_event_type
    WHEN 'order.created' THEN 'تم إنشاء الطلب'
    WHEN 'collection.recorded' THEN 'تم التحصيل'
    WHEN 'collection.approved' THEN 'تم اعتماد التحصيل'
    WHEN 'collection.rejected' THEN 'تم رفض التحصيل'
    WHEN 'collection.reversed' THEN 'تم عكس التحصيل'
    WHEN 'order.item_added' THEN 'أُضيف صنف' || coalesce(': ' || (p_payload->>'item_name'), '')
    WHEN 'order.item_removed' THEN 'حُذف صنف' || coalesce(': ' || (p_payload->>'item_name'), '')
    WHEN 'order.qty_changed' THEN 'تغيرت الكمية' || coalesce(' لـ ' || (p_payload->>'item_name'), '')
    WHEN 'order.modifiers_changed' THEN 'تغيرت الإضافات' || coalesce(': ' || (p_payload->>'item_name'), '')
    WHEN 'order.customer_changed' THEN 'تغير العميل'
    WHEN 'order.tender_changed' THEN 'تغيرت طريقة الدفع'
    WHEN 'order.total_changed' THEN 'تغير إجمالي الطلب'
    WHEN 'order.amended' THEN 'تم تعديل الطلب (رسمي)'
    WHEN 'order.review_flagged' THEN 'وُضعت علامة تحتاج مراجعة'
    WHEN 'order.review_cleared' THEN 'أُزيلت علامة المراجعة'
    WHEN 'kitchen.sent' THEN 'تم الإرسال للمطبخ'
    WHEN 'print.enqueued' THEN 'تم إرسال للطباعة'
    WHEN 'print.skipped' THEN
      'تخطّي الطباعة' || coalesce(' (' || (p_payload->>'reason') || ')', '')
    WHEN 'fulfillment.updated' THEN 'تحديث حالة التنفيذ'
    WHEN 'order.delivered' THEN 'تم التسليم'
    WHEN 'order.cancelled' THEN 'تم الإلغاء'
    WHEN 'delivery.driver_assigned' THEN
      'تم تعيين الكابتن' || coalesce(' ' || (p_payload->>'to_driver_name'), '')
    WHEN 'delivery.driver_changed' THEN
      'تم تغيير الكابتن من '
        || coalesce(p_payload->>'from_driver_name', '—')
        || ' إلى '
        || coalesce(p_payload->>'to_driver_name', '—')
    ELSE p_event_type
  END;
END;
$$;
