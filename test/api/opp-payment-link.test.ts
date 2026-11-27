// Payment link shared from an opportunity (30% / 70% stages): the enrolment form is filled in when the link is
// shared, nothing is enrolled until the parent pays, and the payment enrols the student automatically.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupEasebuzz, useInrFixtures, USERS, doc } from '../helpers/app';
import { calcFee, feeFor } from '../../src/domain/core';

let t: Awaited<ReturnType<typeof setupEasebuzz>>;
beforeEach(async () => { t = await setupEasebuzz(); await useInrFixtures(t, 'KRM'); });
afterEach(() => vi.unstubAllGlobals());
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });

async function openOpp(stage: string) {
  const opps = (await t.sql<any>("SELECT data FROM docs WHERE type='opp'")).map((r) => JSON.parse(r.data));
  const o = opps.find((x) => x.stage === stage && x.branch === 'KRM');
  expect(o, `a ${stage} opportunity at Al Karama in the seed`).toBeTruthy();
  return o;
}

/** The changes the enrolment form produces for a new student on this opportunity (as the screen sends them). */
async function linkForm(o: any, term: string, n = 701) {
  const fees = (await t.sql<any>("SELECT data FROM docs WHERE type='fee'")).map((r) => JSON.parse(r.data));
  const fee = feeFor(fees, o.prog, o.branch, o.pkg, today());
  const c = calcFee(fee, null, true);
  const s = { id: `LOF-26-000${n}`, first: 'Tara', last: 'Joseph', dob: '2014-02-02', branch: o.branch, fam: `FAM-26-0${n}`, parents: [{ name: 'Joe Joseph', rel: 'Father', email: 'joe@example.com', mobile: '+971 50 111 3333' }], status: 'Active', comm: [] };
  const e = { id: `EN-26-0${n}`, stu: s.id, prog: o.prog, branch: o.branch, pkg: fee.pkg, date: today(), status: 'Active', cur: fee.cur, total: c.total, discInfo: null, term, opp: o.id };
  const m = { id: `MS-${n}`, enr: e.id, stu: s.id, op: 'enrol' };
  const od = { ...o, stage: 'Enrolled', stu: s.id, next: '', decision: 'Accepted', hist: [...(o.hist || []), { at: new Date().toISOString(), by: 'Priya', text: `Enrolled – ${s.id} / ${e.id}` }] };
  const lead = JSON.parse((await t.sql<any>("SELECT data FROM docs WHERE type='lead' AND id=?", o.lead))[0].data);
  const ld = { ...lead, events: [...(lead.events || []), { at: new Date().toISOString(), type: 'sys', text: `Enrolled as ${s.id} (${e.id})`, by: 'Priya' }] };
  const changes = [
    { coll: 'leads', id: lead.id, op: 'upsert', doc: ld, base: lead },
    { coll: 'opps', id: o.id, op: 'upsert', doc: od, base: o },
    { coll: 'students', id: s.id, op: 'upsert', doc: s },
    { coll: 'enr', id: e.id, op: 'upsert', doc: e },
    { coll: 'ms', id: m.id, op: 'upsert', doc: m },
  ];
  return { changes, total: c.total, s, e };
}
const share = async (email: string, oppId: string, body: any) => t.call('POST', `/api/v1/opps/${oppId}/payment-link`, { token: await t.login(email), body });
const pay = (linkId: string) => t.pay(linkId);

