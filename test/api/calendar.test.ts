// Counsellor calendar: follow-ups a counsellor schedules land on that counsellor's calendar.
import { describe, it, expect, beforeEach } from 'vitest';
import { setup, USERS, doc, type TestCtx } from '../helpers/app';

let t: TestCtx;
beforeEach(async () => { t = await setup(); });
const sync = async (email: string, changes: any[]) => t.call('PUT', '/api/v1/sync', { token: await t.login(email), body: { changes, settings: [] } });
const openLeadOf = async (cslr: string) =>
  (await t.sql<any>("SELECT data FROM docs WHERE type='lead' AND branch='KRM' AND is_test=0 AND json_extract(data,'$.cslr')=? AND status='Open' LIMIT 1", cslr)).map((r) => JSON.parse(r.data))[0];
const task = (id: string, lead: string, cslr: string) => ({ id, lead, cslr, due: new Date(Date.now() + 864e5).toISOString(), type: 'Follow-up call', status: 'Pending', remarks: 'Calendar test', outcome: '', next: '' });

describe('counsellor calendar', () => {
  it("keeps a counsellor's follow-up on their own calendar, also on a colleague's lead", async () => {
    const omarsLead = await openLeadOf('S02'); // Priya (S01) follows up on Omar's lead
    expect(omarsLead).toBeTruthy();
    const r = await sync(USERS.priya, [{ coll: 'tasks', id: 'T-9101', op: 'upsert', doc: task('T-9101', omarsLead.id, 'S01') }]);
    expect(r.status).toBe(200);
    expect((await doc(t, 'task', 'T-9101')).cslr).toBe('S01');
    expect((await t.sql<any>("SELECT owner FROM docs WHERE type='task' AND id='T-9101'"))[0].owner).toBe('S01');
    // and it is in the data her calendar is built from after a reload
    const boot = await t.call('GET', '/api/v1/bootstrap', { token: await t.login(USERS.priya) });
    expect((boot.body.data?.tasks || boot.body.tasks || []).some((x: any) => x.id === 'T-9101' && x.cslr === 'S01')).toBe(true);
  });

  it('does not let a counsellor put a new follow-up on a third colleague’s calendar', async () => {
    const own = await openLeadOf('S01');
    const r = await sync(USERS.priya, [{ coll: 'tasks', id: 'T-9102', op: 'upsert', doc: task('T-9102', own.id, 'S02') }]);
    expect(r.status).toBe(200);
    expect((await doc(t, 'task', 'T-9102')).cslr).toBe('S01');
  });

  it('lets a manager schedule for the lead’s counsellor as before', async () => {
    const omarsLead = await openLeadOf('S02');
    const r = await sync(USERS.hassan, [{ coll: 'tasks', id: 'T-9103', op: 'upsert', doc: task('T-9103', omarsLead.id, 'S02') }]);
    expect(r.status).toBe(200);
    expect((await doc(t, 'task', 'T-9103')).cslr).toBe('S02');
  });
});
