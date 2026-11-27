import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setup, SECRETS, USERS, doc, stubFetch, type TestCtx } from '../helpers/app';
import { hmacSha256Hex } from '../../src/lib/crypto';
import { Repo } from '../../src/lib/db';

let t: TestCtx;
beforeEach(async () => { t = await setup(); });
afterEach(() => vi.unstubAllGlobals());

const sign = (secret: string, body: string) => hmacSha256Hex(secret, body);

describe('website lead capture', () => {
  const form = { student: 'Ali Test', parent: 'Sara Test', phone: '+971 50 999 1111', email: 'sara.test@example.com', branch: 'KRM', prog: 'SPA', category: 'Hot', wa_consent: true, email_consent: true };

  it('creates, routes and greets a lead from a signed submission', async () => {
    const raw = JSON.stringify(form);
    const r = await t.call('POST', '/webhooks/website', { raw, headers: { 'content-type': 'application/json', 'x-lof-signature': await sign(SECRETS.WEBSITE_FORM_SECRET, raw) } });
    expect(r.status).toBe(200);
    const l = await doc(t, 'lead', r.body.reference);
    expect(l).toMatchObject({ src: 'Website', branch: 'KRM', prog: 'SPA', cat: 'Hot', stage: 'New Lead', status: 'Open' });
    expect(l.cslr).toBe('S02'); // the only Karama counsellor handling Space & Astronomy
    const comms = await t.sql<any>("SELECT data FROM docs WHERE type='comm' AND ref1=?", l.id);
    expect(comms.map((c) => JSON.parse(c.data).status)).toEqual(['Sent (mock)', 'Sent (mock)', 'Sent (mock)']);
    const tasks = await t.sql<any>("SELECT data FROM docs WHERE type='task' AND ref1=?", l.id);
    expect(JSON.parse(tasks[0].data).type).toBe('First call');
  });
  it('rejects unsigned or tampered submissions', async () => {
    const raw = JSON.stringify(form);
    expect((await t.call('POST', '/webhooks/website', { raw, headers: { 'content-type': 'application/json' } })).status).toBe(401);
    expect((await t.call('POST', '/webhooks/website', { raw: raw.replace('Ali', 'Bob'), headers: { 'content-type': 'application/json', 'x-lof-signature': await sign(SECRETS.WEBSITE_FORM_SECRET, raw) } })).status).toBe(401);
  });
  it('accepts browser posts from an allowed origin and ignores bots (honeypot)', async () => {
    await t.setCfg((c) => { c.integ.web.origins = ['https://labofuture.example']; });
    const ok = await t.call('POST', '/webhooks/website', { raw: JSON.stringify(form), headers: { 'content-type': 'application/json', origin: 'https://labofuture.example' } });
    expect(ok.status).toBe(200);
    const bot = await t.call('POST', '/webhooks/website', { raw: JSON.stringify({ ...form, website: 'spam' }), headers: { 'content-type': 'application/json', origin: 'https://labofuture.example' } });
    expect(bot.body.reference).toBeUndefined();
  });
  it('refuses a programme the branch does not offer', async () => {
    const raw = JSON.stringify({ ...form, branch: 'HYD', prog: 'SPA' });
    const r = await t.call('POST', '/webhooks/website', { raw, headers: { 'content-type': 'application/json', 'x-lof-signature': await sign(SECRETS.WEBSITE_FORM_SECRET, raw) } });
    expect(r.status).toBe(422);
  });
});

