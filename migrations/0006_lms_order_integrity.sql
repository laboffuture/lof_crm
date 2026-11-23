CREATE INDEX IF NOT EXISTS ix_student_email ON docs(lower(trim(json_extract(data, '$.email'))))
WHERE type='student';

-- Existing duplicate profiles can be reviewed and corrected without changing their IDs.
CREATE TRIGGER IF NOT EXISTS trg_student_email_insert
BEFORE INSERT ON docs
WHEN NEW.type='student' AND NOT EXISTS (SELECT 1 FROM docs WHERE type='student' AND id=NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'duplicate student email')
  WHERE trim(json_extract(NEW.data, '$.email'))<>'' AND EXISTS (
    SELECT 1 FROM docs WHERE type='student'
      AND lower(trim(json_extract(data, '$.email')))=lower(trim(json_extract(NEW.data, '$.email')))
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_student_email_update
BEFORE UPDATE OF data ON docs
WHEN NEW.type='student' AND trim(json_extract(NEW.data, '$.email'))<>''
  AND lower(trim(json_extract(NEW.data, '$.email'))) IS NOT lower(trim(json_extract(OLD.data, '$.email')))
BEGIN
  SELECT RAISE(ABORT, 'duplicate student email') WHERE EXISTS (
    SELECT 1 FROM docs WHERE type='student' AND id<>NEW.id
      AND lower(trim(json_extract(data, '$.email')))=lower(trim(json_extract(NEW.data, '$.email')))
  );
END;

CREATE VIEW IF NOT EXISTS v_lms_order_credits AS
WITH orders AS (
  SELECT e.id AS order_id, e.ref1 AS student_id,
    lower(trim(json_extract(s.data, '$.email'))) AS student_email,
    COALESCE(json_extract(m.data, '$.payload.items'), json_extract(e.data, '$.lmsAccess.items'),
      json_extract(pkg.value, '$.items'),
      CASE WHEN json_extract(pkg.value, '$.track')<>'' THEN json_array(json_object(
        'track', json_extract(pkg.value, '$.track'), 'credits', json_extract(pkg.value, '$.credits')
      )) END) AS items
  FROM docs e
  LEFT JOIN docs s ON s.type='student' AND s.id=e.ref1
  LEFT JOIN docs m ON m.type='moodle_sync' AND m.id=json_extract(e.data, '$.ms')
    AND COALESCE(json_extract(m.data, '$.op'), 'enrol')='enrol'
  LEFT JOIN settings cfg ON cfg.key='cfg'
  LEFT JOIN json_each(json_extract(cfg.data, '$.lms.packages')) prog ON prog.key=json_extract(e.data, '$.prog')
  LEFT JOIN json_each(prog.value) pkg ON pkg.key=json_extract(e.data, '$.pkg')
  WHERE e.type='enrollment' AND (e.status IS NOT 'Withdrawn'
    OR (json_extract(m.data, '$.requestUrl') IS NOT NULL AND COALESCE(json_extract(m.data, '$.requestRefused'), 0)=0)
    OR json_extract(m.data, '$.deliveryMode')='live' OR m.status='Processing')
), sent AS (
  SELECT CASE WHEN json_valid(request) THEN json_extract(request, '$.body') END AS body
  FROM integration_logs
  WHERE integration='lms' AND direction='out' AND operation='enrol' AND mode='live'
    AND CASE WHEN json_valid(response) THEN json_extract(response, '$.inboxid')>0
      AND (json_extract(response, '$.accepted')=1 OR json_extract(response, '$.duplicate')=1) END
), recorded AS (
  SELECT json_extract(body, '$.reference') AS order_id, json_extract(body, '$.student_id') AS student_id,
    lower(trim(json_extract(body, '$.student_email'))) AS student_email, json_extract(body, '$.items') AS items
  FROM sent WHERE json_valid(body)
)
SELECT order_id, student_id, student_email, json_extract(item.value, '$.track') AS track, credit.value AS credit
FROM (SELECT * FROM orders UNION ALL SELECT * FROM recorded)
JOIN json_each(items) item JOIN json_each(json_extract(item.value, '$.credits')) credit;

-- Check in the same write transaction so two concurrent enrolments cannot reserve the same Credit.
CREATE TRIGGER IF NOT EXISTS trg_lms_credit_order_insert
BEFORE INSERT ON docs
WHEN NEW.type='enrollment' AND json_array_length(NEW.data, '$.lmsAccess.items')>0
  AND NOT EXISTS (SELECT 1 FROM docs WHERE type='enrollment' AND id=NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'duplicate LMS credit')
  WHERE EXISTS (
    SELECT 1 FROM v_lms_order_credits held
    JOIN json_each(NEW.data, '$.lmsAccess.items') item ON held.track=json_extract(item.value, '$.track')
    JOIN json_each(json_extract(item.value, '$.credits')) credit ON credit.value=held.credit
    WHERE held.order_id<>NEW.id AND (held.student_id=NEW.ref1 OR (held.student_email<>'' AND held.student_email=(
      SELECT lower(trim(json_extract(data, '$.email'))) FROM docs WHERE type='student' AND id=NEW.ref1
    )))
  );
END;
