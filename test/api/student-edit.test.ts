// Student 360 → edit personal details and parents / guardians. Student ID, branch, family and registration date
// stay permanent; edited values get the same checks as at registration.
import { describe, it, expect, beforeEach } from 'vitest';
import { setup, USERS, doc, type TestCtx } from '../helpers/app';

let t: TestCtx;
beforeEach(async () => { t = await setup(); });
const sync = async (email: string, changes: any[]) => t.call('PUT', '/api/v1/sync', { token: await t.login(email), body: { changes } });
const SID = 'LOF-26-000004';
const edit = async (patch: any) => {
  const s = await doc(t, 'student', SID);
  return sync(USERS.admin, [{ coll: 'students', id: SID, op: 'upsert', doc: { ...s, ...patch }, base: s }]);
};

describe('editing a student', () => {
  it('saves personal details', async () => {
    const r = await edit({ first: 'Dhruv', last: 'Iyer-Rao', dob: '2014-03-02', nat: 'Indian', school: 'DPS', grade: '7', curr: 'CBSE', address: 'Koramangala, Bengaluru', email: 'dhruv@example.com', mobile: '+91 98765 00000' });
    expect(r.status).toBe(200);
    expect(await doc(t, 'student', SID)).toMatchObject({ last: 'Iyer-Rao', dob: '2014-03-02', school: 'DPS', curr: 'CBSE', email: 'dhruv@example.com' });
  });

  it('checks the values', async () => {
    expect((await edit({ first: '  ' })).body.error).toMatch(/name are required/);
    expect((await edit({ dob: '2999-01-01' })).body.error).toMatch(/Date of birth/);
    expect((await edit({ email: 'not-an-email' })).body.error).toMatch(/e-mail is not valid/);
    expect((await edit({ mobile: 'abc' })).body.error).toMatch(/mobile is not valid/);
  });

  it('keeps student ID, branch, family and registration date permanent', async () => {
    expect((await edit({ fam: 'FAM-X' })).body.error).toMatch(/permanent/);
    expect((await edit({ reg: '2020-01-01' })).body.error).toMatch(/permanent/);
  });

  it('edits parents / guardians; the main one needs a valid e-mail', async () => {
    const s = await doc(t, 'student', SID);
    const p0 = { ...s.parents[0], name: 'Ramesh K. Iyer', mobile: '+91 98765 43412' };
    expect((await edit({ parents: [p0, { name: 'Lakshmi Iyer', rel: 'Mother', email: 'lakshmi@example.com', mobile: '+91 98765 43413', job: '—' }] })).status).toBe(200);
    expect((await doc(t, 'student', SID)).parents.map((p: any) => p.name)).toEqual(['Ramesh K. Iyer', 'Lakshmi Iyer']);
    expect((await edit({ parents: [{ ...p0, email: 'bad' }] })).body.error).toMatch(/main parent/);
    expect((await edit({ parents: [] })).body.error).toMatch(/main parent/);
    expect((await edit({ parents: [p0, { name: '', email: 'x@example.com' }] })).body.error).toMatch(/needs a name/);
  });
});
