// Individual and bulk e-mails (Leads, Opportunities, Admissions, Students) and automated e-mails
// (Configuration → Email Automation). Every e-mail is written to the lead's or student's history and sent by the
// existing jobs (send_comm / send_student_mail), so Email Outgoing rules, consent and the daily limit always apply.
import type { Env, Job, User } from '../types';
import { Repo, nowIso } from '../lib/db';
import { calcFee, dayKey, feeFor, r2 } from './core';
import { instStatus } from './terms';
import { findEmailTemplate, renderEmailTemplate } from './email-templates';

export type MailTargetType = 'lead' | 'opp' | 'student';
export interface MailTarget { type: MailTargetType; id: string }
export const MAX_BULK = 500;

const fmtDay = (d: string) => new Date(d.length === 10 ? d + 'T12:00:00Z' : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' });
const amt = (n: number) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const addDays = (day: string, n: number) => new Date(Date.parse(day + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);

interface Lookups { programs: any[]; branches: any[]; staff: any[]; fees: any[] }
const lookups = async (repo: Repo): Promise<Lookups> => {
  const [programs, branches, staff, fees] = await Promise.all(['program', 'branch', 'staff', 'fee'].map((t) => repo.many<any>(t)));
  return { programs, branches, staff, fees };
};
const nameOf = (list: any[], id: string | null | undefined) => (id ? (list.find((x) => x.id === id) || { name: id }).name : '');

export interface Resolved {
  type: MailTargetType; id: string; branch: string; to: string; leadId?: string;
  values: Record<string, string>; skip?: string; test?: boolean;
}

/** Recipient, placeholder values and – when it cannot be e-mailed – the reason. `scope` limits to the user's branches. */
export async function resolveTarget(repo: Repo, cfg: any, L: Lookups, t: MailTarget, scope?: string[]): Promise<Resolved> {
  const today = dayKey(new Date());
  const none = (skip: string, branch = ''): Resolved => ({ type: t.type, id: t.id, branch, to: '', values: {}, skip });
  if (t.type === 'lead' || t.type === 'opp') {
    const o = t.type === 'opp' ? await repo.get<any>('opp', t.id) : null;
    if (t.type === 'opp' && !o) return none('Not found');
    const l = await repo.get<any>('lead', o ? o.lead : t.id);
    if (!l) return none('Not found');
    const src = o || l, branch = src.branch;
    if (scope && !scope.includes(branch)) return none('Outside your branch access', branch);
    const values: Record<string, string> = {
      date: fmtDay(today), parent_name: l.parent || '', student_name: l.student || o?.student || '',
      programme: nameOf(L.programs, src.prog), branch: nameOf(L.branches, branch), counsellor: nameOf(L.staff, src.cslr || l.cslr) || 'our team',
    };
    if (o) {
      // quotation figures: fee master for the programme, branch and package, with any approved discount
      values.package = o.pkg || '';
      const fee = feeFor(L.fees, o.prog, o.branch, o.pkg, today);
      if (fee) { values.amount = amt(calcFee(fee, o.discount || null, !o.stu).total); values.currency = fee.cur; }
      values.valid_until = fmtDay(addDays(today, 14));
    }
    const to = String(l.email || '').trim();
    const skip = !to ? 'No e-mail address' : cfg?.consentReq?.em && !l.em ? 'No e-mail consent' : undefined;
    return { type: t.type, id: t.id, branch, to, leadId: l.id, values, skip, test: !!(l.test || o?.test) };
  }
  const s = await repo.get<any>('student', t.id);
  if (!s) return none('Not found');
  const enr = (await repo.many<any>('enrollment', 'ref1=?', [s.id], 'created_at DESC'))[0];
  if (scope && !scope.includes(s.branch) && !(enr && scope.includes(enr.branch))) return none('Outside your branch access', s.branch);
  const p = (s.parents || [])[0] || {};
  const values: Record<string, string> = {
    date: fmtDay(today), parent_name: p.name || '', student_name: `${s.first || ''} ${s.last || ''}`.trim(), student_id: s.id,
    branch: nameOf(L.branches, s.branch), programme: enr ? nameOf(L.programs, enr.prog) : '', counsellor: nameOf(L.staff, enr?.cslr) || 'our team', package: enr?.pkg || '',
  };
  if (enr) { values.currency = enr.cur || ''; values.balance_due = amt(r2((+enr.total || 0) - (+enr.paid || 0))); }
  const to = String(p.email || '').trim();
  return { type: 'student', id: s.id, branch: s.branch, to, values, skip: to ? undefined : 'No parent e-mail', test: !!s.test };
}

/** Writes the e-mail to the history as Queued and returns the job that sends it. */
export async function queueMail(repo: Repo, r: Resolved, subject: string, text: string, tpl: string, by: string): Promise<Job> {
  const at = nowIso();
  if (r.type === 'student') {
    const s = await repo.get<any>('student', r.id);
    s.comm = [...(s.comm || []), { at, ch: 'Email', tpl, subject, text, to: r.to, status: 'Queued', by }];
    await repo.put('student', s);
    return { kind: 'send_student_mail', studentId: s.id, index: s.comm.length - 1 };
  }
  const id = await repo.newId('cm');
  await repo.put('comm', { id, lead: r.leadId, ch: 'Email', tpl, subj: subject, text, at, status: 'Queued', by, to: r.to, test: r.test || undefined });
  return { kind: 'send_comm', id };
}

/** Individual or bulk e-mail written by a user: one personalised e-mail per recipient. */
export async function composeMail(env: Env, user: User, targets: MailTarget[], m: { name: string; subject: string; body: string }) {
  const repo = new Repo(env.DB, user.name);
  const cfg = await repo.setting<any>('cfg');
  const L = await lookups(repo);
  const jobs: Job[] = [], skipped: { type: string; id: string; reason: string }[] = [], seen = new Set<string>();
  for (const t of targets) {
    const key = t.type + ':' + t.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const r = await resolveTarget(repo, cfg, L, t, user.scope);
    if (r.skip) { skipped.push({ type: t.type, id: t.id, reason: r.skip }); continue; }
    const out = renderEmailTemplate({ subject: m.subject, body: m.body }, r.values);
    jobs.push(await queueMail(repo, r, out.subject, out.body, m.name || 'Composed e-mail', user.name));
  }
  return { jobs, queued: jobs.length, skipped };
}

// ---------------------------------------------------------------- automated e-mails
export const MAIL_AUTO_KINDS = ['payRemind', 'birthday', 'welcome', 'quotation', 'receipt'] as const;
type Kind = typeof MAIL_AUTO_KINDS[number];
export const MAIL_AUTO_DEFAULTS = {
  hour: 9, // daily e-mails (reminders, birthdays) go out from this hour, Asia/Dubai
  payRemind: { on: false, tpl: 'Fee reminder', days: [3], overdue: true, overdueTpl: 'Payment overdue', since: '' },
  birthday: { on: false, tpl: 'Birthday wishes', since: '' },
  welcome: { on: false, tpl: 'Enrolment welcome', since: '' },
  quotation: { on: false, tpl: 'Quotation', since: '' },
  receipt: { on: false, tpl: 'Fee receipt', since: '' },
};
export const mailAutoSettings = (cfg: any) => {
  const a = cfg?.mailAuto || {};
  const out: any = { hour: Number.isInteger(a.hour) ? a.hour : MAIL_AUTO_DEFAULTS.hour };
  for (const k of MAIL_AUTO_KINDS) out[k] = { ...(MAIL_AUTO_DEFAULTS as any)[k], ...(a[k] || {}) };
  return out as typeof MAIL_AUTO_DEFAULTS;
};

/** Validates cfg.mailAuto; an automation switched on now starts from now (`since`), so nothing older is sent. */
export function checkMailAuto(next: unknown, cur: any): { problem: string } | { mailAuto?: typeof MAIL_AUTO_DEFAULTS } {
  if (next === undefined) return {};
  if (!next || typeof next !== 'object' || Array.isArray(next)) return { problem: 'Email Automation settings are invalid' };
  const n: any = next, prev = mailAutoSettings({ mailAuto: cur });
  const hour = Number(n.hour);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return { problem: 'Send time must be an hour from 0 to 23' };
  const out: any = { hour };
  for (const k of MAIL_AUTO_KINDS) {
    const v = n[k] || {}, def: any = (MAIL_AUTO_DEFAULTS as any)[k];
    const tpl = String(v.tpl ?? def.tpl).trim();
    if (!tpl || tpl.length > 80) return { problem: 'Choose a template for each automation' };
    const on = v.on === true, was = (prev as any)[k].on === true;
    out[k] = { on, tpl, since: on ? (was && (prev as any)[k].since ? (prev as any)[k].since : nowIso()) : '' };
    if (k === 'payRemind') {
      const days = [...new Set((Array.isArray(v.days) ? v.days : []).map(Number))] as number[];
      if (!days.length || days.length > 5 || days.some((d) => !Number.isInteger(d) || d < 0 || d > 60)) return { problem: 'Reminder days must be 1–5 whole numbers from 0 to 60' };
      const overdueTpl = String(v.overdueTpl ?? def.overdueTpl).trim();
      if (!overdueTpl || overdueTpl.length > 80) return { problem: 'Choose a template for overdue notices' };
      Object.assign(out[k], { days: days.sort((a, b) => b - a), overdue: v.overdue !== false, overdueTpl });
    }
  }
  return { mailAuto: out };
}

const PROVIDER = 'mail-auto';
const MAX_PER_RUN = 200;

/**
 * Runs the automations that are switched on. Reminders and birthdays go out once a day from the set hour;
 * welcome, quotation and receipt e-mails go out on the next run after the event. Each e-mail has a key, so it is
 * never sent twice; recipients without an e-mail address are logged as skipped. Test records are left out.
 */
export async function runMailAutomations(env: Env, now = Date.now(), opts: { force?: boolean } = {}) {
  const repo = new Repo(env.DB, 'Email automation');
  const cfg = await repo.setting<any>('cfg');
  const A = mailAutoSettings(cfg);
  const counts: Record<string, number> = {};
  const jobs: Job[] = [];
  if (!MAIL_AUTO_KINDS.some((k) => A[k].on)) return { jobs, counts };
  const today = dayKey(new Date(now));
  const hourNow = +new Date(now).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', hour12: false });
  const daily = opts.force || hourNow >= A.hour;
  const L = await lookups(repo);
  const since = (k: Kind) => (A[k].since ? dayKey(A[k].since) : today);

  const send = async (kind: Kind, key: string, target: MailTarget, tplName: string, extra: Record<string, string> = {}) => {
    if (jobs.length >= MAX_PER_RUN) return;
    const claim = await env.DB.prepare('INSERT OR IGNORE INTO webhook_events (provider,event_id,result) VALUES (?,?,?)')
      .bind(PROVIDER, key, JSON.stringify({ at: nowIso(), kind, ref: target.id, status: 'Processing' })).run();
    if (!claim.meta.changes) return; // already sent (or being sent)
    const r = await resolveTarget(repo, cfg, L, target);
    const t = findEmailTemplate(cfg?.emailTpls, tplName, r.branch);
    let status = 'Queued';
    if (r.skip) status = 'Skipped – ' + r.skip;
    else if (!t) status = `Skipped – template "${tplName}" is switched off`;
    else {
      const m = renderEmailTemplate(t, { ...r.values, ...extra });
      jobs.push(await queueMail(repo, r, m.subject, m.body, t.n, 'Email automation'));
      counts[kind] = (counts[kind] || 0) + 1;
    }
    await env.DB.prepare('UPDATE webhook_events SET result=? WHERE provider=? AND event_id=?')
      .bind(JSON.stringify({ at: nowIso(), kind, ref: target.id, to: r.to, template: tplName, status }), PROVIDER, key).run();
  };

  // Payment reminders N days before each instalment, and one overdue notice (instalments overdue since switched on)
  if (A.payRemind.on && daily) {
    const active = await repo.many<any>('enrollment', "status IN ('Active','On Hold') AND json_extract(data,'$.sched') IS NOT NULL");
    for (const e of active) {
      if (e.test) continue;
      const term = (cfg?.payTerms || []).find((x: any) => x.id === e.term);
      for (const i of instStatus(e, term, today)) {
        const extra = { balance_due: amt(i.bal), amount: amt(i.amt), due_date: fmtDay(i.due), currency: e.cur || '', programme: nameOf(L.programs, e.prog) };
        const left = Math.round((Date.parse(i.due) - Date.parse(today)) / 864e5);
        if (['Upcoming', 'Due', 'Partly paid'].includes(i.st) && A.payRemind.days.includes(left)) {
          await send('payRemind', `pay:${e.id}:${i.n}:${i.due}:${left}`, { type: 'student', id: e.stu }, A.payRemind.tpl, extra);
        } else if (A.payRemind.overdue && i.st.startsWith('Overdue') && addDays(i.due, +(term?.grace || 0)) >= since('payRemind')) {
          await send('payRemind', `ovd:${e.id}:${i.n}`, { type: 'student', id: e.stu }, A.payRemind.overdueTpl, extra);
        }
      }
    }
  }
  // Birthdays: active students whose date of birth is today (Asia/Dubai)
  if (A.birthday.on && daily) {
    const rows = (await env.DB.prepare("SELECT data FROM docs WHERE type='student' AND is_test=0 AND substr(json_extract(data,'$.dob'),6)=?").bind(today.slice(5)).all<{ data: string }>()).results || [];
    for (const s of rows.map((x) => JSON.parse(x.data))) {
      if (s.status && s.status !== 'Active') continue;
      await send('birthday', `bday:${s.id}:${today.slice(0, 4)}`, { type: 'student', id: s.id }, A.birthday.tpl);
    }
  }
  // Welcome: enrolments made since the automation was switched on
  if (A.welcome.on) {
    for (const e of await repo.many<any>('enrollment', 'at >= ?', [since('welcome')])) {
      if (e.test || e.status === 'Withdrawn') continue;
      await send('welcome', `welcome:${e.id}`, { type: 'student', id: e.stu }, A.welcome.tpl, { programme: nameOf(L.programs, e.prog), package: e.pkg || '' });
    }
  }
  // Quotation: opportunities whose admission decision became "Accepted" since switched on, not yet enrolled
  if (A.quotation.on) {
    for (const o of await repo.many<any>('opp', 'status=?', ['Admission Decision'])) {
      if (o.test || o.decision !== 'Accepted' || o.stu) continue;
      const at = [...(o.hist || [])].reverse().find((h: any) => /^Admission decision: Accepted/.test(String(h.text || '')))?.at;
      if (!at || at < A.quotation.since) continue;
      await send('quotation', `quote:${o.id}`, { type: 'opp', id: o.id }, A.quotation.tpl);
    }
  }
  // Receipt confirmation: payments recorded since switched on (tax invoices follow from accounts / ERPNext)
  if (A.receipt.on) {
    for (const p of await repo.many<any>('payment', 'at >= ?', [A.receipt.since])) {
      if (p.test || !p.stu) continue;
      const e = p.enr ? await repo.get<any>('enrollment', p.enr) : null;
      await send('receipt', `rcpt:${p.id}`, { type: 'student', id: p.stu }, A.receipt.tpl, {
        amount: amt(p.amt), currency: p.cur || e?.cur || '', receipt_no: p.rc || p.id, payment_date: fmtDay(p.at), payment_method: p.method || '',
        balance_due: e ? amt(r2((+e.total || 0) - (+e.paid || 0))) : '', programme: e ? nameOf(L.programs, e.prog) : '',
      });
    }
  }
  return { jobs, counts };
}

/** The most recent automated e-mails and what happened to each (Configuration → Email Automation). */
export async function recentAutoMail(env: Env, limit = 100) {
  const rows = (await env.DB.prepare('SELECT event_id, received_at, result FROM webhook_events WHERE provider=? ORDER BY received_at DESC LIMIT ?').bind(PROVIDER, limit).all<any>()).results || [];
  return rows.map((r) => ({ key: r.event_id, receivedAt: r.received_at, ...JSON.parse(r.result || '{}') }));
}
