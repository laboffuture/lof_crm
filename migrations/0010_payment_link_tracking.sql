-- Payments → Payment links: who created each link, and who sent it to the parent, how and when.
ALTER TABLE payment_links ADD COLUMN created_by_id TEXT;   -- staff id of the creator (created_by keeps the name)
ALTER TABLE payment_links ADD COLUMN sent_by TEXT;         -- name of whoever last sent it (or "Payment reminder")
ALTER TABLE payment_links ADD COLUMN sent_by_id TEXT;      -- their staff id
ALTER TABLE payment_links ADD COLUMN sent_via TEXT;        -- WhatsApp | Email
ALTER TABLE payment_links ADD COLUMN sent_to TEXT;         -- the number or address it went to
ALTER TABLE payment_links ADD COLUMN sent_at TEXT;         -- when it was last sent
ALTER TABLE payment_links ADD COLUMN sends INTEGER NOT NULL DEFAULT 0;  -- how many times it was sent
CREATE INDEX IF NOT EXISTS idx_payment_links_created ON payment_links(created_at);