describe('payment link from an opportunity', () => {
  it('at the 30% stage: shares the first instalment, enrols nobody until the parent pays, then enrols once', async () => {
    const o = await openOpp('Opportunity');
    const f = await linkForm(o, 'PT3');
    const r = await share(USERS.priya, o.id, { changes: f.changes, amount: Math.round(f.total * 40) / 100 });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ opp: o.id, enrollment: f.e.id, full: false });
    expect(r.body.amount).toBeCloseTo(f.total * 0.4, 2);
    // nothing is enrolled yet
    expect(await doc(t, 'student', f.s.id)).toBeNull();
    expect(await doc(t, 'enrollment', f.e.id)).toBeNull();
    expect((await doc(t, 'opp', o.id)).stage).toBe('Opportunity');
    const list = await t.call('GET', `/api/v1/opps/${o.id}/payment-links`, { token: await t.login(USERS.priya) });
    expect(list.body.items.map((x: any) => x.status)).toEqual(['created']);

    await t.call('GET', `/webhooks/pay/return?link=${r.body.id}&mock=1`);
    expect(await doc(t, 'enrollment', f.e.id)).toBeNull();
    expect((await pay(r.body.id)).body).toMatchObject({ ok: true, status: 'paid' });
    const e = await doc(t, 'enrollment', f.e.id);
    expect(e).toMatchObject({ status: 'Active', opp: o.id, term: 'PT3', payStatus: 'Partially paid', date: today() });
    expect(e.paid).toBeCloseTo(r.body.amount, 2);
    expect(e.sched.map((x: any) => x.pct)).toEqual([40, 30, 30]);
    expect((await doc(t, 'student', f.s.id)).parents[0].email).toBe('joe@example.com');
    const opp = await doc(t, 'opp', o.id);
    expect(opp).toMatchObject({ stage: 'Enrolled', stu: f.s.id, decision: 'Accepted' });
    expect(opp.hist.some((h: any) => /Payment link .* shared/.test(h.text))).toBe(true); // link history kept after enrolment
    expect(await doc(t, 'moodle_sync', 'MS-701')).toMatchObject({ op: 'enrol', enr: f.e.id });
    const pays = (await t.sql<any>("SELECT data FROM docs WHERE type='payment' AND ref1=?", f.e.id)).map((x) => JSON.parse(x.data));
    expect(pays).toHaveLength(1);
    expect(pays[0].gateway.link).toBe(r.body.id);
    // the parent coming back to the page does not enrol or charge twice
    await pay(r.body.id);
    expect((await t.sql("SELECT id FROM docs WHERE type='payment' AND ref1=?", f.e.id)).length).toBe(1);
    expect((await t.sql("SELECT id FROM docs WHERE type='enrollment' AND json_extract(data,'$.opp')=?", o.id)).length).toBe(1);
  });

  it('at the 70% stage: the full fee pays the enrolment in full', async () => {
    const o = await openOpp('Admission Decision');
    const f = await linkForm(o, 'PT1', 702);
    const r = await share(USERS.hassan, o.id, { changes: f.changes, amount: f.total });
    expect(r.status).toBe(201);
    expect(r.body.full).toBe(true);
    await pay(r.body.id);
    expect(await doc(t, 'enrollment', f.e.id)).toMatchObject({ payStatus: 'Paid', status: 'Active' });
    expect((await doc(t, 'opp', o.id)).stage).toBe('Enrolled');
  });

  it('checks the form when the link is shared', async () => {
    const o = await openOpp('Opportunity');
    const f = await linkForm(o, 'PT3');
    f.changes.find((c) => c.coll === 'enr')!.doc.total = 1; // tampered fee
    const r = await share(USERS.priya, o.id, { changes: f.changes });
    expect(r.status).toBe(422);
    expect(r.body.error).toMatch(/Fee mismatch/);
    expect(await t.sql('SELECT id FROM payment_links WHERE opp_id=?', o.id)).toHaveLength(0);
    const g = await linkForm(o, 'PT3');
    expect((await share(USERS.priya, o.id, { changes: g.changes, amount: g.total + 1 })).status).toBe(422);
    expect((await share(USERS.priya, o.id, { changes: g.changes.filter((c) => c.coll !== 'enr') })).status).toBe(422);
  });

  it('only staff who work on opportunities, enrolments or payments can share, inside their branches', async () => {
    const o = await openOpp('Opportunity');
    const f = await linkForm(o, 'PT3');
    expect((await share(USERS.khalid, o.id, { changes: f.changes })).status).toBe(403); // Management: view only
    expect((await share(USERS.fatima, o.id, { changes: f.changes })).status).toBe(403); // Sports City counsellor
  });

  it('asks the centre to finish by hand when the opportunity was lost before the parent paid', async () => {
    const o = await openOpp('Opportunity');
    const f = await linkForm(o, 'PT3');
    const r = await share(USERS.priya, o.id, { changes: f.changes });
    expect(r.status).toBe(201);
    await t.d1.prepare("UPDATE docs SET data=json_set(data,'$.stage','Lost') WHERE type='opp' AND id=?").bind(o.id).run();
    await pay(r.body.id);
    expect(await doc(t, 'enrollment', f.e.id)).toBeNull();
    const link = (await t.sql<any>('SELECT status, apply_error FROM payment_links WHERE id=?', r.body.id))[0];
    expect(link.status).toBe('paid');
    expect(link.apply_error).toMatch(/lost/);
    const n = await t.sql<any>("SELECT data FROM docs WHERE type='notification' AND json_extract(data,'$.text') LIKE ?", `%${r.body.id}%could not be enrolled%`);
    expect(n).toHaveLength(1);
  });

  it('a newer link replaces the open one, and the open link can be sent to the parent', async () => {
    const o = await openOpp('Opportunity');
    const a = await share(USERS.priya, o.id, { changes: (await linkForm(o, 'PT3')).changes });
    const b = await share(USERS.priya, o.id, { changes: (await linkForm(o, 'PT1', 703)).changes });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const rows = await t.sql<any>('SELECT id,status FROM payment_links WHERE opp_id=?', o.id);
    expect(Object.fromEntries(rows.map((x: any) => [x.id, x.status]))).toEqual({ [a.body.id]: 'replaced', [b.body.id]: 'created' });
    const send = await t.call('POST', `/api/v1/payments/links/${b.body.id}/send`, { token: await t.login(USERS.priya), body: { channel: 'Email' } });
    expect(send.status).toBe(200);
  });
});

