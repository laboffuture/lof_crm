import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setup, setupEasebuzz, stubFetch, useInrFixtures, USERS, doc, type TestCtx } from '../helpers/app';
import { cron } from '../../src/jobs';
import { Repo } from '../../src/lib/db';

let t: TestCtx;
afterEach(() => vi.unstubAllGlobals());
beforeEach(async () => { t = await setup(); });

describe('REST resources', () => {
  it('creates a lead with routing and detects duplicates', async () => {
    const tok = await t.login(USERS.hassan);
    const body = { student: 'Rami K', parent: 'Nour K', phone: '+971 50 777 1212', email: 'nour@example.com', branch: 'KRM', prog: 'SPA', src: 'Manual', cat: 'Warm' };
    const r = await t.call('POST', '/api/v1/leads', { token: tok, body });
    expect(r.status).toBe(201);
    expect(r.body.lead.id).toBe('LD-26-1032');
    expect(r.body.assignedTo).toBe('S02'); // only Karama counsellor handling Space
    const dup = await t.call('POST', '/api/v1/leads', { token: tok, body });
    expect(dup.status).toBe(409);
    expect(dup.body.duplicates[0].id).toBe('LD-26-1032');
  });
  it('validates input and branch scope', async () => {
    const tok = await t.login(USERS.priya);
    expect((await t.call('POST', '/api/v1/leads', { token: tok, body: { student: 'x' } })).status).toBe(400);
    expect((await t.call('POST', '/api/v1/leads', { token: tok, body: { student: 'a', parent: 'b', phone: '+971501110000', branch: 'BLR', prog: 'ROB', src: 'Manual' } })).status).toBe(403);
    expect((await t.call('POST', '/api/v1/leads', { token: await t.login(USERS.layla), body: { student: 'a', parent: 'b', phone: '+971501110000', branch: 'KRM', prog: 'ROB', src: 'Manual' } })).status).toBe(403);
  });
  it('lists leads with filters inside scope', async () => {
    const r = await t.call('GET', '/api/v1/leads?category=Hot&limit=5', { token: await t.login(USERS.fatima) });
    expect(r.body.items.every((l: any) => l.branch === 'SPC' && l.cat === 'Hot')).toBe(true);
  });
  it('serves a student 360 and a printable receipt', async () => {
    const tok = await t.login(USERS.layla);
    const s = await t.call('GET', '/api/v1/students/LOF-26-000001', { token: tok });
    expect(s.body.enrollments).toHaveLength(2);
    const rc = await t.call('GET', `/api/v1/payments/${s.body.payments[0].id}/receipt`, { token: tok });
    expect(rc.text).toContain('>Receipt</td>'); // receipt + invoice in the Lab of Future layout
    expect(rc.text).toContain('>Tax Invoice</td>'); // centred tax invoice title
    expect(rc.text).toContain(s.body.payments[0].rc);
  });
  it('lets Reception send a payment link to the parent', async () => {
    t = await setupEasebuzz();
    await useInrFixtures(t, 'KRM');
    const tok = await t.login(USERS.admin);
    const link = await t.call('POST', '/api/v1/payments/links', { token: tok, body: { enrollmentId: 'EN-26-0002' } });
    expect(link.body.provider).toBe('easebuzz');
    expect(link.body.id).toMatch(/^PL-[A-Z2-9]{10}$/); // random, not guessable
    // EN-26-0002 has no lead (walk-in) → sent to the parent on the student record
    const sent = await t.call('POST', `/api/v1/payments/links/${link.body.id}/send`, { token: tok, body: { channel: 'WhatsApp' } });
    expect(sent.body).toMatchObject({ ok: true, status: 'Sent (mock)' });
  });
  it('returns notifications filtered for the role', async () => {
    const r = await t.call('GET', '/api/v1/notifications', { token: await t.login(USERS.layla) });
    expect(r.body.items.every((n: any) => !n.roles || n.roles.includes('Reception'))).toBe(true);
  });
  it('appends the programme code and fee Course ID to the LMS product label', async () => {
    t.env.INTEGRATION_MODE = 'auto';
    t.env.LMS_URL = 'https://lms.test/crm_api.php';
    const repo = new Repo(t.env.DB);
    const order = await doc(t, 'enrollment', 'EN-26-0002');
    const program = await doc(t, 'program', order.prog);
    const student = await doc(t, 'student', order.stu);
    student.email = 'lms-student@example.com';
    student.dob = '2014-05-14';
    student.mobile = '+919876543210';
    await repo.put('student', student);
    await repo.put('fee', { id: 'FEE-LMS-TEST', courseId: 'TERM-042' });
    Object.assign(order, {
      feeId: 'FEE-LMS-TEST',
      payStatus: 'Paid',
      lmsAccess: { items: [{ track: 'FT', credits: ['FC1'] }] },
    });
    await repo.put('enrollment', order);
    await repo.put('moodle_sync', { id: 'MS-LMS-TEST', enr: order.id, stu: student.id, status: 'Retry Required', op: 'enrol' });
    await t.setCfg((cfg) => {
      cfg.integ.lms.on = true;
      cfg.lms.branchMap[order.branch] = 'AW';
    });
    const fetch = stubFetch([[/^https:\/\/lms\.test\/crm_api\.php$/, ({ body }) => {
      const request = JSON.parse(body);
      return request.wsfunction === 'local_lofplatform_erp_catalogue'
        ? { json: { tracks: [{ code: 'FT', credits: [{ code: 'FC1' }] }] } }
        : { json: { accepted: true, inboxid: 42, warnings: [] } };
    }]]);
    const token = await t.login(USERS.admin);
    const item = {
      track: 'FT',
      credits: ['FC1'],
      product_name: `${program.name} – ${order.pkg} (Unique programme code: ${program.code}, Course ID: TERM-042)`,
    };
    const preview = await t.call('GET', `/api/v1/lms/preview/${order.id}`, { token });
    expect(preview.body.enrol.items).toEqual([item]);
    expect(fetch.calls).toHaveLength(0);

    const result = await t.call('POST', '/api/v1/lms/calls/MS-LMS-TEST/retry', { token });
    expect(result.body.status).toBe('Success');
    const sent = fetch.calls.map((call) => JSON.parse(call.body)).find((body) => body.wsfunction === 'local_lofplatform_erp_purchase');
    expect(sent).toMatchObject({ student_id: student.id, items: [item] });
    expect(sent).not.toHaveProperty('course_id');
  });
});

