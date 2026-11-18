// Payments → Payment links: who each link went to, who created / sent it, and whether the parent paid.
// Counsellors see only their own links.
import { describe, it, expect, beforeEach } from 'vitest';
import { setup, USERS, type TestCtx } from '../helpers/app';
import { calcFee, feeFor } from '../../src/domain/core';

let t: TestCtx;
beforeEach(async () => { t = await setup(); });
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
const list = async (email: string) => t.call('GET', '/api/v1/payments/link-list', { token: await t.login(email) });

/** An opportunity payment link shared by `email` (same form the screen sends). */
async function oppLink(email: string, n: number) {
  const o = (await t.sql<any>("SELECT data FROM docs WHERE type='opp'")).map((r) => JSON.parse(r.data)).find((x) => x.stage === 'Opportunity' && x.branch === 'KRM');
  const fees = (await t.sql<any>("SELECT data FROM docs WHERE type='fee'")).map((r) => JSON.parse(r.data));
  const fee = feeFor(fees, o.prog, o.branch, o.pkg, today());
  const c = calcFee(fee, null, true);
  const s = { id: `LOF-26-000${n}`, first: 'List', last: `Kid${n}`, dob: '2014-02-02', branch: o.branch, fam: `FAM-26-0${n}`, parents: [{ name: 'List Parent', rel: 'Father', email: `list${n}@example.com`, mobile: '+971 50 111 3333' }], status: 'Active', comm: [] };
  const e = { id: `EN-26-0${n}`, stu: s.id, prog: o.prog, branch: o.branch, pkg: fee.pkg, date: today(), status: 'Active', cur: fee.cur, total: c.total, discInfo: null, term: 'PT1', opp: o.id };
  const changes = [
    { coll: 'students', id: s.id, op: 'upsert', doc: s }, { coll: 'enr', id: e.id, op: 'upsert', doc: e },
    { coll: 'ms', id: `MS-${n}`, op: 'upsert', doc: { id: `MS-${n}`, enr: e.id, stu: s.id, op: 'enrol' } },
    { coll: 'opps', id: o.id, op: 'upsert', doc: { ...o, stage: 'Enrolled', stu: s.id, decision: 'Accepted' }, base: o },
  ];
  const r = await t.call('POST', `/api/v1/opps/${o.id}/payment-link`, { token: await t.login(email), body: { changes, amount: c.total } });
  expect(r.status).toBe(201);
  return { link: r.body, opp: o };
}

describe('payment links list', () => {
  it('shows the recipient, the sender and whether it was paid; counsellors see only their own links', async () => {
    const mine = await oppLink(USERS.priya, 801); // counsellor
    const send = await t.call('POST', `/api/v1/payments/links/${mine.link.id}/send`, { token: await t.login(USERS.priya), body: { channel: 'WhatsApp' } });
    expect(send.status).toBe(200);
    const theirs = (await t.call('POST', '/api/v1/payments/links', { token: await t.login(USERS.admin), body: { enrollmentId: 'EN-26-0002' } })).body;

    const p = await list(USERS.priya);
    expect(p.status).toBe(200);
    expect(p.body.own).toBe(true);
    expect(p.body.items.map((x: any) => x.id)).toEqual([mine.link.id]); // not the administrator's link
    const row = p.body.items[0];
    expect(row).toMatchObject({ kind: 'opp', status: 'created', createdBy: expect.any(String), sentVia: 'WhatsApp', sends: 1, opp: mine.opp.id });
    expect(row.parent).toBeTruthy();
    expect(row.sentTo).toBeTruthy();
    expect(row.url).toContain(`/webhooks/pay/l/${mine.link.id}`);

    const a = await list(USERS.admin);
    expect(a.body.own).toBe(false);
    expect(a.body.items.map((x: any) => x.id)).toEqual(expect.arrayContaining([mine.link.id, theirs.id]));
    expect(a.body.items.find((x: any) => x.id === theirs.id)).toMatchObject({ kind: 'collect', sentAt: null, enrollment: 'EN-26-0002' });

    // the parent pays: the list says so, with the receipt number
    await t.call('GET', `/webhooks/pay/return?link=${mine.link.id}&mock=1`);
    const after = (await list(USERS.priya)).body.items[0];
    expect(after.status).toBe('paid');
    expect(after.receipt).toMatch(/^RC-KRM-26-\d{4}$/);
    expect(after.studentId).toBe('LOF-26-000801');
  });

  it('keeps other branches out', async () => {
    await oppLink(USERS.hassan, 802); // Al Karama
    expect((await list(USERS.fatima)).body.items).toHaveLength(0); // Sports City counsellor
    expect((await list(USERS.khalid)).status).toBe(200); // Management can view payments
  });

  it('records reminder links as sent by the payment reminder', async () => {
    const { reminderLink } = await import('../../src/domain/workflows');
    const { Repo } = await import('../../src/lib/db');
    const l = await reminderLink(t.env, new Repo(t.env.DB, 'Email automation'), 'EN-26-0002', 50);
    const row = (await list(USERS.admin)).body.items.find((x: any) => x.id === l.id);
    expect(row).toMatchObject({ kind: 'reminder', sentBy: 'Payment reminder', sentVia: 'Email', expiresAt: null });
  });
});