describe('Meta Lead Ads (live mode, Graph API stubbed)', () => {
  it('verifies the subscription and exposes the mapped form in Leads once', async () => {
    t = await setup({ INTEGRATION_MODE: 'auto' });
    const v = await t.call('GET', `/webhooks/meta?hub.mode=subscribe&hub.verify_token=${SECRETS.META_VERIFY_TOKEN}&hub.challenge=42`);
    expect(v.text).toBe('42');
    expect((await t.call('GET', '/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42')).status).toBe(403);

    await t.setCfg((c) => { c.integ.meta.forms = { F9: { branch: 'SPC', prog: 'AI', camp: 'Meta Lead Form – AI Coding', cat: 'Hot' } }; });
    const submission = {
      id: 'L777', form_id: 'F9', platform: 'fb', created_time: '2026-10-30T16:55:59+0530',
      field_data: [
        { name: 'Parent Name', values: ['Test Parent'] },
        { name: 'Phone', values: ['+971501234999'] },
        { name: 'Email', values: ['parent@example.com'] },
        { name: 'Child’s Age?', values: ['11-15'] },
        { name: 'Interest', values: ['Robotics & Engineering', 'Innovation & Practical Projects'] },
        { name: 'UTM Source', values: ['facebook'] },
        { name: 'utm_medium', values: ['paid_social'] },
        { name: 'utm_campaign', values: ['fall-workshops'] },
        { name: 'utm_term', values: ['robotics'] },
        { name: 'utm_content', values: ['carousel'] },
      ],
    };
    const { calls } = stubFetch([[/graph\.facebook\.com\/v21\.0\/L777/, () => ({ json: submission })]]);
    const raw = JSON.stringify({ object: 'page', entry: [{ changes: [{ field: 'leadgen', value: { leadgen_id: 'L777', form_id: 'F9' } }] }] });
    const headers = { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + (await sign(SECRETS.META_APP_SECRET, raw)) };
    const deliveries = await Promise.all([
      t.call('POST', '/webhooks/meta', { raw, headers }),
      t.call('POST', '/webhooks/meta', { raw, headers }),
    ]);
    expect(deliveries.map((delivery) => delivery.status)).toEqual([200, 200]);
    expect(calls[0].url).toContain('access_token=meta-page-token');
    const callCount = calls.length;
    expect((await t.call('POST', '/webhooks/meta', { raw, headers })).status).toBe(200);
    expect(calls).toHaveLength(callCount);
    const leads = await t.call('GET', '/api/v1/leads?source=Facebook&q=parent%40example.com', { token: await t.login(USERS.admin) });
    expect(leads.status).toBe(200);
    expect(leads.body.items).toHaveLength(1);
    expect(leads.body.items[0]).toMatchObject({
      parent: 'Test Parent', phone: '+971501234999', email: 'parent@example.com', src: 'Facebook',
      branch: 'SPC', prog: 'AI', cat: 'Hot', stage: 'New Lead', enq: '2026-10-30T11:25:59.000Z', age: 0,
      notes: 'Child age: 11-15 · Interest: Robotics & Engineering, Innovation & Practical Projects · UTM Source: facebook · UTM Medium: paid_social · UTM Campaign: fall-workshops · UTM Term: robotics · UTM Content: carousel',
      external: {
        metaLeadId: 'L777', formId: 'F9', childAge: '11-15', interest: 'Robotics & Engineering, Innovation & Practical Projects',
        utm: { source: 'facebook', medium: 'paid_social', campaign: 'fall-workshops', term: 'robotics', content: 'carousel' },
      },
    });
    const log = await t.sql<any>("SELECT url FROM integration_logs WHERE integration='meta' AND direction='out'");
    expect(log[0].url).not.toContain('meta-page-token'); // redacted
  });

  it('uses the event timestamp and IDs when absent from Graph and preserves a numeric age', async () => {
    t = await setup({ INTEGRATION_MODE: 'auto' });
    await t.setCfg((c) => {
      c.integ.meta.forms = { F10: { branch: 'SPC', prog: 'AI' } };
      c.integ.meta.fieldMap = { 'Preferred activity?': 'interest' };
    });
    stubFetch([[/graph\.facebook\.com\/v21\.0\/L778/, () => ({ json: {
      field_data: [
        { name: 'full_name', values: ['Another Test Parent'] },
        { name: 'child_name', values: ['Test Student'] },
        { name: 'phone_number', values: ['+971501234998'] },
        { name: 'child_age', values: ['12'] },
        { name: 'preferred_activity', values: ['Electronics'] },
      ],
    } })]]);
    const raw = JSON.stringify({ object: 'page', entry: [{ changes: [{ field: 'leadgen', value: {
      leadgen_id: 'L778', form_id: 'F10', ad_id: 'AD10', created_time: Date.parse('2026-10-30T11:30:00Z') / 1000,
    } }] }] });
    const headers = { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + (await sign(SECRETS.META_APP_SECRET, raw)) };
    expect((await t.call('POST', '/webhooks/meta', { raw, headers })).status).toBe(200);
    const rows = await t.sql<{ data: string }>("SELECT data FROM docs WHERE type='lead' AND ref1='501234998'");
    expect(rows).toHaveLength(1);
    const lead = JSON.parse(rows[0].data);
    expect(lead).toMatchObject({ student: 'Test Student', age: 12, enq: '2026-10-30T11:30:00.000Z', notes: 'Interest: Electronics' });
    expect(lead.external).toEqual({ metaLeadId: 'L778', formId: 'F10', adId: 'AD10', childAge: '12', interest: 'Electronics' });
  });

  it('asks Meta to retry a failed lookup and skips completed entries on batch replay', async () => {
    t = await setup({ INTEGRATION_MODE: 'auto' });
    let attempts = 0;
    const { calls } = stubFetch([
      [/graph\.facebook\.com\/v21\.0\/L779/, () => {
        attempts++;
        if (attempts === 1) return { status: 503, json: { error: { message: 'Graph temporarily unavailable' } } };
        return { json: { id: 'L779', field_data: [{ name: 'phone', values: ['9000000042'] }] } };
      }],
      [/graph\.facebook\.com\/v21\.0\/L780/, () => ({
        json: { id: 'L780', field_data: [{ name: 'phone', values: ['9000000043'] }] },
      })],
    ]);
    const raw = JSON.stringify({ object: 'page', entry: [{ changes: ['L779', 'L780'].map((id) => ({
      field: 'leadgen', value: { leadgen_id: id },
    })) }] });
    const headers = { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + (await sign(SECRETS.META_APP_SECRET, raw)) };
    const first = await t.call('POST', '/webhooks/meta', { raw, headers });
    expect(first.status).toBe(503);
    expect(first.body).toMatchObject({ ok: false, received: 2, leads: [expect.any(String)] });
    expect(await t.sql("SELECT event_id FROM webhook_events WHERE provider='meta'")).toEqual([{ event_id: 'L780' }]);
    expect(await t.sql("SELECT status, ok FROM integration_logs WHERE integration='meta' AND direction='in'")).toEqual([{ status: 503, ok: 0 }]);

    const retry = await t.call('POST', '/webhooks/meta', { raw, headers });
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ ok: true, received: 2, leads: [expect.any(String)] });
    expect(calls).toHaveLength(3);
    expect(await t.sql("SELECT json_extract(data,'$.phone') AS phone FROM docs WHERE type='lead' AND json_extract(data,'$.external.metaLeadId') IN ('L779','L780') ORDER BY phone"))
      .toEqual([{ phone: '9000000042' }, { phone: '9000000043' }]);
  });

  it('recovers older failed Meta events and recognizes an already saved lead', async () => {
    t = await setup({ INTEGRATION_MODE: 'auto' });
    t.d1.db.exec("INSERT INTO webhook_events (provider,event_id,result) VALUES ('meta','L781','error: prior failure')");
    const { calls } = stubFetch([[/graph\.facebook\.com\/v21\.0\/L781/, () => ({
      json: { id: 'L781', field_data: [{ name: 'phone', values: ['9000000044'] }] },
    })]]);
    const raw = JSON.stringify({ object: 'page', entry: [{ changes: [{ field: 'leadgen', value: { leadgen_id: 'L781' } }] }] });
    const headers = { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + (await sign(SECRETS.META_APP_SECRET, raw)) };
    const recovered = await t.call('POST', '/webhooks/meta', { raw, headers });
    expect(recovered.status).toBe(200);
    expect(recovered.body.leads).toHaveLength(1);

    // Older imports could save the lead and fail before writing its ID to the event.
    t.d1.db.exec("UPDATE webhook_events SET result=NULL WHERE provider='meta' AND event_id='L781'");
    const replay = await t.call('POST', '/webhooks/meta', { raw, headers });
    expect(replay.status).toBe(200);
    expect(replay.body.leads).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(await t.sql("SELECT result FROM webhook_events WHERE provider='meta' AND event_id='L781'"))
      .toEqual([{ result: recovered.body.leads[0] }]);
  });
});

