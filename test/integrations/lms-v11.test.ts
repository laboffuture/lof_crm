// Contract and workflow checks against the November guide. All databases are in-memory;
// supplied UAT codes are fixtures, not changes to the user's programme/branch masters.
import { describe, it, expect, afterEach } from 'vitest';
import { vi } from 'vitest';
import { setup, USERS, SECRETS, doc, stubFetch, type TestCtx } from '../helpers/app';
import { Repo } from '../../src/lib/db';
import { processSync, createPaymentLink, settleLink } from '../../src/domain/workflows';
import { lmsEnrolPayload, lmsMissing, lmsProblem } from '../../src/domain/terms';
import { calcFee, feeFor, dayKey } from '../../src/domain/core';
import { catalogue, studentLookup, enrol, type Purchase } from '../../src/integrations/lms';
import { cron } from '../../src/jobs';
import { LMS_CONTRACT } from '../../src/domain/lms-orders';

afterEach(() => vi.unstubAllGlobals());
const accepted = { accepted: true, duplicate: false, inboxid: 15, warnings: [] };
const purchase: Purchase = {
  reference: 'ORD-UAT-1',
  student_id: 'STU-UAT-1',
  student_first_name: 'Test',
  student_last_name: 'Student',
  student_email: 'student@example.com',
  student_phone: '+919800000001',
  student_dob: '2014-05-20',
  branch: 'AW',
  valid_until: '2027-03-31',
  parent_id: 'PAR-UAT-1',
  parent_name: 'Test Parent',
  parent_email: 'parent@example.com',
  parent_phone: '+919800000002',
  items: [
    { track: 'FT', credits: ['FC1', 'FC2'], product_name: 'Falcon, 2 Credits' },
    { track: 'RT', credits: ['C1'] },
  ],
  // Illustrative program code only: the client has not supplied Skills Lab UAT codes yet.
  skillslabs: [{ program: 'SL-TEST', sessions: 4, valid_until: '2027-02-28', product_name: 'Test Lab' }],
};

async function liveFixture() {
  const t = await setup({ INTEGRATION_MODE: 'auto' });
  await t.setCfg((c) => {
    c.integ.lms.on = true;
    c.lms.confirmed = true;
    c.lms.packages = { AI: { 'Term (24 sessions)': { track: 'RT', credits: ['C1', 'C2'] } } };
  });
  await t.sql(
    "UPDATE docs SET data=json_set(data,'$.email','student@example.com') WHERE type='student' AND id='LOF-26-000003'",
  );
  return t;
}

async function newOrder(t: TestCtx, amount: 'none' | 'part' | 'full', withBrowserSync = false) {
  const today = dayKey(new Date());
  const fees = (await t.sql<any>("SELECT data FROM docs WHERE type='fee'")).map((r) => JSON.parse(r.data));
  const fee = feeFor(fees, 'ROB', 'KRM', 'Term (24 sessions)', today);
  const total = calcFee(fee, null, true).total;
  const s = {
    id: 'LOF-26-000700',
    first: 'Test',
    last: 'Student',
    dob: '2014-05-20',
    email: 'student@example.com',
    mobile: '+919800000001',
    branch: 'KRM',
    parents: [{ name: 'Parent', email: 'parent@example.com', mobile: '+919800000002' }],
    status: 'Active',
    comm: [],
  };
  const e = {
    id: 'EN-26-0700',
    stu: s.id,
    prog: 'ROB',
    branch: 'KRM',
    pkg: fee.pkg,
    date: today,
    cur: fee.cur,
    total,
    discInfo: null,
    term: 'PT2',
  };
  const changes: any[] = [
    { coll: 'students', id: s.id, op: 'upsert', doc: s },
    { coll: 'enr', id: e.id, op: 'upsert', doc: e },
  ];
  if (withBrowserSync)
    changes.push({
      coll: 'ms',
      id: 'MS-700',
      op: 'upsert',
      doc: { id: 'MS-700', enr: e.id, stu: s.id, op: 'enrol', payload: { reference: 'FORGED' } },
    });
  if (amount !== 'none')
    changes.push({
      coll: 'pay',
      id: 'PY-26-0700',
      op: 'upsert',
      doc: { id: 'PY-26-0700', enr: e.id, amt: amount === 'full' ? total : total / 2, method: 'Cash' },
    });
  const token = await t.login(USERS.hassan);
  const r = await t.call('PUT', '/api/v1/sync', { token, body: { changes } });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const calls = (await t.sql<any>("SELECT data FROM docs WHERE type='moodle_sync' AND ref1=?", e.id)).map((r) =>
    JSON.parse(r.data),
  );
  expect(calls).toHaveLength(1);
  return { e: await doc(t, 'enrollment', e.id), m: calls[0], token, total };
}

