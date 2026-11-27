-- Payment links shared from an opportunity (before the student is enrolled).
-- The enrolment form is filled in when the link is shared and kept here as a checked draft;
-- when the parent pays, the server completes that enrolment and records the payment against it.
ALTER TABLE payment_links ADD COLUMN opp_id TEXT;          -- OP-… the link was shared from
ALTER TABLE payment_links ADD COLUMN draft TEXT;           -- JSON: the enrolment changes, applied on payment
ALTER TABLE payment_links ADD COLUMN draft_by TEXT;        -- staff id who shared the link (the enrolment is made in their name)
ALTER TABLE payment_links ADD COLUMN apply_error TEXT;     -- set when the paid draft could not be enrolled automatically
CREATE INDEX IF NOT EXISTS idx_payment_links_opp ON payment_links(opp_id);