describe('Gupshup WhatsApp Flow submissions', () => {
  const path = '/webhooks/gupshup/leads';
  const secret = 'test-gupshup-crm-webhook-secret';
  const headers = { authorization: 'Bearer ' + secret };
  const form = {
    submission_id: 'wamid.EXAMPLE_FORM_REPLY', student: 'Aisha Test', parent: 'Mariam Test',
    phone: '971509991234', email: 'mariam@example.com', branch: 'KRM', prog: 'SPA',
    notes: 'Prefers Saturday sessions', wa_consent: true,
  };

  beforeEach(() => { t.env.GUPSHUP_WEBHOOK_SECRET = secret; });

  it('shows the routed lead in the Leads list and CRM bootstrap', async () => {
    const result = await t.call('POST', path, { body: form, headers });
    expect(result.status).toBe(200);
    const id = result.body.reference;
    const token = await t.login(USERS.hassan);
    const list = await t.call('GET', '/api/v1/leads?source=WhatsApp&q=' + id, { token });
    expect(list.body.items).toEqual([expect.objectContaining({
      id, src: 'WhatsApp', stage: 'New Lead', status: 'Open', cat: 'Warm', cslr: 'S02',
      student: form.student, parent: form.parent, phone: '+' + form.phone, email: form.email,
      branch: form.branch, prog: form.prog, notes: form.notes, wa: true, em: false,
      external: { gupshup: { submissionId: form.submission_id } },
    })]);
    const bootstrap = await t.call('GET', '/api/v1/bootstrap', { token });
    expect(bootstrap.body.data.leads).toEqual(expect.arrayContaining([expect.objectContaining({ id, src: 'WhatsApp' })]));
    expect(bootstrap.body.data.tasks).toEqual(expect.arrayContaining([expect.objectContaining({ lead: id, type: 'First call' })]));
    expect(bootstrap.body.data.comms.filter((comm: any) => comm.lead === id)).toEqual([]);
  });

  it('creates one lead for simultaneous and subsequent retries of the same submission', async () => {
    const send = () => t.call('POST', path, { body: form, headers });
    const results = await Promise.all([send(), send()]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const id = results[0].body.reference;
    expect(results.map((r) => r.body.reference)).toEqual([id, id]);
    expect(results.filter((r) => r.body.duplicate)).toHaveLength(1);
    expect((await send()).body).toMatchObject({ reference: id, duplicate: true });
    expect(await t.sql("SELECT id FROM docs WHERE type='lead' AND ref1='509991234'")).toEqual([{ id }]);
    expect(await t.sql("SELECT id FROM docs WHERE type='task' AND ref1=?", id)).toHaveLength(1);

    const another = await t.call('POST', path, { body: { ...form, submission_id: 'wamid.ANOTHER_FORM_REPLY' }, headers });
    expect(another.status).toBe(200);
    expect(another.body.reference).not.toBe(id);
  });

  it('checks authorization and rejects incomplete submissions or invalid branch/programme combinations', async () => {
    expect((await t.call('POST', path, { body: form })).status).toBe(401);
    expect((await t.call('POST', path, { body: form, headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
    expect((await t.call('POST', path, { body: { ...form, student: '' }, headers })).status).toBe(400);
    expect((await t.call('POST', path, { body: { ...form, branch: 'HYD' }, headers })).status).toBe(422);
    await t.setCfg((cfg) => { cfg.sources.find((source: any) => source.n === 'WhatsApp').en = false; });
    expect((await t.call('POST', path, { body: form, headers })).status).toBe(422);
    expect(await t.sql("SELECT result FROM webhook_events WHERE provider='gupshup'")).toEqual([]);
    delete t.env.GUPSHUP_WEBHOOK_SECRET;
    expect((await t.call('POST', path, { body: form, headers })).status).toBe(503);
  });

  it('can retry after a failed write without leaving a partial lead', async () => {
    t.d1.db.exec(`CREATE TRIGGER fail_gupshup_audit BEFORE INSERT ON docs WHEN NEW.type='audit'
      BEGIN SELECT RAISE(ABORT, 'test write failure'); END;`);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await t.call('POST', path, { body: form, headers })).status).toBe(500);
    } finally {
      errorLog.mockRestore();
    }
    expect(await t.sql("SELECT result FROM webhook_events WHERE provider='gupshup'")).toEqual([]);
    expect(await t.sql("SELECT id FROM docs WHERE type='lead' AND ref1='509991234'")).toEqual([]);
    t.d1.db.exec('DROP TRIGGER fail_gupshup_audit');
    expect((await t.call('POST', path, { body: form, headers })).status).toBe(200);
  });
});

describe('LMS lead submissions', () => {
  const path = '/webhooks/lms/leads';
  const secret = 'test-lms-lead-webhook-secret';
  const headers = { authorization: `Bearer ${secret}` };
  const form = {
    Timestamp: '2026-10-30 16:55:59',
    'Parent Name': 'Postman Test Parent',
    Phone: '9000000042',
    Email: 'parent@example.com',
    'Child Age': '11-15',
    Interest: 'Robotics & Engineering',
    'UTM Source': 'facebook',
    'UTM Medium': 'paid_social',
    'UTM Campaign': 'robotics-october',
    'UTM Term': 'robotics',
    'UTM Content': 'carousel',
  };

  beforeEach(() => {
    t.env.LMS_LEAD_WEBHOOK_SECRET = secret;
    delete t.env.META_APP_SECRET;
    delete t.env.META_VERIFY_TOKEN;
    delete t.env.META_PAGE_ACCESS_TOKEN;
  });

  it('maps the spreadsheet fields into Leads and deduplicates simultaneous deliveries', async () => {
    const email = 'postman.long-email-for-the-lms-integration-test@example.com';
    const body = { ...form, Email: email, submission_id: 'lms-101' };
    await new Repo(t.env.DB).create('student', {
      id: 'LMS-TEST-STUDENT', first: 'Existing', last: 'Student', branch: 'BLR', status: 'Active',
      parents: [{ name: 'Existing Parent', email: email.toUpperCase() }],
    });
    const send = () => t.call('POST', path, { headers, body });
    const submissions = await Promise.all([send(), send()]);
    expect(submissions.map((result) => result.status)).toEqual([200, 200]);
    const id = submissions[0].body.reference;
    expect(submissions.map((result) => result.body.reference)).toEqual([id, id]);
    expect(submissions.filter((result) => result.body.duplicate)).toHaveLength(1);
    expect((await send()).body).toEqual({ ok: true, reference: id, duplicate: true });

    const leads = await t.call('GET', '/api/v1/leads?source=Facebook&q=' + id, { token: await t.login(USERS.admin) });
    expect(leads.status).toBe(200);
    expect(leads.body.items).toEqual([expect.objectContaining({
      id, parent: form['Parent Name'], student: form['Parent Name'], phone: form.Phone, email,
      branch: 'BLR', prog: 'ROB', src: 'Facebook', stage: 'New Lead', enq: '2026-10-30T11:25:59.000Z',
      notes: 'Child age: 11-15 · Interest: Robotics & Engineering · UTM Source: facebook · UTM Medium: paid_social · UTM Campaign: robotics-october · UTM Term: robotics · UTM Content: carousel',
      events: expect.arrayContaining([expect.objectContaining({ type: 'warn', text: expect.stringContaining('LMS-TEST-STUDENT') })]),
      external: {
        lms: { submissionId: 'lms-101' }, childAge: '11-15', interest: 'Robotics & Engineering',
        utm: { source: 'facebook', medium: 'paid_social', campaign: 'robotics-october', term: 'robotics', content: 'carousel' },
      },
    })]);
    expect(await t.sql("SELECT id FROM docs WHERE type='comm' AND ref1=?", id)).toEqual([]);
  });

  it('deduplicates equivalent requests without an ID and keeps later enquiries from the same parent', async () => {
    const body = { timestamp: '2026-10-30T16:55:59+05:30', parent_name: form['Parent Name'], phone: 9000000042, child_age: 12 };
    const first = await t.call('POST', path, { headers, body });
    expect(first.status).toBe(200);
    const repeated = await t.call('POST', path, { headers, body: {
      Timestamp: '2026-10-30 16:55:59', 'Parent Name': body.parent_name, Phone: '9000000042', 'Child Age': '12',
    } });
    expect(repeated.body).toEqual({ ok: true, reference: first.body.reference, duplicate: true });
    const later = await t.call('POST', path, { headers, body: { ...body, timestamp: '2026-10-30T17:00:00+05:30' } });
    expect(later.status).toBe(200);
    expect(later.body.reference).not.toBe(first.body.reference);
    expect(await t.sql("SELECT json_extract(data,'$.age') AS age FROM docs WHERE type='lead' AND id=?", first.body.reference))
      .toEqual([{ age: 12 }]);
  });

  it('checks authentication, the payload and optional routing overrides before saving a lead', async () => {
    const body = { ...form, submission_id: 'lms-invalid' };
    const navigation = await t.call('GET', path, { headers: { 'sec-fetch-mode': 'navigate' } });
    expect(navigation).toMatchObject({ status: 405, body: { error: 'Use POST to submit an LMS lead' } });
    expect(navigation.headers.get('allow')).toBe('POST');
    expect((await t.call('POST', path, { body })).status).toBe(401);
    expect((await t.call('POST', path, { headers: { authorization: 'Bearer wrong' }, body })).status).toBe(401);
    expect((await t.call('POST', path, { headers, raw: '{' })).status).toBe(400);
    expect((await t.call('POST', path, { headers, body: { ...body, Phone: 'invalid' } })).status).toBe(400);
    expect((await t.call('POST', path, { headers, body: { ...body, Timestamp: '2026-02-30T16:55:59Z' } })).status).toBe(400);
    expect((await t.call('POST', path, { headers, body: { ...body, Programme: 'unknown' } })).status).toBe(422);
    expect(await t.sql("SELECT result FROM webhook_events WHERE provider='lms-leads'")).toEqual([]);

    const routed = await t.call('POST', path, { headers, body: {
      ...body, Timestamp: '2026-10-30T16:55:59+04:00', Branch: 'KRM', Programme: 'SPA',
    } });
    expect(routed.status).toBe(200);
    const lead = await t.call('GET', '/api/v1/leads/' + routed.body.reference, { token: await t.login(USERS.admin) });
    expect(lead.body.lead).toMatchObject({ branch: 'KRM', prog: 'SPA', enq: '2026-10-30T12:55:59.000Z' });

    delete t.env.LMS_LEAD_WEBHOOK_SECRET;
    expect((await t.call('POST', path, { headers, body })).status).toBe(503);
  });

  it.each([
    ['an empty body', ''],
    ['a null payload', 'null'],
    ['an array of rows', JSON.stringify([form])],
    ['a missing parent name', JSON.stringify({ ...form, 'Parent Name': undefined })],
    ['a blank phone', JSON.stringify({ ...form, Phone: '   ' })],
    ['a missing timestamp', JSON.stringify({ ...form, Timestamp: undefined })],
    ['an invalid UTC offset', JSON.stringify({ ...form, Timestamp: '2026-10-30T16:55:59+24:00' })],
    ['an invalid email', JSON.stringify({ ...form, Email: 'parent@' })],
    ['an overlong parent name', JSON.stringify({ ...form, 'Parent Name': 'A'.repeat(121) })],
    ['a phone with too many digits', JSON.stringify({ ...form, Phone: '1234567890123456' })],
    ['an object in a text field', JSON.stringify({ ...form, Interest: { unexpected: true } })],
    ['ambiguous versions of a field', JSON.stringify({ ...form, parent_name: 'Another Parent' })],
  ])('rejects %s without saving a lead', async (_description, raw) => {
    const response = await t.call('POST', path, { raw, headers: { ...headers, 'content-type': 'application/json' } });
    expect(response.status).toBe(400);
    expect(await t.sql("SELECT result FROM webhook_events WHERE provider='lms-leads'")).toEqual([]);
  });

  it('allows an exact-size request and rejects a larger UTF-8 body', async () => {
    const base = JSON.stringify({ ...form, Metadata: '' });
    const sized = JSON.stringify({ ...form, Metadata: 'a'.repeat(16_384 - base.length) });
    expect((await t.call('POST', path, { raw: sized, headers })).status).toBe(200);
    const oversized = JSON.stringify({ ...form, Metadata: 'あ'.repeat(6_000) });
    expect((await t.call('POST', path, { raw: oversized, headers })).status).toBe(413);
    expect(await t.sql("SELECT result FROM webhook_events WHERE provider='lms-leads'")).toHaveLength(1);
  });

  it('accepts Unicode names, an explicit UTC timestamp, a formatted phone, and blank optional values', async () => {
    const body = {
      Timestamp: '2024-02-29T23:59:59.987Z', 'Parent Name': 'मीरा मेहता', Phone: '+91 (90000) 00042',
      Email: null, 'Child Age': null, Interest: '', 'UTM Source': null,
    };
    const response = await t.call('POST', path, { body, headers: { authorization: `bearer ${secret}` } });
    expect(response.status).toBe(200);
    expect(await doc(t, 'lead', response.body.reference)).toMatchObject({
      enq: '2024-02-29T23:59:59.987Z', parent: body['Parent Name'], phone: body.Phone, email: '', notes: '', src: 'Website',
    });
  });

  it.each([
    ['  InStAgRaM  ', 'Instagram'],
    ['website', 'Website'],
    ['whatsapp', 'WhatsApp'],
    ['newsletter', 'Website'],
  ])('maps UTM source %s to CRM source %s and keeps the UTM value', async (utmSource, src) => {
    const response = await t.call('POST', path, { headers, body: { ...form, 'UTM Source': utmSource } });
    expect(response.status).toBe(200);
    expect(await doc(t, 'lead', response.body.reference)).toMatchObject({
      src, external: { utm: { source: utmSource.trim() } },
    });
  });

  it('honours a disabled CRM source when the UTM source matches it', async () => {
    await t.setCfg((cfg) => { cfg.sources.find((source: any) => source.n === 'Facebook').en = false; });
    const response = await t.call('POST', path, { headers, body: form });
    expect(response).toMatchObject({ status: 422, body: { error: 'Lead creation from Facebook is disabled in configuration' } });
    expect(await t.sql("SELECT result FROM webhook_events WHERE provider='lms-leads'")).toEqual([]);
  });

  it('keeps the first record for a reused ID and accepts a separate submission for the same contact', async () => {
    const first = await t.call('POST', path, { headers, body: { ...form, submission_id: 'original' } });
    const replay = await t.call('POST', path, { headers, body: { ...form, submission_id: 'original', Interest: 'Changed' } });
    const another = await t.call('POST', path, { headers, body: { ...form, submission_id: 'another' } });
    expect(first.status).toBe(200);
    expect(replay.body).toEqual({ ok: true, reference: first.body.reference, duplicate: true });
    expect(another.status).toBe(200);
    expect(another.body.reference).not.toBe(first.body.reference);
    expect((await doc(t, 'lead', first.body.reference)).notes).toContain(form.Interest);
  });

  it('rolls back a partial write so the sender can retry with the same submission ID', async () => {
    const body = { ...form, submission_id: 'retry-after-write-failure' };
    t.d1.db.exec(`CREATE TRIGGER fail_lms_audit BEFORE INSERT ON docs WHEN NEW.type='audit'
      BEGIN SELECT RAISE(ABORT, 'test LMS write failure'); END;`);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await t.call('POST', path, { headers, body })).status).toBe(500);
    } finally {
      errorLog.mockRestore();
      t.d1.db.exec('DROP TRIGGER fail_lms_audit');
    }
    expect(await t.sql("SELECT result FROM webhook_events WHERE provider='lms-leads'")).toEqual([]);
    expect(await t.sql("SELECT id FROM docs WHERE type='lead' AND json_extract(data,'$.external.lms.submissionId')=?", body.submission_id))
      .toEqual([]);
    const retry = await t.call('POST', path, { headers, body });
    expect(retry.status).toBe(200);
    expect((await t.call('POST', path, { headers, body })).body)
      .toEqual({ ok: true, reference: retry.body.reference, duplicate: true });
  });
});

