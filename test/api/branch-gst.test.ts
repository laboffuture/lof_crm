// Branch GST (India): GSTIN, PAN, CGST % and SGST % set by the administrator on the branch; new fees are charged at
// CGST + SGST and the tax invoice shows the GSTIN, the PAN and the CGST / SGST lines.
import { describe, it, expect, beforeEach } from 'vitest';
import { setup, USERS, doc, type TestCtx } from '../helpers/app';
import { calcFee, gstProblem } from '../../src/domain/core';
import { loadBillingDoc, docHtml, invoicePdf, receiptPdf } from '../../src/domain/billing-docs';
import { writeFileSync } from 'node:fs';
import { Repo } from '../../src/lib/db';

let t: TestCtx;
beforeEach(async () => { t = await setup(); });
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
const sync = async (email: string, changes: any[]) => t.call('PUT', '/api/v1/sync', { token: await t.login(email), body: { changes } });
const GST = { gstin: '29ABCDE1234F1Z5', pan: 'ABCDE1234F', cgst: 6, sgst: 6 };
async function setBranchGst(email: string, extra: any = GST) {
  const b = await doc(t, 'branch', 'BLR');
  return sync(email, [{ coll: 'branches', id: 'BLR', op: 'upsert', doc: { ...b, ...extra }, base: b }]);
}

