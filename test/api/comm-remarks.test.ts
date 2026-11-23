// Communication remarks: every call / WhatsApp / e-mail with a lead can get remarks until 24 hours after it.
import { describe, it, expect, beforeEach } from 'vitest';
import { setup, USERS, doc, type TestCtx } from '../helpers/app';

let t: TestCtx;
beforeEach(async () => { t = await setup(); });
const remark = async (lead: string, body: any, email = USERS.priya) => t.call('POST', `/api/v1/leads/${lead}/remarks`, { token: await t.login(email), body });
/** A seeded call / message on an Al Karama lead, moved to `hoursAgo`. */
async function record(type: 'call' | 'comm', hoursAgo: number) {
  const r = (await t.sql<any>(`SELECT d.data FROM docs d JOIN docs l ON l.type='lead' AND l.id=json_extract(d.data,'$.lead') WHERE d.type=? AND l.branch='KRM' LIMIT 1`, type)).map((x) => JSON.parse(x.data))[0];
  expect(r, `a seeded ${type} at Al Karama`).toBeTruthy();
  const at = new Date(Date.now() - hoursAgo * 36e5).toISOString();
  await t.sql("UPDATE docs SET data=json_set(data,'$.at',?) WHERE type=? AND id=?", at, type, r.id);
  return { ...r, at };
}

describe('communication remarks', () => {
  it('adds remarks to a call within 24 hours, on the record and the lead timeline', async () => {
    const c = await record('call', 2);
    const r = await remark(c.lead, { kind: 'call', rec: c.id, text: 'Parent wants the weekend batch; call back Thursday' });
    expect(r.status).toBe(200);
    const saved = await doc(t, 'call', c.id);
    expect(saved.remark).toMatchObject({ text: 'Parent wants the weekend batch; call back Thursday', by: expect.any(String) });
    expect(saved.remark.edited).toBeUndefined();
    const lead = await doc(t, 'lead', c.lead);
    expect(lead.events.at(-1).text).toMatch(/Remarks on .*call/);
    // can be changed while the window is open; the change is audited
    const again = await remark(c.lead, { kind: 'call', rec: c.id, text: 'Weekend batch confirmed' });
    expect(again.status).toBe(200);
    expect((await doc(t, 'call', c.id)).remark).toMatchObject({ text: 'Weekend batch confirmed', edited: true });
    const audit = await t.sql<any>("SELECT data FROM docs WHERE type='audit' AND json_extract(data,'$.act')='Communication remarks changed' AND json_extract(data,'$.ref')=?", c.id);
    expect(audit).toHaveLength(1);
  });

  it('works for WhatsApp / e-mail messages too', async () => {
    const m = await record('comm', 23.5);
    const r = await remark(m.lead, { kind: 'comm', rec: m.id, text: 'Sent the brochure, parent will reply' });
    expect(r.status).toBe(200);
    expect((await doc(t, 'comm', m.id)).remark.text).toBe('Sent the brochure, parent will reply');
  });

  it('closes after 24 hours', async () => {
    const c = await record('call', 24.2);
    const r = await remark(c.lead, { kind: 'call', rec: c.id, text: 'Too late now' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/within 24 hours/);
    expect((await doc(t, 'call', c.id)).remark).toBeUndefined();
  });

  it('checks the text, the record and access', async () => {
    const c = await record('call', 1);
    expect((await remark(c.lead, { kind: 'call', rec: c.id, text: ' ' })).status).toBe(400);
    expect((await remark(c.lead, { kind: 'call', rec: 'CL-NOPE', text: 'Something' })).status).toBe(404);
    expect((await remark(c.lead, { kind: 'task', rec: c.id, text: 'Something' })).status).toBe(400);
    expect((await remark(c.lead, { kind: 'call', rec: c.id, text: 'Something' }, USERS.fatima)).status).toBe(403); // other branch
    expect((await remark(c.lead, { kind: 'call', rec: c.id, text: 'Something' }, USERS.khalid)).status).toBe(403); // view-only
  });

  it('remarks are not something the normal save can forge', async () => {
    const c = await record('call', 1);
    const tok = await t.login(USERS.priya);
    const r = await t.call('PUT', '/api/v1/sync', { token: tok, body: { changes: [{ coll: 'calls', id: c.id, op: 'upsert', doc: { ...c, remark: { text: 'forged', by: 'x', at: '2020-01-01' } }, base: c }] } });
    expect(r.status).toBe(409);
    expect((await doc(t, 'call', c.id)).remark).toBeUndefined();
  });
});
