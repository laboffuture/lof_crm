// Configuration → Branches: deleting a branch.
import { describe, it, expect, beforeEach } from 'vitest';
import { setup, USERS, doc, type TestCtx } from '../helpers/app';

let t: TestCtx;
beforeEach(async () => { t = await setup(); });
const sync = async (email: string, changes: any[], settings: any[] = []) => t.call('PUT', '/api/v1/sync', { token: await t.login(email), body: { changes, settings } });
const newBranch = { id: 'DXB', name: 'Dubai Marina', code: 'LOF-DXB-001', country: 'UAE', city: 'Dubai', cur: 'AED', address: '—', phone: '—', email: '—', status: 'Planned', admin: '', programs: ['ROB'], days: 'Sun–Thu', hours: '10:00–18:00', tAdm: 0, tRev: 0 };

describe('deleting a branch', () => {
  it('deletes a branch that has no records', async () => {
    expect((await sync(USERS.admin, [{ coll: 'branches', id: 'DXB', op: 'upsert', doc: newBranch }])).status).toBe(200);
    expect(await doc(t, 'branch', 'DXB')).toBeTruthy();
    const r = await sync(USERS.admin, [{ coll: 'branches', id: 'DXB', op: 'delete' }]);
    expect(r.status).toBe(200);
    expect(await doc(t, 'branch', 'DXB')).toBeNull();
  });
  it('refuses to delete a branch that still has records and says what uses it', async () => {
    const r = await sync(USERS.admin, [{ coll: 'branches', id: 'KRM', op: 'delete' }]);
    expect(r.body.error).toMatch(/still used by .*leads.*set its operating status to Closed/);
    expect(await doc(t, 'branch', 'KRM')).toBeTruthy();
  });
  it('refuses while e-mail settings point at the branch', async () => {
    await sync(USERS.admin, [{ coll: 'branches', id: 'DXB', op: 'upsert', doc: newBranch }]);
    await t.setCfg((c) => { c.mailIn = { on: false, mailbox: '', unknown: 'lead', branch: 'DXB', prog: 'ROB', block: [], notify: true }; });
    expect((await sync(USERS.admin, [{ coll: 'branches', id: 'DXB', op: 'delete' }])).body.error).toMatch(/Email Incoming settings/);
  });
  it('archives a branch with records: hidden from everyone, records kept, restorable', async () => {
    const krm = await doc(t, 'branch', 'KRM');
    const leadsBefore = await t.sql<any>("SELECT id FROM docs WHERE type='lead' AND branch='KRM'");
    const r = await sync(USERS.admin, [{ coll: 'branches', id: 'KRM', op: 'upsert', doc: { ...krm, archived: true }, base: krm }]);
    expect(r.status).toBe(200);
    expect(await doc(t, 'branch', 'KRM')).toMatchObject({ archived: true, status: 'Closed', archivedBy: 'Vikram Sethi' });
    expect((await t.sql<any>("SELECT id FROM docs WHERE type='lead' AND branch='KRM'")).length).toBe(leadsBefore.length); // nothing deleted
    const admin = (await t.call('GET', '/api/v1/bootstrap', { token: await t.login(USERS.admin) })).body;
    expect(admin.me.scope).not.toContain('KRM');
    expect(admin.data.leads.some((l: any) => l.branch === 'KRM')).toBe(false);
    expect(admin.data.branches.find((b: any) => b.id === 'KRM').archived).toBe(true); // still there for name lookups
    const priya = (await t.call('GET', '/api/v1/bootstrap', { token: await t.login(USERS.priya) })).body; // Karama counsellor
    expect(priya.data.leads.length).toBe(0);
    const back = await sync(USERS.admin, [{ coll: 'branches', id: 'KRM', op: 'upsert', doc: { ...krm, archived: false, status: 'Closed' }, base: { ...krm, archived: true, status: 'Closed' } }]);
    expect(back.status).toBe(200);
    expect((await doc(t, 'branch', 'KRM')).archived).toBe(false);
    const again = (await t.call('GET', '/api/v1/bootstrap', { token: await t.login(USERS.admin) })).body;
    expect(again.data.leads.some((l: any) => l.branch === 'KRM')).toBe(true);
  });
  it('does not archive a branch that receives e-mail leads, or for roles without delete access', async () => {
    const krm = await doc(t, 'branch', 'KRM');
    expect((await sync(USERS.nadia, [{ coll: 'branches', id: 'KRM', op: 'upsert', doc: { ...krm, archived: true }, base: krm }])).body.error).toMatch(/cannot (delete|change)/);
    await t.setCfg((c) => { c.mailIn = { on: false, mailbox: '', unknown: 'lead', branch: 'KRM', prog: 'ROB', block: [], notify: true }; });
    expect((await sync(USERS.admin, [{ coll: 'branches', id: 'KRM', op: 'upsert', doc: { ...krm, archived: true }, base: krm }])).body.error).toMatch(/Email Incoming/);
    expect((await doc(t, 'branch', 'KRM')).archived).toBeFalsy();
  });
  it('only roles with configuration delete access can delete', async () => {
    await sync(USERS.admin, [{ coll: 'branches', id: 'DXB', op: 'upsert', doc: newBranch }]);
    expect((await sync(USERS.priya, [{ coll: 'branches', id: 'DXB', op: 'delete' }])).body.error).toMatch(/cannot be deleted/);
    expect(await doc(t, 'branch', 'DXB')).toBeTruthy();
  });
});