describe('WhatsApp webhooks', () => {
  it('updates delivery status and threads inbound replies onto the lead', async () => {
    const tok = await t.login(USERS.admin);
    await t.call('PUT', '/api/v1/sync', { token: tok, body: { changes: [{ coll: 'comms', id: 'CM950', op: 'upsert', doc: { id: 'CM950', lead: 'LD-26-1009', ch: 'WhatsApp', tpl: 'Follow-up nudge', text: 'hi', at: new Date().toISOString(), status: 'Sent (simulated)', by: 'x' } }] } });
    const wamid = (await doc(t, 'comm', 'CM950')).waMsgId;
    const status = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: wamid, status: 'read', timestamp: '1760000000' }] } }] }] });
    await t.call('POST', '/webhooks/whatsapp', { raw: status, headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + (await sign(SECRETS.WHATSAPP_APP_SECRET, status)) } });
    expect((await doc(t, 'comm', 'CM950')).status).toBe('Read');

    const l = await doc(t, 'lead', 'LD-26-1009');
    const inbound = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: 'wamid.IN1', from: l.phone.replace(/\D/g, ''), type: 'text', text: { body: 'Call me at 6pm' } }] } }] }] });
    const r = await t.call('POST', '/webhooks/whatsapp', { raw: inbound, headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + (await sign(SECRETS.WHATSAPP_APP_SECRET, inbound)) } });
    expect(r.body.messages).toBe(1);
    const after = await doc(t, 'lead', 'LD-26-1009');
    expect(after.avail).toMatchObject({ s: 'Replied', text: 'Call me at 6pm' });
    expect(after.events.at(-1).text).toContain('Call me at 6pm');
  });
  it('rejects unsigned events', async () => {
    expect((await t.call('POST', '/webhooks/whatsapp', { raw: '{}', headers: { 'content-type': 'application/json' } })).status).toBe(401);
  });
});

