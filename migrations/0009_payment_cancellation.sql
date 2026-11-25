-- Cancelled payments (transaction cancellation instead of deletion).
-- A payment taken by mistake (wrong course, miscommunication …) is cancelled, never deleted: its receipt and
-- invoice numbers stay in the sequence, marked Cancelled, and the amount drops out of every total.
--
-- 1. The overpayment guard counts only payments that are not cancelled.
DROP TRIGGER IF EXISTS trg_payment_no_overpay;
CREATE TRIGGER IF NOT EXISTS trg_payment_no_overpay
BEFORE INSERT ON docs
WHEN NEW.type = 'payment' AND NOT EXISTS (SELECT 1 FROM docs WHERE type = 'payment' AND id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'overpayment')
  WHERE (SELECT COALESCE(SUM(json_extract(data, '$.amt')), 0) FROM docs
          WHERE type = 'payment' AND ref1 = NEW.ref1 AND COALESCE(json_extract(data, '$.status'), '') <> 'Cancelled')
        + json_extract(NEW.data, '$.amt')
        > COALESCE((SELECT json_extract(data, '$.total') FROM docs WHERE type = 'enrollment' AND id = NEW.ref1), 0) + 0.005;
END;

-- 2. A cancellation is final: a cancelled payment cannot be made active again, and its cancellation record
--    (who, when, with the parent's knowledge or not, reason) cannot be changed.
CREATE TRIGGER IF NOT EXISTS trg_payment_cancel_final
BEFORE UPDATE ON docs
WHEN OLD.type = 'payment' AND json_extract(OLD.data, '$.status') = 'Cancelled' AND (
  json_extract(NEW.data, '$.status') IS NOT 'Cancelled' OR
  json_extract(NEW.data, '$.cancel') IS NOT json_extract(OLD.data, '$.cancel'))
BEGIN
  SELECT RAISE(ABORT, 'immutable payment');
END;
