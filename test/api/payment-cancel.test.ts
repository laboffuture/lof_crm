// Transaction cancellation: a payment taken by mistake is cancelled (never deleted). It keeps its receipt number,
// records the parent's knowledge and the reason, drops out of the paid amount and totals, and cannot be undone.
import { describe, it, expect, beforeEach } from 'vitest';
import { setup, USERS, doc, type TestCtx } from '../helpers/app';
import { loadBillingDoc } from '../../src/domain/billing-docs';
import { Repo } from '../../src/lib/db';

let t: TestCtx;
beforeEach(async () => { t = await setup(); });
const cancel = async (id: string, body: any, email = USERS.admin) => t.call('POST', `/api/v1/payments/${id}/cancel`, { token: await t.login(email), body });
const firstPayment = async () => {
  const p = (await t.sql<any>("SELECT data FROM docs WHERE type='payment' AND is_test=0 AND branch='KRM' ORDER BY id LIMIT 1")).map((x) => JSON.parse(x.data))[0];
  expect(p).toBeTruthy();
  return p;
};
const ok = { parentAware: 'Yes', reason: 'Wrong course selected – parent wanted Robotics', confirm: true };

describe('transaction cancellation', () => {
  it('cancels instead of deleting: receipt number kept, amount out of the paid total, reason and parent answer recorded', async () => {
    const p = await firstPayment();
    const before = await doc(t, 'enrollment', p.enr);
    const r = await cancel(p.id, ok);
    expect(r.status).toBe(200);
    const after = await doc(t, 'payment', p.id);
    expect(after).toMatchObject({ status: 'Cancelled', rc: p.rc, amt: p.amt });
    expect(after.cancel).toMatchObject({ parentAware: 'Yes', reason: ok.reason, by: expect.any(String) });
    const e = await doc(t, 'enrollment', p.enr);
    expect(e.paid).toBeCloseTo(before.paid - p.amt, 2);
    expect(e.payStatus).toBe(e.paid > 0 ? 'Partially paid' : 'Unpaid');
    const audit = await t.sql<any>("SELECT data FROM docs WHERE type='audit' AND json_extract(data,'$.act')='Payment cancelled' AND json_extract(data,'$.ref')=?", p.id);
    expect(audit).toHaveLength(1);
    // the receipt and invoice keep their numbers and say Cancelled
    const d = await loadBillingDoc(new Repo(t.env.DB), p.id);
    expect(d!.receiptNo).toBe(p.rc);
    expect(d!.cancelled?.reason).toBe(ok.reason);
    expect((await t.call('GET', `/api/v1/payments/${p.id}/receipt.pdf`, { token: await t.login(USERS.admin) })).status).toBe(200);
  });

  it('needs both answers and the final confirmation', async () => {
    const p = await firstPayment();
    expect((await cancel(p.id, { ...ok, parentAware: undefined })).body.error).toMatch(/parent's knowledge/);
    expect((await cancel(p.id, { ...ok, reason: 'oops' })).body.error).toMatch(/reason/);
    expect((await cancel(p.id, { ...ok, confirm: false })).body.error).toMatch(/cannot be undone/);
    expect((await doc(t, 'payment', p.id)).status).not.toBe('Cancelled');
  });

  it('is final: a cancelled transaction cannot be cancelled again or restored', async () => {
    const p = await firstPayment();
    await cancel(p.id, { ...ok, parentAware: 'No' });
    expect((await cancel(p.id, ok)).status).toBe(409);
    const restore = () => t.d1.prepare("UPDATE docs SET data=json_set(data,'$.status','Recorded') WHERE type='payment' AND id=?").bind(p.id).run();
    await expect(restore()).rejects.toThrow(/immutable payment/);
    const del = () => t.d1.prepare("DELETE FROM docs WHERE type='payment' AND id=?").bind(p.id).run();
    await expect(del()).rejects.toThrow(/immutable payment/);
  });

  it('frees the amount: the right payment can be taken again without an overpayment error', async () => {
    const p = await firstPayment();
    const e0 = await doc(t, 'enrollment', p.enr);
    await cancel(p.id, ok);
    const open = e0.total - e0.paid + p.amt;
    const l = await t.call('POST', '/api/v1/payments/links', { token: await t.login(USERS.admin), body: { enrollmentId: p.enr, amount: Math.round(open * 100) / 100 } });
    expect(l.status).toBe(201);
    await t.call('GET', `/webhooks/pay/return?link=${l.body.id}&mock=1`);
    expect((await doc(t, 'enrollment', p.enr)).payStatus).toBe('Paid');
  });

  it('only payment staff can cancel, within their branches', async () => {
    const p = await firstPayment();
    expect((await cancel(p.id, ok, USERS.priya)).status).toBe(403); // Counsellor
    expect((await cancel(p.id, ok, USERS.khalid)).status).toBe(403); // Management: view only
  });
});