describe('Exotel webhooks', () => {
  it('pops incoming calls to the assigned counsellor and logs completed calls', async () => {
    const l = await doc(t, 'lead', 'LD-26-1009'); // uncalled, Priya
    expect(l.fc).toBeNull();
    await t.call('GET', `/webhooks/exotel/incoming?token=${SECRETS.EXOTEL_WEBHOOK_TOKEN}&CallSid=IN1&CallFrom=${encodeURIComponent(l.phone)}&Direction=incoming`);
    const pop = await t.call('GET', '/api/v1/calls/incoming?since=2000-01-01', { token: await t.login(USERS.priya) });
    expect(pop.body.events[0].lead_id).toBe('LD-26-1009');

    const r = await t.call('POST', `/webhooks/exotel/status?token=${SECRETS.EXOTEL_WEBHOOK_TOKEN}&lead=LD-26-1009&staff=S01`, { raw: JSON.stringify({ CallSid: 'OUT1', Status: 'completed', ConversationDuration: 200, RecordingUrl: 'https://rec/1.mp3', To: l.phone }), headers: { 'content-type': 'application/json' } });
    expect(r.status).toBe(200);
    const after = await doc(t, 'lead', 'LD-26-1009');
    expect(after.fc).not.toBeNull();
    expect(after.stage).toBe('Contacted');
    const call = await doc(t, 'call', r.body.call);
    expect(call).toMatchObject({ dir: 'Outgoing', status: 'Completed', dur: 3.3, rec: 'https://rec/1.mp3', first: true });
    const dup = await t.call('POST', `/webhooks/exotel/status?token=${SECRETS.EXOTEL_WEBHOOK_TOKEN}&lead=LD-26-1009`, { raw: JSON.stringify({ CallSid: 'OUT1', Status: 'completed' }), headers: { 'content-type': 'application/json' } });
    expect(dup.body.duplicate).toBe(true);
  });
  it('rejects requests without the shared token', async () => {
    expect((await t.call('GET', '/webhooks/exotel/incoming?CallFrom=1')).status).toBe(401);
  });
});

