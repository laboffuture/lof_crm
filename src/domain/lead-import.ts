// Bulk lead import (Leads → Import leads): rows read from an Excel / CSV sheet in the browser are checked here
// (dry run) and then created one by one with the normal lead logic – routing, duplicate check, first-call task.
import type { Repo } from '../lib/db';
import type { User } from '../types';
import { normPhone } from '../lib/indexing';
import { addAudit, createLead, findDup, notify } from './core';

export const IMPORT_MAX = 500;

export interface ImportOptions {
  defaults?: { branch?: string; prog?: string; src?: string; cat?: string };
  /** Send the automatic welcome WhatsApp / e-mail to each imported lead (off unless chosen). */
  sendMessages?: boolean;
  /** Create rows whose mobile or e-mail already belongs to a lead or student. */
  allowDuplicates?: boolean;
  dryRun?: boolean;
}
export interface ImportResult {
  row: number; student: string; parent: string; phone: string; branch: string; prog: string;
  status: 'ready' | 'duplicate' | 'error' | 'created';
  message: string; id?: string;
}

const txt = (v: unknown, n = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const yesNo = (v: unknown, dflt: boolean) => {
  const s = txt(v).toLowerCase();
  if (!s) return dflt;
  if (['yes', 'y', 'true', '1'].includes(s)) return true;
  if (['no', 'n', 'false', '0'].includes(s)) return false;
  return null;
};
/** 2014-05-31, 31/05/2014, 31-05-2014 or 31.05.2014 → 2014-05-31 */
export function parseDay(v: unknown): string | null {
  const s = txt(v, 40);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  let y: number, mo: number, d: number;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}
const ageOn = (dob: string) => {
  const t = new Date(), b = new Date(dob + 'T00:00:00Z');
  let a = t.getUTCFullYear() - b.getUTCFullYear();
  if (t.getUTCMonth() < b.getUTCMonth() || (t.getUTCMonth() === b.getUTCMonth() && t.getUTCDate() < b.getUTCDate())) a--;
  return a;
};

export async function importLeads(repo: Repo, user: User, rows: any[], o: ImportOptions) {
  const [branches, programs, staff, cfg] = await Promise.all([repo.many<any>('branch'), repo.many<any>('program'), repo.many<any>('staff'), repo.setting<any>('cfg')]);
  const sources: string[] = (cfg?.sources || []).filter((s: any) => s.en).map((s: any) => s.n);
  const pick = <T extends Record<string, any>>(list: T[], v: unknown, keys: string[]) => {
    const x = txt(v).toLowerCase();
    return x ? list.find((it) => keys.some((k) => String(it[k] ?? '').toLowerCase() === x)) || null : null;
  };
  const D = o.defaults || {};
  const seenPhone = new Map<string, number>(), seenEmail = new Map<string, number>();
  const results: ImportResult[] = [];
  const inputs = new Map<number, any>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] && typeof rows[i] === 'object' ? rows[i] : {};
    const row = Number.isInteger(r.row) ? r.row : i + 2;
    const errs: string[] = [];
    const student = txt(r.student, 120), parent = txt(r.parent, 120), phone = txt(r.phone, 20), email = txt(r.email, 160).toLowerCase();
    if (!student) errs.push('Student name is missing');
    if (!parent) errs.push('Parent name is missing');
    if (!phone) errs.push('Mobile is missing');
    else if (!/^\+?[\d\s()-]{7,20}$/.test(phone)) errs.push(`Mobile "${phone}" is not valid`);
    if (email && !/^\S+@\S+\.\S+$/.test(email)) errs.push(`E-mail "${email}" is not valid`);

    const br = pick(branches.filter((b) => !b.archived), r.branch || D.branch, ['id', 'name', 'code']);
    if (!br) errs.push(r.branch ? `Branch "${txt(r.branch)}" not found` : 'Branch is missing');
    else if (!user.scope.includes(br.id)) errs.push(`You have no access to ${br.name}`);
    const pg = pick(programs.filter((p) => p.active !== false), r.prog || D.prog, ['id', 'name']);
    if (!pg) errs.push(r.prog ? `Programme "${txt(r.prog)}" not found` : 'Programme is missing');
    else if (br && !(br.programs || []).includes(pg.id)) errs.push(`${pg.name} is not offered at ${br.name}`);

    const catIn = txt(r.cat || D.cat || 'Warm');
    const cat = ['Hot', 'Warm', 'Cold'].find((c) => c.toLowerCase() === catIn.toLowerCase());
    if (!cat) errs.push(`Category "${catIn}" must be Hot, Warm or Cold`);
    const srcIn = txt(r.src || D.src || 'Manual', 60);
    const src = sources.find((s) => s.toLowerCase() === srcIn.toLowerCase());
    if (!src) errs.push(`Source "${srcIn}" is not an enabled lead source (${sources.join(', ')})`);

    let dob = '';
    if (txt(r.dob)) {
      const d = parseDay(r.dob);
      if (!d) errs.push(`Date of birth "${txt(r.dob)}" is not a date (use 31/05/2014)`);
      else dob = d;
    }
    let age = 0;
    if (txt(r.age)) {
      const a = Number(txt(r.age));
      if (!Number.isFinite(a) || a < 0 || a > 25) errs.push(`Age "${txt(r.age)}" is not valid`);
      else age = Math.floor(a);
    } else if (dob) age = Math.max(0, ageOn(dob));

    let cslr: string | undefined;
    if (txt(r.cslr)) {
      const st = pick(staff, r.cslr, ['id', 'name', 'email']);
      if (!st || st.role !== 'Counsellor' || st.status === 'Inactive' || st.access === 'Disabled') errs.push(`Counsellor "${txt(r.cslr)}" not found`);
      else if (br && st.branch !== br.id) errs.push(`${st.name} does not work at ${br.name}`);
      else cslr = st.id;
    }
    const wa = yesNo(r.wa, true), em = yesNo(r.em, true);
    if (wa === null) errs.push('WhatsApp consent must be Yes or No');
    if (em === null) errs.push('E-mail consent must be Yes or No');

    // the same family twice in the sheet
    const pk = normPhone(phone);
    if (pk && seenPhone.has(pk)) errs.push(`Same mobile as row ${seenPhone.get(pk)}`);
    else if (pk) seenPhone.set(pk, row);
    if (email && seenEmail.has(email)) errs.push(`Same e-mail as row ${seenEmail.get(email)}`);
    else if (email) seenEmail.set(email, row);

    const base = { row, student, parent, phone, branch: br?.name || txt(r.branch || D.branch), prog: pg?.name || txt(r.prog || D.prog) };
    if (errs.length) { results.push({ ...base, status: 'error', message: errs.join('; ') }); continue; }
    const dups = await findDup(repo, phone, email);
    const input = {
      student, parent, phone, email, branch: br.id, prog: pg.id, src, cat, dob, age, cslr,
      school: txt(r.school, 160), grade: txt(r.grade, 40), curr: txt(r.curr, 60), camp: txt(r.camp, 120) || 'Bulk import',
      notes: txt(r.notes, 2000), wa: !!wa, em: !!em,
    };
    inputs.set(row, input);
    if (dups.length) {
      const ids = dups.map((d) => (user.scope.includes(d.branch) ? d.id : `${d.kind.toLowerCase()} in another branch`)).join(', ');
      results.push({ ...base, status: 'duplicate', message: `Already in the CRM: ${ids}${o.allowDuplicates ? ' – will be imported anyway' : ' – skipped'}` });
    } else results.push({ ...base, status: 'ready', message: 'Ready to import' });
  }

  const summary = () => ({
    total: results.length,
    ready: results.filter((x) => x.status === 'ready' || (x.status === 'duplicate' && o.allowDuplicates)).length,
    duplicates: results.filter((x) => x.status === 'duplicate').length,
    errors: results.filter((x) => x.status === 'error').length,
    created: results.filter((x) => x.status === 'created').length,
  });
  if (o.dryRun) return { results, summary: summary(), queuedComms: [] as string[] };

  const queuedComms: string[] = [];
  const perBranch = new Map<string, number>();
  for (const res of results) {
    if (!(res.status === 'ready' || (res.status === 'duplicate' && o.allowDuplicates))) continue;
    const input = inputs.get(res.row);
    try {
      const made = await createLead(repo, input, `${user.name} (bulk import)`, { quiet: true, noAutoMessages: !o.sendMessages });
      queuedComms.push(...made.queuedComms);
      Object.assign(res, { status: 'created', id: made.lead.id, message: `Created ${made.lead.id}${made.lead.cslr ? '' : ' – unassigned'}` });
      perBranch.set(input.branch, (perBranch.get(input.branch) || 0) + 1);
    } catch (e: any) {
      Object.assign(res, { status: 'error', message: String(e?.message || e).slice(0, 300) });
    }
  }
  // One notice per branch instead of one per lead
  for (const [b, n] of perBranch) {
    const name = branches.find((x) => x.id === b)?.name || b;
    await notify(repo, { type: 'new', sev: 'info', text: `${n} lead${n === 1 ? '' : 's'} imported by ${user.name} for ${name}`, route: { page: 'leads' }, roles: ['Counsellor', 'Centre Administrator', 'Admissions Head'], branch: b });
  }
  const s = summary();
  await addAudit(repo, 'Leads imported', 'Bulk import', `${s.created} created, ${s.duplicates} duplicate${o.allowDuplicates ? 's imported' : 's skipped'}, ${s.errors} with errors (of ${s.total} rows)`, user.name);
  return { results, summary: s, queuedComms };
}