describe('payment link validity', () => {
  const open = (id: string) => t.call('GET', `/webhooks/pay/l/${id}`);
  const collectLink = async (enr = 'EN-26-0002') => (await t.call('POST', '/api/v1/payments/links', { token: await t.login(USERS.admin), body: { enrollmentId: enr } })).body;

  it('forwards to the gateway while open, then says "Payment already done" once paid', async () => {
    const l = await collectLink();
    expect(l.url).toMatch(new RegExp(`/webhooks/pay/l/${l.id}$`));
    const first = await open(l.id);
    expect(first.status).toBe(302);
    await t.pay(l.id); // the parent pays
    const again = await open(l.id);
    expect(again.status).toBe(200);
    expect(again.text).toContain('Payment already done');
  });

  it('expires 24 hours after it was shared', async () => {
    const l = await collectLink();
    const row = (await t.sql<any>('SELECT expires_at, kind FROM payment_links WHERE id=?', l.id))[0];
    expect(row.kind).toBe('collect');
    expect(Date.parse(row.expires_at) - Date.now()).toBeGreaterThan(23.9 * 36e5);
    expect(Date.parse(row.expires_at) - Date.now()).toBeLessThan(24.1 * 36e5);
    await t.sql("UPDATE payment_links SET expires_at='2020-01-01T00:00:00.000Z' WHERE id=?", l.id);
    const r = await open(l.id);
    expect(r.text).toContain('Payment link expired');
    expect((await t.sql<any>('SELECT status FROM payment_links WHERE id=?', l.id))[0].status).toBe('expired');
    const send = await t.call('POST', `/api/v1/payments/links/${l.id}/send`, { token: await t.login(USERS.admin), body: { channel: 'Email' } });
    expect(send.status).toBe(409);
    expect(send.body.error).toMatch(/expired/);
  });

  it('expired links are closed by the background job too', async () => {
    const l = await collectLink();
    await t.sql("UPDATE payment_links SET expires_at='2020-01-01T00:00:00.000Z' WHERE id=?", l.id);
    const { cron } = await import('../../src/jobs');
    await cron(t.env, () => {});
    expect((await t.sql<any>('SELECT status FROM payment_links WHERE id=?', l.id))[0].status).toBe('expired');
  });

  it('instalment reminders carry a link with no time limit that stays open until the next reminder', async () => {
    const { reminderLink } = await import('../../src/domain/workflows');
    const { Repo } = await import('../../src/lib/db');
    const repo = new Repo(t.env.DB, 'Email automation');
    const a = await reminderLink(t.env, repo, 'EN-26-0002', 100);
    const rowA = (await t.sql<any>('SELECT expires_at, kind, status FROM payment_links WHERE id=?', a.id))[0];
    expect(rowA).toMatchObject({ expires_at: null, kind: 'reminder', status: 'created' });
    expect((await open(a.id)).status).toBe(302); // still open, days later
    const b = await reminderLink(t.env, repo, 'EN-26-0002', 100); // the next reminder goes out
    expect((await t.sql<any>('SELECT status FROM payment_links WHERE id=?', a.id))[0].status).toBe('replaced');
    const old = await open(a.id);
    expect(old.text).toContain('Payment link expired');
    expect(old.text).toContain('newer link');
    expect((await open(b.id)).status).toBe(302);
  });
});