describe('payment gateways', () => {
  async function legacyLink(enrollmentId: string, provider: 'telr' | 'razorpay', ref: string, url: string) {
    const enrollment = await doc(t, 'enrollment', enrollmentId);
    const id = 'PL-LEGACY9';
    const amount = enrollment.total - enrollment.paid;
    await t.d1.prepare("INSERT INTO payment_links (id,provider,provider_ref,enrollment_id,amount,currency,url,status,created_by,is_test) VALUES (?,?,?,?,?,?,?,'created','Test',0)")
      .bind(id, provider, ref, enrollmentId, amount, enrollment.cur, url).run();
    return { id, provider, providerRef: ref, amount };
  }
  it('Razorpay: signed payment_link.paid records the payment once', async () => {
    // Make an INR enrolment with a balance: Dhruv (BLR) is fully paid, so use a fresh partial payment state
    // give the (fully paid) Bengaluru enrolment an open balance of 1,000 INR
    await t.d1.prepare("UPDATE docs SET data=json_set(data,'$.total',json_extract(data,'$.total')+1000,'$.payStatus','Partially paid') WHERE type='enrollment' AND id='EN-26-0006'").run();
    const l = await legacyLink('EN-26-0006', 'razorpay', 'rzp_fixture', 'https://razorpay.com/fixture');
    expect(l.provider).toBe('razorpay');
    const body = JSON.stringify({ event: 'payment_link.paid', payload: { payment_link: { entity: { id: l.providerRef, reference_id: l.id } }, payment: { entity: { id: 'pay_1', amount: Math.round(l.amount * 100), method: 'upi' } } } });
    const headers = { 'content-type': 'application/json', 'x-razorpay-signature': await sign(SECRETS.RAZORPAY_WEBHOOK_SECRET, body), 'x-razorpay-event-id': 'evt_1' };
    expect((await t.call('POST', '/webhooks/razorpay', { raw: body, headers })).status).toBe(200);
    const e = await doc(t, 'enrollment', 'EN-26-0006');
    expect(e.payStatus).toBe('Paid');
    const pays = (await t.sql<any>("SELECT data FROM docs WHERE type='payment' AND ref1='EN-26-0006'")).map((x) => JSON.parse(x.data)).filter((x) => x.gateway);
    expect(pays).toHaveLength(1);
    const p = pays[0];
    expect(p).toMatchObject({ method: 'UPI', ref: 'pay_1', branch: 'BLR', amt: 1000 });
    expect(p.rc).toMatch(/^RC-BLR-26-\d{4}$/);
    expect(p.erp.name).toBe('ACC-PAY-MOCK-' + p.id); // pushed to ERPNext (mock)
    expect((await t.call('POST', '/webhooks/razorpay', { raw: body, headers })).body.duplicate).toBe(true);
    expect((await t.call('POST', '/webhooks/razorpay', { raw: body, headers: { ...headers, 'x-razorpay-signature': 'bad' } })).status).toBe(401);
  });
  it('Telr: transaction advice is confirmed with Telr before recording (live, stubbed)', async () => {
    t = await setup({ INTEGRATION_MODE: 'auto' });
    await t.setCfg((c) => { c.integ.pay.on = true; });
    let checks = 0;
    stubFetch([[/secure\.telr\.com\/gateway\/order\.json/, (req) => {
      const b = JSON.parse(req.body);
      expect(b.authkey).toBe(SECRETS.TELR_AUTH_KEY);
      if (b.method === 'create') return { json: { method: 'create', order: { ref: 'TELRREF1', url: 'https://secure.telr.com/gateway/process.html?o=TELRREF1' } } };
      checks++;
      return { json: { order: { ref: 'TELRREF1', status: { code: 3, text: 'Paid' }, amount: '1260.00', currency: 'AED', transaction: { ref: 'TXN9' } } } };
    }]]);
    const l = await legacyLink('EN-26-0002', 'telr', 'TELRREF1', 'https://secure.telr.com/gateway/process.html?o=TELRREF1'); // parents get the CRM's link page, which forwards to Telr
    expect((await t.sql<any>('SELECT url FROM payment_links WHERE id=?', l.id))[0].url).toContain('secure.telr.com');
    await t.call('POST', '/webhooks/telr', { raw: `tran_cartid=${l.id}&tran_status=A&tran_ref=forged`, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(checks).toBe(1);
    const pays = (await t.sql<any>("SELECT data FROM docs WHERE type='payment' AND ref1='EN-26-0002'")).map((x) => JSON.parse(x.data));
    const p = pays.find((x) => x.gateway);
    expect(p).toMatchObject({ method: 'Card', ref: 'TXN9' }); // reference comes from Telr's check, not the advice body
    // Customer returning to the site does not record it twice
    const ret = await t.call('GET', `/webhooks/pay/return?link=${l.id}`);
    expect(ret.text).toContain('payment was received');
    expect((await t.sql("SELECT id FROM docs WHERE type='payment' AND ref1='EN-26-0002'")).length).toBe(pays.length);
  });
  it('refuses links above the outstanding balance', async () => {
    const r = await t.call('POST', '/api/v1/payments/links', { token: await t.login(USERS.admin), body: { enrollmentId: 'EN-26-0002', amount: 999999 } });
    expect(r.status).toBe(422);
  });
});
