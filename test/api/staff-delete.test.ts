// Configuration → Staff & Users: deleting and archiving users.
import { describe, it, expect, beforeEach } from 'vitest';
import { setup, USERS, doc, type TestCtx } from '../helpers/app';

let t: TestCtx;
beforeEach(async () => { t = await setup(); });
const sync = async (email: string, changes: any[]) => t.call('PUT', '/api/v1/sync', { token: await t.login(email), body: { changes, settings: [] } });
const newUser = { id: 'S90', name: 'Temp Reception', emp: 'LOF-E090', email: 'temp.reception@example.com', mobile: '', branch: 'KRM', dept: 'Front desk', role: 'Reception', programs: [], status: 'Active', access: 'Enabled', avail: 'Available', max: 0, leave: null, backup: '' };

describe('deleting a user', () => {
  it('deletes a user with no work attached and removes the login', async () => {
    expect((await sync(USERS.admin, [{ coll: 'staff', id: 'S90', op: 'upsert', doc: newUser }])).status).toBe(200);
    expect((await t.sql<any>("SELECT staff_id FROM staff_auth WHERE staff_id='S90'")).length).toBe(1);
    const r = await sync(USERS.admin, [{ coll: 'staff', id: 'S90', op: 'delete' }]);
    expect(r.status).toBe(200);
    expect(await doc(t, 'staff', 'S90')).toBeNull();
    expect((await t.sql<any>("SELECT staff_id FROM staff_auth WHERE staff_id='S90'")).length).toBe(0);
  });
  it('refuses to hard-delete a user who has leads, and refuses deleting yourself', async () => {
    expect((await sync(USERS.admin, [{ coll: 'staff', id: 'S01', op: 'delete' }])).body.error).toMatch(/has .*leads.*archive the user instead/);
    const me = (await t.call('GET', '/api/v1/bootstrap', { token: await t.login(USERS.admin) })).body.me;
    expect((await sync(USERS.admin, [{ coll: 'staff', id: me.id, op: 'delete' }])).body.error).toMatch(/your own user/);
  });
  it('archives a user with work: sign-in ends, open work moves to the Unassigned queue, restorable', async () => {
    const priyaToken = await t.login(USERS.priya); // Priya Nair, S01, Karama counsellor
    const openBefore = await t.sql<any>("SELECT id FROM docs WHERE type='lead' AND owner='S01' AND status='Open'");
    expect(openBefore.length).toBeGreaterThan(0);
    const s01 = await doc(t, 'staff', 'S01');
    const r = await sync(USERS.admin, [{ coll: 'staff', id: 'S01', op: 'upsert', doc: { ...s01, archived: true }, base: s01 }]);
    expect(r.status).toBe(200);
    expect(await doc(t, 'staff', 'S01')).toMatchObject({ archived: true, status: 'Inactive', access: 'Disabled', archivedBy: 'Vikram Sethi' });
    for (const { id } of openBefore) {
      const l = await doc(t, 'lead', id);
      expect(l.cslr).toBeNull();
      expect(l.events.at(-1).text).toMatch(/moved to the Unassigned queue/);
    }
    expect((await t.sql<any>("SELECT id FROM docs WHERE type='task' AND owner='S01' AND status='Pending'")).length).toBe(0);
    expect((await t.sql<any>("SELECT id FROM docs WHERE type='lead' AND owner='S01' AND status<>'Open'")).length).toBeGreaterThan(0); // history keeps the name
    expect((await t.call('GET', '/api/v1/bootstrap', { token: priyaToken })).status).toBe(401); // signed out at once
    const archived = await doc(t, 'staff', 'S01');
    const back = await sync(USERS.admin, [{ coll: 'staff', id: 'S01', op: 'upsert', doc: { ...archived, archived: false }, base: archived }]);
    expect(back.status).toBe(200);
    expect(await doc(t, 'staff', 'S01')).toMatchObject({ archived: false, access: 'Disabled' });
  });
  it('only roles with configuration delete access can delete or archive users', async () => {
    const s01 = await doc(t, 'staff', 'S01');
    expect((await sync(USERS.nadia, [{ coll: 'staff', id: 'S01', op: 'upsert', doc: { ...s01, archived: true }, base: s01 }])).body.error).toMatch(/cannot (delete|change)/);
    expect((await sync(USERS.nadia, [{ coll: 'staff', id: 'S01', op: 'delete' }])).body.error).toMatch(/cannot be deleted/);
  });
});
