-- Payment link validity.
--  • Links staff share (from an opportunity or Payment Collection) work for 24 hours.
--  • Links in instalment reminder e-mails have no time limit: each stays open until the next reminder for the
--    same enrolment goes out, which replaces it.
-- Parents open the CRM's own page (/webhooks/pay/l/<id>), which says "already paid" or "expired" instead of
-- sending them on to the gateway.
ALTER TABLE payment_links ADD COLUMN expires_at TEXT;   -- ISO time; NULL = no time limit
ALTER TABLE payment_links ADD COLUMN kind TEXT;         -- collect | opp | reminder
CREATE INDEX IF NOT EXISTS idx_payment_links_enr_kind ON payment_links(enrollment_id, kind, status);
