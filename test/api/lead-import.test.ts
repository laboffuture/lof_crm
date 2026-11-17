// Bulk lead import (Leads → Import leads): check every row first, then create them with the normal lead logic.
import { describe, it, expect, beforeEach } from 'vitest';
import { setup, USERS, doc, type TestCtx } from '../helpers/app';
import { parseDay } from '../../src/domain/lead-import';

let t: TestCtx;
beforeEach(async () => { t = await setup(); });
const imp = async (body: any, email = USERS.hassan) => t.call('POST', '/api/v1/leads/import', { token: await t.login(email), body });
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({
  row: i + 2, student: `Import Kid ${i + 1}`, parent: `Import Parent ${i + 1}`, phone: `+971 55 ${String(700000 + i).padStart(7, '0')}`,
  email: `import${i + 1}@example.com`, branch: 'Al Karama', prog: 'Robotics', dob: '31/05/2014',
}));
const leadsNamed = async (prefix: string) => (await t.sql<any>("SELECT data FROM docs WHERE type='lead' AND json_extract(data,'$.student') LIKE ?", prefix + '%')).map((x) => JSON.parse(x.data));

describe('bulk lead import', () => {
  it('checks first (nothing created), then creates all 100 rows as leads', async () => {
    const r = await imp({ rows: rows(100), dryRun: true });
    expect(r.status).toBe(200);
    expect(r.body.summary).toMatchObject({ total: 100, ready: 100, errors: 0, duplicates: 0 });
    expect(await leadsNamed('Import Kid')).toHaveLength(0);

    const before = (await t.sql("SELECT id FROM docs WHERE type='comm'")).length;
    const go = await imp({ rows: rows(100), dryRun: false });
    expect(go.body.summary.created).toBe(100);
    const made = await leadsNamed('Import Kid');
    expect(made).toHaveLength(100);
    const one = made.find((l) => l.student === 'Import Kid 1');
    expect(one).toMatchObject({ branch: 'KRM', prog: 'ROB', status: 'Open', stage: 'New Lead', src: 'Manual', cat: 'Warm', dob: '2014-05-31', camp: 'Bulk import' });
    expect(go.body.results[0]).toMatchObject({ status: 'created', id: one.id });
    // no automatic welcome messages unless chosen; one summary notification instead of 100
    expect((await t.sql("SELECT id FROM docs WHERE type='comm'")).length).toBe(before);
    const n = await t.sql<any>("SELECT data FROM docs WHERE type='notification' AND json_extract(data,'$.text') LIKE '100 leads imported%'");
    expect(n).toHaveLength(1);
    const audit = await t.sql<any>("SELECT data FROM docs WHERE type='audit' AND json_extract(data,'$.act')='Leads imported'");
    expect(audit).toHaveLength(1);
  });

  it('uses the chosen defaults for empty cells and reports bad rows without stopping the rest', async () => {
    const r = await imp({
      dryRun: false, defaults: { branch: 'KRM', prog: 'ROB', src: 'Website', cat: 'Hot' },
      rows: [
        { row: 2, student: 'Good One', parent: 'P One', phone: '+971 55 1110001' },
        { row: 3, student: '', parent: 'P Two', phone: '+971 55 1110002' },
        { row: 4, student: 'Bad Phone', parent: 'P Three', phone: 'call me' },
        { row: 5, student: 'Bad Branch', parent: 'P Four', phone: '+971 55 1110004', branch: 'Mars' },
        { row: 6, student: 'Twin', parent: 'P Five', phone: '+971 55 1110001' },
        { row: 7, student: 'Bad Date', parent: 'P Six', phone: '+971 55 1110007', dob: '31/02/2014' },
        { row: 8, student: 'Wrong Course', parent: 'P Seven', phone: '+971 55 1110008', prog: 'Underwater Basket Weaving' },
      ],
    });
    const by = Object.fromEntries(r.body.results.map((x: any) => [x.row, x]));
    expect(by[2]).toMatchObject({ status: 'created' });
    expect(by[3].message).toMatch(/Student name is missing/);
    expect(by[4].message).toMatch(/Mobile .* not valid/);
    expect(by[5].message).toMatch(/Branch "Mars" not found/);
    expect(by[6].message).toMatch(/Same mobile as row 2/);
    expect(by[7].message).toMatch(/Date of birth/);
    expect(by[8].message).toMatch(/Programme .* not found/);
    const l = (await leadsNamed('Good One'))[0];
    expect(l).toMatchObject({ src: 'Website', cat: 'Hot', branch: 'KRM', prog: 'ROB' });
  });

  it('skips families already in the CRM unless asked to import them anyway', async () => {
    const existing = await doc(t, 'lead', 'LD-26-1001');
    const row = { row: 2, student: 'Again', parent: 'Same Family', phone: existing.phone, branch: existing.branch, prog: existing.prog };
    const a = await imp({ rows: [row], dryRun: false });
    expect(a.body.results[0].status).toBe('duplicate');
    expect(await leadsNamed('Again')).toHaveLength(0);
    const b = await imp({ rows: [row], dryRun: false, allowDuplicates: true });
    expect(b.body.results[0].status).toBe('created');
  });

  it('respects permissions, branch access and the size limit', async () => {
    expect((await imp({ rows: rows(1) }, USERS.khalid)).status).toBe(403); // Management: view-only on leads
    const other = await imp({ rows: [{ ...rows(1)[0], branch: 'Sports City' }] }); // Hassan works at Al Karama
    expect(other.body.results[0].message).toMatch(/no access/);
    expect((await imp({ rows: rows(501) })).status).toBe(413);
    expect((await imp({ rows: [] })).status).toBe(400);
  });

  it('reads the usual date formats', () => {
    expect(parseDay('2014-05-31')).toBe('2014-05-31');
    expect(parseDay('31/05/2014')).toBe('2014-05-31');
    expect(parseDay('1.6.2015')).toBe('2015-06-01');
    expect(parseDay('31/02/2014')).toBeNull();
    expect(parseDay('May 2014')).toBeNull();
  });
});