describe('Moodle v1.1 wire contract', () => {
  it('encodes multiple Tracks and Skills Labs, preserves +phones, strips money and redacts tokens', async () => {
    const t = await setup();
    const { calls } = stubFetch([[/lms\.test/, () => ({ json: accepted })]]);
    await enrol({ env: t.env, mode: 'live' }, { ...purchase, amount: 999, invoice: 'DO-NOT-SEND' } as Purchase);
    const body = Object.fromEntries(new URLSearchParams(calls[0].body));
    expect(body).toMatchObject({
      wstoken: SECRETS.LMS_TOKEN,
      wsfunction: 'local_lofplatform_erp_purchase',
      moodlewsrestformat: 'json',
      student_phone: '+919800000001',
      'items[0][track]': 'FT',
      'items[0][credits][1]': 'FC2',
      'items[1][track]': 'RT',
      'skillslabs[0][sessions]': '4',
      'skillslabs[0][valid_until]': '2027-02-28',
    });
    expect(calls[0].headers.authorization).toBeUndefined();
    expect(calls[0].body).not.toMatch(/amount|invoice|DO-NOT-SEND|quantity/);
    const logs = await t.sql<any>('SELECT request,response FROM integration_logs');
    expect(JSON.stringify(logs)).not.toContain(SECRETS.LMS_TOKEN);
    expect(JSON.stringify(logs)).toContain('wstoken=***');
  });

  it('uses the catalogue for connectivity and sends student lookup by permanent ID', async () => {
    const t = await setup();
    const { calls } = stubFetch([
      [
        /lms\.test/,
        (req) => ({
          json: new URLSearchParams(req.body).get('wsfunction')?.endsWith('catalogue')
            ? { tracks: [{ code: 'FT' }, { code: 'RT' }] }
            : { linked: true, orders: 1 },
        }),
      ],
    ]);
    const ctx = { env: t.env, mode: 'live' as const };
    expect((await catalogue(ctx)).tracks).toHaveLength(2);
    await catalogue(ctx, 'FT');
    expect(new URLSearchParams(calls[1].body).get('track')).toBe('FT');
    await studentLookup(ctx, 'STU-UAT-1');
    expect(new URLSearchParams(calls[2].body).get('wsfunction')).toBe('local_lofplatform_erp_student_lookup');
    expect(new URLSearchParams(calls[2].body).get('student_id')).toBe('STU-UAT-1');
  });

  it.each(['invalidtoken', 'invalidparameter'])(
    'does not mark HTTP 200 %s as success or schedule automatic retries',
    async (errorcode) => {
      const t = await liveFixture();
      stubFetch([
        [/lms\.test/, () => ({ json: { exception: 'moodle_exception', errorcode, message: 'Request refused' } })],
      ]);
      const r = await processSync(t.env, new Repo(t.env.DB), 'MS-003');
      expect(r.status).toBe('Retry Required');
      expect(r.err).toContain(errorcode);
      if (errorcode === 'invalidparameter') expect(r.payload).toBeUndefined();
    },
  );

  it('keeps accepted warnings visible and blocks both retry endpoints', async () => {
    const t = await liveFixture();
    const { calls } = stubFetch([
      [
        /lms\.test/,
        () => ({ json: { ...accepted, warnings: [{ item: 'items[0].credits', message: 'Unknown Credit code' }] } }),
      ],
    ]);
    const r = await processSync(t.env, new Repo(t.env.DB), 'MS-003');
    expect(r.status).toBe('Warnings');
    expect(r.response.inboxid).toBe(15);
    expect(r.err).toContain('Unknown Credit code');
    const token = await t.login(USERS.admin);
    expect((await t.call('POST', '/api/v1/lms/calls/MS-003/retry', { token })).status).toBe(409);
    expect(
      (
        await t.call('PUT', '/api/v1/sync', {
          token,
          body: { changes: [{ coll: 'ms', id: r.id, op: 'upsert', base: r, doc: { ...r, status: 'Pending' } }] },
        })
      ).status,
    ).toBe(409);
    await processSync(t.env, new Repo(t.env.DB), r.id);
    expect(calls).toHaveLength(1);
  });

  it('accepts duplicate receipts without applying the order again', async () => {
    const t = await liveFixture();
    const { calls } = stubFetch([[/lms\.test/, () => ({ json: { ...accepted, duplicate: true } })]]);
    const repo = new Repo(t.env.DB);
    expect((await processSync(t.env, repo, 'MS-003')).status).toBe('Success');
    await processSync(t.env, repo, 'MS-003');
    expect(calls).toHaveLength(1);
  });

  it('freezes timeout retries even if profiles, mappings or expiry settings change', async () => {
    const t = await liveFixture();
    let first = true;
    const { calls } = stubFetch([
      [/lms\.test/, () => (first ? ((first = false), { status: 503, json: {} }) : { json: accepted })],
    ]);
    const repo = new Repo(t.env.DB);
    expect((await processSync(t.env, repo, 'MS-003')).status).toBe('Failed');
    await t.setCfg((c) => {
      c.lms.packages.AI['Term (24 sessions)'].credits = ['C1'];
      c.lms.validMonths = 1;
    });
    await t.sql(
      "UPDATE docs SET data=json_set(data,'$.email','changed@example.com') WHERE type='student' AND id='LOF-26-000003'",
    );
    expect((await processSync(t.env, repo, 'MS-003')).status).toBe('Success');
    expect(calls[1].body).toBe(calls[0].body);
  });

  it('treats HTML as an uncertain delivery and preserves the retry snapshot', async () => {
    const t = await liveFixture();
    stubFetch([[/lms\.test/, () => ({ text: '<html>Log in</html>' })]]);
    const r = await processSync(t.env, new Repo(t.env.DB), 'MS-003');
    expect(r.status).toBe('Failed');
    expect(r.payload.reference).toBe('EN-26-0003');
  });

  it('shows purchaseknown:false as a cancellation warning', async () => {
    const t = await liveFixture();
    const repo = new Repo(t.env.DB),
      m = await repo.get<any>('moodle_sync', 'MS-003');
    await repo.put('moodle_sync', { ...m, op: 'cancel' });
    stubFetch([[/lms\.test/, () => ({ json: { ...accepted, purchaseknown: false } })]]);
    const r = await processSync(t.env, repo, m.id);
    expect(r.status).toBe('Warnings');
    expect(r.err).toContain('has not received');
  });

  it('never simulates delivery for a real production order with missing setup', async () => {
    const t = await liveFixture();
    t.env.APP_ENV = 'production';
    t.env.LMS_TOKEN = '';
    const { calls } = stubFetch([]);
    expect((await processSync(t.env, new Repo(t.env.DB), 'MS-003')).status).toBe('Awaiting Setup');
    expect(calls).toHaveLength(0);
  });

  it('claims concurrent manual retries atomically', async () => {
    const t = await liveFixture();
    const { calls } = stubFetch([[/lms\.test/, () => ({ json: accepted })]]);
    const token = await t.login(USERS.admin);
    const results = await Promise.all([
      t.call('POST', '/api/v1/lms/calls/MS-003/retry', { token }),
      t.call('POST', '/api/v1/lms/calls/MS-003/retry', { token }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(calls).toHaveLength(1);
  });

  it('allows corrected data after an explicit not-received invalidparameter response', async () => {
    const t = await liveFixture();
    let first = true;
    const { calls } = stubFetch([
      [
        /lms\.test/,
        () =>
          first
            ? ((first = false), { json: { errorcode: 'invalidparameter', message: 'Bad email' } })
            : { json: accepted },
      ],
    ]);
    const repo = new Repo(t.env.DB);
    expect((await processSync(t.env, repo, 'MS-003')).status).toBe('Retry Required');
    await t.sql(
      "UPDATE docs SET data=json_set(data,'$.email','corrected@example.com') WHERE type='student' AND id='LOF-26-000003'",
    );
    expect((await processSync(t.env, repo, 'MS-003')).status).toBe('Success');
    expect(new URLSearchParams(calls[1].body).get('reference')).toBe(
      new URLSearchParams(calls[0].body).get('reference'),
    );
    expect(new URLSearchParams(calls[1].body).get('student_email')).toBe('corrected@example.com');
  });

  it('claims a job atomically when two workers try the same order', async () => {
    const t = await liveFixture();
    const { calls } = stubFetch([[/lms\.test/, () => ({ json: accepted })]]);
    await Promise.all([
      processSync(t.env, new Repo(t.env.DB), 'MS-003'),
      processSync(t.env, new Repo(t.env.DB), 'MS-003'),
    ]);
    expect(calls).toHaveLength(1);
  });
});

describe('Paid-order lifecycle without historical backfill', () => {
  it.each(['none', 'part'] as const)(
    'waits with %s payment, creates its own sync record, and sends after the balance is paid',
    async (amount) => {
      const t = await setup();
      const { e, m, total } = await newOrder(t, amount, amount === 'part');
      expect(m.status).toBe('Awaiting Payment');
      expect(m.attempts).toBe(0);
      expect(m.payload).toBeUndefined();
      const payment = { id: 'PY-26-0701', enr: e.id, amt: amount === 'part' ? total / 2 : total, method: 'Cash' };
      const r = await t.call('PUT', '/api/v1/sync', {
        token: await t.login(USERS.layla),
        body: { changes: [{ coll: 'pay', id: payment.id, op: 'upsert', doc: payment }] },
      });
      expect(r.status).toBe(200);
      expect((await doc(t, 'moodle_sync', m.id)).status).toBe('Success');
    },
  );

  it('sends a fully paid new enrolment without relying on a browser-supplied sync record', async () => {
    const t = await setup();
    const { m } = await newOrder(t, 'full');
    expect(m.status).toBe('Success');
    expect(m.contract).toBe(LMS_CONTRACT);
  });

  it('activates the same pending order when a gateway settles the balance', async () => {
    const t = await setup();
    const { e, m } = await newOrder(t, 'none');
    const repo = new Repo(t.env.DB);
    const link = await createPaymentLink(t.env, repo, e.id, undefined, 'Test');
    await settleLink(t.env, repo, link.id, { amount: link.amount, txnRef: 'TXN-TEST', method: 'Card' });
    expect((await doc(t, 'moodle_sync', m.id)).status).toBe('Success');
  });

  it('does not create an LMS purchase when an old enrolment receives a payment', async () => {
    const t = await setup();
    const before = await t.sql("SELECT id FROM docs WHERE type='moodle_sync'");
    const e = await doc(t, 'enrollment', 'EN-26-0002');
    const p = { id: 'PY-26-0700', enr: e.id, amt: e.total - e.paid, method: 'Cash' };
    await t.call('PUT', '/api/v1/sync', {
      token: await t.login(USERS.layla),
      body: { changes: [{ coll: 'pay', id: p.id, op: 'upsert', doc: p }] },
    });
    expect(await t.sql("SELECT id FROM docs WHERE type='moodle_sync'")).toEqual(before);
  });

  it('recovers an interrupted new-contract job while leaving legacy failed calls unchanged', async () => {
    const t = await setup();
    const repo = new Repo(t.env.DB);
    const { e, m } = await newOrder(t, 'none');
    await repo.put('enrollment', { ...e, payStatus: 'Paid', paid: e.total });
    await repo.put('moodle_sync', { ...m, status: 'Processing', attempts: 1, processingAt: '2026-01-01T00:00:00Z' });
    await t.setCfg((c) => {
      c.integ.lms.retryMin = 0;
    });
    const legacy = await doc(t, 'moodle_sync', 'MS-003');
    const jobs: Promise<unknown>[] = [];
    await cron(t.env, (p) => jobs.push(p));
    expect((await doc(t, 'moodle_sync', m.id)).status).toBe('Failed');
    await cron(t.env, (p) => jobs.push(p));
    await Promise.all(jobs);
    expect((await doc(t, 'moodle_sync', m.id)).status).toBe('Success');
    expect(await doc(t, 'moodle_sync', legacy.id)).toEqual(legacy);
  });
});

describe('Entitlement and identity validation', () => {
  it('blocks equal student/parent emails and never uses the parent as student login', () => {
    expect(lmsMissing({ ...purchase, student_email: ' PARENT@example.com ' })).toContain(
      'student_email must differ from parent_email',
    );
    const p = lmsEnrolPayload(
      { id: 'E', prog: 'P', pkg: 'Term', branch: 'B', date: '2026-11-11' },
      { id: 'S', parents: [{ email: 'parent@example.com' }] },
      {},
      {},
    );
    expect(p.student_email).toBe('');
  });
  it('validates actual calendar dates and positive whole Skills Lab sessions', () => {
    expect(lmsMissing({ ...purchase, student_dob: '2014-02-30' })).toContain('valid student_dob (YYYY-MM-DD)');
    expect(lmsMissing({ ...purchase, items: [], skillslabs: [{ program: 'SL-TEST', sessions: 1.5 }] })).toContain(
      'skillslabs[0].sessions',
    );
    expect(
      lmsProblem({
        validMonths: 12,
        programmes: {},
        packages: { P: { Trial: { skillslabs: [{ program: 'SL-TEST', sessions: 0 }] } } },
      }),
    ).toMatch(/positive whole/);
  });
  it('selects exact package entitlements and permits Skills Lab-only purchases', () => {
    const L = {
      validMonths: 12,
      packages: {
        P: {
          Trial: { skillslabs: [{ program: 'SL-TEST', sessions: 2 }] },
          Term: { track: 'FT', credits: ['FC1', 'FC2'] },
        },
      },
    };
    const e = { id: 'E', prog: 'P', pkg: 'Trial', branch: 'B', date: '2026-11-11' };
    const s = {
      id: 'S',
      first: 'Test',
      last: 'Student',
      email: 'student@example.com',
      mobile: '+919800000001',
      dob: '2014-05-20',
      parents: [],
    };
    const p = lmsEnrolPayload(e, s, {}, { ...L, branchMap: { B: 'AW' } });
    expect(p.items).toEqual([]);
    expect(p.skillslabs[0].sessions).toBe(2);
    expect(lmsMissing(p)).toEqual([]);
    expect(lmsEnrolPayload({ ...e, pkg: 'Term' }, s, {}, L).items[0].credits).toEqual(['FC1', 'FC2']);
  });
});