describe('branch GST', () => {
  it('the administrator saves GSTIN, PAN, CGST and SGST on the branch', async () => {
    const r = await setBranchGst(USERS.admin, { gstin: ' 29abcde1234f1z5 ', pan: 'abcde1234f', cgst: '6', sgst: 6 });
    expect(r.status).toBe(200);
    expect(await doc(t, 'branch', 'BLR')).toMatchObject({ gstin: '29ABCDE1234F1Z5', pan: 'ABCDE1234F', cgst: 6, sgst: 6 });
  });

  it('checks the GSTIN, the PAN and the rates', async () => {
    expect((await setBranchGst(USERS.admin, { ...GST, gstin: '29ABC' })).body.error).toMatch(/GSTIN must be 15/);
    expect((await setBranchGst(USERS.admin, { ...GST, pan: 'ZZZZZ9999Z' })).body.error).toMatch(/PAN does not match/);
    expect((await setBranchGst(USERS.admin, { ...GST, sgst: '' })).body.error).toMatch(/both CGST and SGST/);
    expect((await setBranchGst(USERS.admin, { ...GST, cgst: 80 })).body.error).toMatch(/0 to 50/);
    expect(gstProblem(GST)).toBe('');
  });

  it('only those who can edit configuration change it', async () => {
    const r = await setBranchGst(USERS.deepa); // Admissions Head, India
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/cannot change configuration/);
  });

  it('new enrolments at the branch are charged CGST + SGST', async () => {
    await setBranchGst(USERS.admin);
    const branch = await doc(t, 'branch', 'BLR');
    const fees = (await t.sql<any>("SELECT data FROM docs WHERE type='fee'")).map((r) => JSON.parse(r.data));
    const fee = fees.find((f) => f.branch === 'BLR' && f.active && branch.programs.includes(f.prog) && f.from <= today());
    expect(fee).toBeTruthy();
    expect(fee.tax).not.toBe(12); // the fee's own tax % is replaced by CGST 6 + SGST 6
    const atGst = calcFee(fee, null, true, branch);
    expect(atGst.taxPct).toBe(12);
    const s = { id: 'LOF-26-000901', first: 'Gst', last: 'Kid', dob: '2014-02-02', branch: 'BLR', fam: 'FAM-26-0901', parents: [{ name: 'Gst Parent', rel: 'Father', email: 'gst@example.com', mobile: '+91 98 4000 0001' }], status: 'Active', comm: [] };
    const e = { id: 'EN-26-0901', stu: s.id, prog: fee.prog, branch: 'BLR', pkg: fee.pkg, date: today(), status: 'Active', cur: fee.cur, total: calcFee(fee, null, true).total, discInfo: null, term: 'PT1' };
    const old = await sync(USERS.deepa, [{ coll: 'students', id: s.id, op: 'upsert', doc: s }, { coll: 'enr', id: e.id, op: 'upsert', doc: e }]);
    expect(old.body.error).toMatch(/Fee mismatch/); // the fee's old tax % no longer applies
    const ok = await sync(USERS.deepa, [{ coll: 'students', id: s.id, op: 'upsert', doc: s }, { coll: 'enr', id: e.id, op: 'upsert', doc: { ...e, total: atGst.total } }]);
    expect(ok.status).toBe(200);
    expect(await doc(t, 'enrollment', e.id)).toMatchObject({ taxPct: 12, total: atGst.total });
  });

  it('the tax invoice shows GSTIN, PAN, and CGST / SGST lines that add up to the tax', async () => {
    await setBranchGst(USERS.admin, { ...GST, cgst: 9, sgst: 9 });
    const p = (await t.sql<any>("SELECT data FROM docs WHERE type='payment' AND branch='BLR' LIMIT 1")).map((x) => JSON.parse(x.data))[0];
    expect(p, 'a Bengaluru payment in the seed').toBeTruthy();
    const d = (await loadBillingDoc(new Repo(t.env.DB), p.id))!;
    expect(d.from.lines).toEqual(expect.arrayContaining(['GSTIN: 29ABCDE1234F1Z5', 'PAN: ABCDE1234F']));
    expect(d.tax).toBeGreaterThan(0);
    expect(d.taxes.map((x) => x.label)).toEqual([expect.stringMatching(/^CGST \d/), expect.stringMatching(/^SGST \d/)]);
    expect(d.taxes[0].amount + d.taxes[1].amount).toBeCloseTo(d.tax, 2);
    const html = docHtml(d, 'invoice', 'logo.png');
    expect(html).toContain('GSTIN: 29ABCDE1234F1Z5');
    expect(html).toContain('PAN: ABCDE1234F');
    expect(html).toMatch(/CGST \d[\d.]*%/);
    expect(html).toMatch(/SGST \d[\d.]*%/);
    const pdf = await invoicePdf(d);
    expect(pdf.length).toBeGreaterThan(1000);
    if (process.env.BILLING_PDF_OUT) writeFileSync(`${process.env.BILLING_PDF_OUT}/gst-tax-invoice.pdf`, pdf);
  });

  it('invoice and receipt carry a GST summary with CGST / SGST rates and amounts; the receipt adds this payment', async () => {
    await setBranchGst(USERS.admin, { ...GST, cgst: 9, sgst: 9 });
    const p = (await t.sql<any>("SELECT data FROM docs WHERE type='payment' AND branch='BLR' LIMIT 1")).map((x) => JSON.parse(x.data))[0];
    const d = (await loadBillingDoc(new Repo(t.env.DB), p.id))!;
    const g = d.gst!;
    expect(g).toBeTruthy();
    expect(g.cgst + g.sgst).toBeCloseTo(d.tax, 2);
    expect(g.taxable).toBeCloseTo(d.subtotal, 2);
    expect(g.paid.taxable + g.paid.cgst + g.paid.sgst).toBeCloseTo(d.amountPaid, 2);
    const inv = docHtml(d, 'invoice', 'logo.png'), rc = docHtml(d, 'receipt', 'logo.png');
    for (const h of [inv, rc]) {
      expect(h).toContain('GST summary');
      expect(h).toContain(`CGST @ ${g.cgstPct}%`);
      expect(h).toContain(`SGST @ ${g.sgstPct}%`);
      expect(h).toContain('GSTIN: 29ABCDE1234F1Z5');
      expect(h).toContain('PAN: ABCDE1234F');
    }
    expect(rc).toContain('This payment');
    expect(inv).not.toContain('This payment');
    expect((await receiptPdf(d)).length).toBeGreaterThan(1000);
  });

  it('an Indian branch without rates still shows GST as CGST and SGST halves', async () => {
    const p = (await t.sql<any>("SELECT data FROM docs WHERE type='payment' AND branch='BLR' LIMIT 1")).map((x) => JSON.parse(x.data))[0];
    const d = (await loadBillingDoc(new Repo(t.env.DB), p.id))!;
    expect(d.tax).toBeGreaterThan(0);
    expect(d.taxes.map((x) => x.label)).toEqual([expect.stringMatching(/^CGST \d/), expect.stringMatching(/^SGST \d/)]);
    expect(d.gst!.cgstPct).toBe(d.gst!.sgstPct);
    expect(d.gst!.cgst + d.gst!.sgst).toBeCloseTo(d.tax, 2);
  });

  it('a new fee needs a valid course ID; an older fee without one can still be edited', async () => {
    const fees = (await t.sql<any>("SELECT data FROM docs WHERE type='fee'")).map((r) => JSON.parse(r.data));
    const old = fees.find((f) => f.branch === 'BLR' && f.active);
    const fresh = { ...old, id: 'FEE-901', pkg: 'Course ID test package', from: '2099-01-01', to: '' };
    delete fresh.courseId;
    expect((await sync(USERS.admin, [{ coll: 'fees', id: fresh.id, op: 'upsert', doc: fresh }])).body.error).toMatch(/course ID/);
    expect((await sync(USERS.admin, [{ coll: 'fees', id: fresh.id, op: 'upsert', doc: { ...fresh, courseId: 'bad <id>' } }])).body.error).toMatch(/Course ID: up to 80/);
    expect((await sync(USERS.admin, [{ coll: 'fees', id: fresh.id, op: 'upsert', doc: { ...fresh, courseId: 'x'.repeat(81) } }])).body.error).toMatch(/Course ID: up to 80/);
    expect((await sync(USERS.admin, [{ coll: 'fees', id: fresh.id, op: 'upsert', doc: { ...fresh, courseId: ' ROB-T24, Term 1 (BLR) & Lab #2: 2026/27_v1+ ' } }])).status).toBe(200);
    expect((await doc(t, 'fee', fresh.id)).courseId).toBe('ROB-T24, Term 1 (BLR) & Lab #2: 2026/27_v1+');
    // an existing fee with no course ID: other changes still save
    expect(old.courseId).toBeFalsy();
    const r = await sync(USERS.admin, [{ coll: 'fees', id: old.id, op: 'upsert', doc: { ...old, active: old.active }, base: old }]);
    expect(r.status).toBe(200);
  });

  it('branches without GST keep the single tax line', async () => {
    const p = (await t.sql<any>("SELECT data FROM docs WHERE type='payment' AND branch='KRM' LIMIT 1")).map((x) => JSON.parse(x.data))[0];
    const d = (await loadBillingDoc(new Repo(t.env.DB), p.id))!;
    expect(d.taxes.length).toBeLessThanOrEqual(1);
    expect(d.from.lines.join(' ')).not.toMatch(/GSTIN/);
  });
});