describe('first-call SLA by lead source', () => {
  it('skips the first-call SLA for Manual (walk-in) leads but keeps it for other sources', async () => {
    const tok = await t.login(USERS.hassan);
    const base = { parent: 'Walk In', branch: 'KRM', prog: 'SPA', cat: 'Warm' };
    const manual = await t.call('POST', '/api/v1/leads', { token: tok, body: { ...base, student: 'Manual Kid', phone: '+971 50 444 1001', src: 'Manual' } });
    const web = await t.call('POST', '/api/v1/leads', { token: tok, body: { ...base, student: 'Web Kid', phone: '+971 50 444 1002', src: 'Website' } });
    expect(manual.status).toBe(201);
    expect(web.status).toBe(201);
    const firstCall = async (id: string) => (await t.sql<any>("SELECT data FROM docs WHERE type='task' AND ref1=?", id)).map((r) => JSON.parse(r.data)).filter((x) => x.type === 'First call');
    expect(await firstCall(manual.body.lead.id)).toHaveLength(0);
    expect(await firstCall(web.body.lead.id)).toHaveLength(1);
    // both leads waited 3 hours without a call: only the Website lead breaches and escalates
    const old = new Date(Date.now() - 3 * 3600e3).toISOString();
    for (const id of [manual.body.lead.id, web.body.lead.id]) await t.env.DB.prepare("UPDATE docs SET data=json_set(data,'$.enq',?) WHERE type='lead' AND id=?").bind(old, id).run();
    await cron(t.env, () => {});
    const alerts = (await t.sql<any>("SELECT data FROM docs WHERE type='notification' AND json_extract(data,'$.type')='sla'")).map((r) => JSON.parse(r.data).text).join('\n');
    expect(alerts).toContain(web.body.lead.id);
    expect(alerts).not.toContain(manual.body.lead.id);
    expect((await doc(t, 'lead', manual.body.lead.id)).esc).toBeFalsy();
    expect((await doc(t, 'lead', web.body.lead.id)).esc).toBe(true);
  });
});
