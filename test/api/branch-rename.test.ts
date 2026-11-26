// Branch Short ID change (on outside production; ALLOW_BRANCH_ID_EDIT on the live site): every record moves to the new ID in one step.
import { describe, it, expect } from 'vitest';
import { setup, USERS, doc } from '../helpers/app';

const rename = async (t: Awaited<ReturnType<typeof setup>>, who: string, from: string, to: string) =>
  t.call('POST', '/api/v1/admin/branches/rename', {
    token: await t.login(who),
    body: { from, to },
    headers: { 'x-lof-csrf': '1' },
  });

describe('branch Short ID change', () => {
  it('is refused on the live site unless switched on', async () => {
    const t = await setup({ APP_ENV: 'production' } as any);
    const r = await rename(t, USERS.admin, 'KRM', 'AKR');
    expect(r.status).toBe(403);
    expect(await doc(t, 'branch', 'KRM')).not.toBeNull();
  });

  it('is refused for anyone but a System Administrator', async () => {
    const t = await setup({ ALLOW_BRANCH_ID_EDIT: 'true' } as any);
    expect((await rename(t, USERS.khalid, 'KRM', 'AKR')).status).toBe(403);
  });

  it('moves every record, staff access and receipt counter to the new ID', async () => {
    const t = await setup({ ALLOW_BRANCH_ID_EDIT: 'true' } as any);
    const before = await t.sql<{ n: number }>(
      "SELECT COUNT(*) n FROM docs WHERE branch='KRM' AND type NOT IN ('audit','branch')",
    );
    expect(before[0].n).toBeGreaterThan(0);
    const seqBefore = await t.sql<{ value: number }>("SELECT value FROM sequences WHERE name='rc_KRM'");

    const r = await rename(t, USERS.admin, 'KRM', 'akr');
    expect(r.status, r.text).toBe(200);
    expect(r.body).toMatchObject({ from: 'KRM', to: 'AKR', records: before[0].n });

    expect(await doc(t, 'branch', 'KRM')).toBeNull();
    expect((await doc(t, 'branch', 'AKR')).id).toBe('AKR');
    expect(
      (
        await t.sql(
          "SELECT 1 FROM docs WHERE type NOT IN ('audit') AND (branch='KRM' OR json_extract(data,'$.branch')='KRM')",
        )
      ).length,
    ).toBe(0);
    const scope = JSON.parse((await t.sql("SELECT data FROM settings WHERE key='scope'"))[0]?.data || '{}');
    expect(JSON.stringify(scope)).not.toContain('"KRM"');
    if (seqBefore.length)
      expect((await t.sql("SELECT value FROM sequences WHERE name='rc_AKR'"))[0].value).toBe(seqBefore[0].value);

    // The CRM still works for that branch's staff afterwards
    const b = await t.call('GET', '/api/v1/bootstrap', { token: await t.login(USERS.priya) });
    expect(b.status).toBe(200);
    expect(b.body.me.scope).toContain('AKR');
    expect(b.body.data.leads.length).toBeGreaterThan(0);
  });

  it('refuses an ID that is taken or invalid', async () => {
    const t = await setup({ ALLOW_BRANCH_ID_EDIT: 'true' } as any);
    const other = (await t.sql<{ id: string }>("SELECT id FROM docs WHERE type='branch' AND id<>'KRM' LIMIT 1"))[0].id;
    expect((await rename(t, USERS.admin, 'KRM', other)).status).toBe(409);
    expect((await rename(t, USERS.admin, 'KRM', 'TOO-LONG')).status).toBe(422);
  });
});
