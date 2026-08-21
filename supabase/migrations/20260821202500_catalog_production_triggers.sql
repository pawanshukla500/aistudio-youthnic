-- Trigger to automatically log catalog_work_item status changes

CREATE OR REPLACE FUNCTION public.catalog_work_item_status_trigger()
RETURNS trigger AS $$
BEGIN
  -- Log generation_status changes
  IF OLD.generation_status IS DISTINCT FROM NEW.generation_status THEN
    INSERT INTO public.catalog_work_item_events (organization_id, work_item_id, event_type, from_status, to_status, source)
    VALUES (NEW.organization_id, NEW.id, 'generation_status_changed', OLD.generation_status, NEW.generation_status, 'system');
  END IF;

  -- Log qc_status changes
  IF OLD.qc_status IS DISTINCT FROM NEW.qc_status THEN
    INSERT INTO public.catalog_work_item_events (organization_id, work_item_id, event_type, from_status, to_status, source)
    VALUES (NEW.organization_id, NEW.id, 'qc_status_changed', OLD.qc_status, NEW.qc_status, 'system');
  END IF;

  -- Log listing_status changes
  IF OLD.listing_status IS DISTINCT FROM NEW.listing_status THEN
    INSERT INTO public.catalog_work_item_events (organization_id, work_item_id, event_type, from_status, to_status, source)
    VALUES (NEW.organization_id, NEW.id, 'listing_status_changed', OLD.listing_status, NEW.listing_status, 'system');
  END IF;

  -- Log overall status changes
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.catalog_work_item_events (organization_id, work_item_id, event_type, from_status, to_status, source)
    VALUES (NEW.organization_id, NEW.id, 'status_changed', OLD.status, NEW.status, 'system');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS catalog_work_item_status_audit ON public.catalog_work_items;
CREATE TRIGGER catalog_work_item_status_audit
  AFTER UPDATE ON public.catalog_work_items
  FOR EACH ROW
  EXECUTE FUNCTION public.catalog_work_item_status_trigger();
