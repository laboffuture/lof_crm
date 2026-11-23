-- Receipt e-mails now carry the invoice and receipt (PDF attachments and the receipt in the e-mail).
-- Saved "Fee receipt" templates that still promise a separate tax invoice get the new sentence; any other
-- wording an administrator wrote is left as it is (only this exact sentence is replaced, in every branch copy).
UPDATE settings
   SET data = replace(data, 'Your tax invoice will be sent separately by our accounts team.', 'Your invoice and receipt are attached to this e-mail.'),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
       updated_by = 'migration 0006'
 WHERE key = 'cfg' AND instr(data, 'Your tax invoice will be sent separately by our accounts team.') > 0;
