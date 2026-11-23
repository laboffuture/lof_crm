// Individual / bulk e-mail and Email Automation (payment reminders, birthdays, welcome, quotations, receipts).
import { describe, it, expect, beforeEach } from 'vitest';
import { setup, USERS, doc, type TestCtx } from '../helpers/app';

let t: TestCtx;
beforeEach(async () => { t = await setup(); });
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
const plusDays = (n: number) => new Date(Date.parse(today() + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const compose = async (body: any, email = USERS.admin) => t.call('POST', '/api/v1/mail/compose', { token: await t.login(email), body });
const run = async () => t.call('POST', '/api/v1/mail/automation/run', { token: await t.login(USERS.admin), body: {} });
const bootCfg = async () => (await t.call('GET', '/api/v1/bootstrap', { token: await t.login(USERS.admin) })).body.data.cfg;
const saveAuto = async (fn: (a: any) => void) => {
  const c = await bootCfg(); fn(c.mailAuto);
  return t.call('PUT', '/api/v1/sync', { token: await t.login(USERS.admin), body: { changes: [], settings: [{ key: 'cfg', doc: c }] } });
};
const one = async (q: string, ...b: unknown[]) => JSON.parse((await t.sql<any>(q, ...b))[0].data);
const emailLead = async (branch = 'KRM') => one("SELECT data FROM docs WHERE type='lead' AND branch=? AND json_extract(data,'$.email')<>'' AND json_extract(data,'$.em')=1 LIMIT 1", branch);
const student = async () => one("SELECT data FROM docs WHERE type='student' AND json_extract(data,'$.parents[0].email')<>'' LIMIT 1");

describe('individual and bulk e-mail', () => {
  it('sends a personalised e-mail to each recipient and records it on the history', async () => {
    const l = await emailLead(), s = await student();
    const r = await compose({ targets: [{ type: 'lead', id: l.id }, { type: 'student', id: s.id }], template: 'Progress update', subject: 'Hello {student_name}', body: 'Dear {parent_name}, news about {student_name}.' });
    expect(r.body).toMatchObject({ ok: true, queued: 2, skipped: [] });
    const cm = (await t.sql<any>("SELECT data FROM docs WHERE type='comm' AND json_extract(data,'$.lead')=? AND json_extract(data,'$.tpl')='Progress update'", l.id)).map((x) => JSON.parse(x.data));
    expect(cm[0]).toMatchObject({ ch: 'Email', subj: 'Hello ' + l.student, text: `Dear ${l.parent}, news about ${l.student}.`, status: 'Sent (mock)' });
    const after = await doc(t, 'student', s.id);
    expect(after.comm.at(-1)).toMatchObject({ ch: 'Email', subject: `Hello ${s.first} ${s.last}`, status: 'Sent (mock)', to: s.parents[0].email });
    const log = (await t.sql<any>("SELECT request FROM integration_logs WHERE integration='email' ORDER BY id DESC LIMIT 1")).map((x) => JSON.parse(x.request))[0];
    expect(log.subject).toBe(`Hello ${s.first} ${s.last}`);
  });
  it('skips recipients outside the branch access, without an address or without consent', async () => {
    const spc = await emailLead('SPC');
    const r = await compose({ targets: [{ type: 'lead', id: spc.id }], subject: 'Hi', body: 'Hi' }, USERS.priya); // Karama counsellor
    expect(r.body).toMatchObject({ queued: 0, skipped: [{ id: spc.id, reason: 'Outside your branch access' }] });
    await t.sql("UPDATE docs SET data=json_set(data,'$.em',json('false')) WHERE type='lead' AND id=?", spc.id);
    await t.setCfg((c) => { c.consentReq = { ...c.consentReq, em: true }; });
    expect((await compose({ targets: [{ type: 'lead', id: spc.id }], subject: 'Hi', body: 'Hi' })).body.skipped[0].reason).toBe('No e-mail consent');
  });
  it('checks permissions, placeholders and the recipient list', async () => {
    const s = await student();
    expect((await compose({ targets: [{ type: 'student', id: s.id }], subject: 'Hi', body: 'Hi' }, USERS.khalid)).status).toBe(403); // Management: view-only on students
    expect((await compose({ targets: [{ type: 'student', id: s.id }], subject: 'Hi', body: 'Hi {password}' })).body.error).toMatch(/Unknown placeholder \{password\}/);
    expect((await compose({ targets: [], subject: 'Hi', body: 'Hi' })).body.error).toMatch(/at least one recipient/);
  });
});

describe('email automation', () => {
  it('validates the settings and stamps when an automation was switched on', async () => {
    expect((await saveAuto((a) => { a.payRemind.days = [90]; })).body.error).toMatch(/Reminder days/);
    expect((await saveAuto((a) => { a.hour = 25; })).body.error).toMatch(/hour/);
    expect((await saveAuto((a) => { a.birthday.on = true; })).status).toBe(200);
    const saved = JSON.parse((await t.sql<any>("SELECT data FROM settings WHERE key='cfg'"))[0].data).mailAuto;
    expect(saved.birthday.since).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(saved.welcome).toMatchObject({ on: false, since: '' });
  });
  it('sends birthday wishes once a day', async () => {
    const s = await student();
    await t.sql("UPDATE docs SET data=json_set(data,'$.dob',?,'$.status','Active') WHERE type='student' AND id=?", '2014-' + today().slice(5), s.id);
    await saveAuto((a) => { a.birthday.on = true; });
    expect((await run()).body.counts.birthday).toBeGreaterThanOrEqual(1);
    expect((await doc(t, 'student', s.id)).comm.at(-1)).toMatchObject({ tpl: 'Birthday wishes', subject: `Happy birthday, ${s.first} ${s.last}!` });
    expect((await run()).body.counts.birthday).toBeUndefined(); // never twice
    const log = await t.call('GET', '/api/v1/mail/automation/log', { token: await t.login(USERS.admin) });
    expect(log.body.items.some((i: any) => i.kind === 'birthday' && i.status === 'Queued')).toBe(true);
  });
  it('confirms receipts only for payments made after it was switched on', async () => {
    await saveAuto((a) => { a.receipt.on = true; });
    expect((await run()).body.counts.receipt).toBeUndefined(); // older payments are not e-mailed
    const p = await one("SELECT data FROM docs WHERE type='payment' AND json_extract(data,'$.stu') IS NOT NULL LIMIT 1");
    await t.sql("UPDATE docs SET data=json_set(data,'$.total',999999) WHERE type='enrollment' AND id=?", p.enr); // leave room for one more payment
    const fresh = { ...p, id: 'PY-26-9001', rc: 'RC-KRM-26-9001', at: new Date().toISOString() };
    await t.sql("INSERT INTO docs (type,id,branch,status,ref1,ref2,at,data) VALUES ('payment',?,?,?,?,?,?,?)", fresh.id, fresh.branch, fresh.status, fresh.enr, fresh.stu, fresh.at, JSON.stringify(fresh));
    expect((await run()).body.counts.receipt).toBe(1);
    const last = (await doc(t, 'student', fresh.stu)).comm.at(-1);
    expect(last.tpl).toBe('Fee receipt');
    expect(last.text).toContain('RC-KRM-26-9001');
    expect(last.text).toContain('tax invoice');
  });
  it('reminds parents before an instalment is due', async () => {
    const e = await one("SELECT data FROM docs WHERE type='enrollment' LIMIT 1");
    const due = plusDays(3);
    await t.sql("UPDATE docs SET status='Active', data=json_set(data,'$.status','Active','$.paid',0,'$.total',1200,'$.sched',json(?)) WHERE type='enrollment' AND id=?", JSON.stringify([{ n: 1, due, amt: 1200 }]), e.id);
    await saveAuto((a) => { a.payRemind.on = true; a.payRemind.days = [3]; });
    expect((await run()).body.counts.payRemind).toBeGreaterThanOrEqual(1);
    const last = (await doc(t, 'student', e.stu)).comm.at(-1);
    expect(last.tpl).toBe('Fee reminder');
    expect(last.text).toContain('1,200.00');
  });
  it('sends a quotation when an admission decision is accepted after switching on', async () => {
    await saveAuto((a) => { a.quotation.on = true; });
    const o = await one("SELECT data FROM docs WHERE type='opp' AND json_extract(data,'$.decision')='Accepted' AND json_extract(data,'$.stu') IS NULL LIMIT 1");
    expect((await run()).body.counts.quotation).toBeUndefined(); // accepted before it was switched on
    o.hist = [...(o.hist || []), { at: new Date(Date.now() + 1000).toISOString(), by: 'Nadia Farouk', text: 'Admission decision: Accepted' }];
    await t.sql("UPDATE docs SET data=? WHERE type='opp' AND id=?", JSON.stringify(o), o.id);
    expect((await run()).body.counts.quotation).toBe(1);
    const cm = (await t.sql<any>("SELECT data FROM docs WHERE type='comm' AND json_extract(data,'$.tpl')='Quotation'")).map((x) => JSON.parse(x.data));
    expect(cm[0].text).toMatch(/Total: (AED|INR) [\d,]+\.\d\d/);
  });
});
