// Integration-backed workflows: LMS enrol/cancel calls, outbound messages, ERPNext push, calendar, payment links.
import { Repo, nowIso } from '../lib/db';
import type { Env, Job, User } from '../types';
import { applySync, type Change } from '../sync/sync';
import { loadUser } from '../lib/auth';
import { modeFor, enabledInConfig, writeLog } from '../integrations/base';
import * as lms from '../integrations/lms';
import { lmsEnrolPayload, lmsMissing } from './terms';
import * as wa from '../integrations/whatsapp';
import * as erp from '../integrations/erpnext';
import { calendarInsert } from '../integrations/gcal-email';
import { deliverEmail } from './mail';
import { loadBillingDoc, invoicePdf, receiptPdf, paymentEmailHtml, docFileNames } from './billing-docs';
import type { MailAttachment } from '../integrations/smtp';
import { gatewayFor, telrCreate, razorpayCreate, razorpayCancel, type LinkInput } from '../integrations/payments';
import { addAudit, addEv, dayKey, fmtDT, money, notify, recordPayment, r2, templateParams } from './core';
import { ID_FORMAT } from '../lib/indexing';

const testFlags = (repo: Repo) => repo.setting<any>('test_flags');

// ---------------- LMS (enrol / cancel calls) ----------------
export async function processSync(env: Env, repo: Repo, syncId: string) {
  const m = await repo.get<any>('moodle_sync', syncId);
  if (!m) return null;
  const cfg = await repo.setting<any>('cfg');
  const flags = await testFlags(repo);
  const isTest = repo.isTest || !!m.test;
  const lc: lms.LmsCtx = { env, mode: modeFor(env, cfg, 'lms', isTest), isTest, flags };
  const s = await repo.get<any>('student', m.stu);
  const e = await repo.get<any>('enrollment', m.enr);
  const op = m.op === 'cancel' ? 'cancel' : 'enrol';
  const tag = lc.mode === 'mock' ? ' (mock)' : '';
  m.status = 'Processing';
  m.attempts = (m.attempts || 0) + 1;
  m.hist = m.hist || [];
  m.hist.push({ at: nowIso(), s: 'Processing', msg: `${op === 'cancel' ? 'Cancel' : 'Enrol'} call, attempt ${m.attempts}${tag}` });
  await repo.put('moodle_sync', m);
  let missing = false;
  try {
    if (!s || !e) throw new Error('Student or enrolment record missing');
    let msg: string;
    if (op === 'enrol' && e.status === 'Withdrawn') {
      // Never re-open LMS access after a withdrawal (e.g. a late retry of a failed enrol call)
      m.status = 'Closed'; m.err = ''; m.last = nowIso();
      m.hist.push({ at: m.last, s: 'Closed', msg: 'Not sent – the enrolment was withdrawn' });
      await repo.put('moodle_sync', m);
      return m;
    }
    if (op === 'cancel') {
      await lms.cancel(lc, e.id, m.id);
      msg = `LMS withdrew unused credits for reference ${e.id}${tag}`;
    } else {
      const program = await repo.get<any>('program', e.prog);
      const payload = lmsEnrolPayload(e, s, program, cfg.lms || {});
      const miss = lmsMissing(payload);
      if (miss.length) { missing = true; throw new Error('Not sent – missing ' + miss.join(', ') + ' (Settings → LMS Integration)'); }
      await lms.enrol(lc, payload, m.id);
      m.cid = payload.products[0].track;
      m.credits = payload.products[0].credits;
      msg = `LMS accepted reference ${e.id}: Track ${m.cid} with ${m.credits.length} credit(s), valid until ${payload.valid_until}${tag}`;
    }
    m.status = 'Success';
    m.err = '';
    m.last = nowIso();
    m.hist.push({ at: m.last, s: 'Success', msg });
    await repo.put('moodle_sync', m);
    await notify(repo, { type: 'moodle', sev: 'ok', text: `LMS ${op} call succeeded for ${s.first} ${s.last} (${m.enr})`, route: { page: 'integration' }, roles: ['Admissions Head', 'System Administrator', 'Centre Administrator'], branch: e.branch });
    await addAudit(repo, `LMS ${op} call`, m.id, `Success${tag}`, 'System');
  } catch (err: any) {
    const max = cfg.integ?.lms?.retryMax ?? 3;
    // Missing set-up data cannot be fixed by retrying: it waits for a person (Retry after fixing the codes)
    m.status = missing || m.attempts >= max ? 'Retry Required' : 'Failed';
    m.err = String(err?.message || err);
    m.last = nowIso();
    m.hist.push({ at: m.last, s: m.status, msg: m.err });
    await repo.put('moodle_sync', m);
    await notify(repo, { type: 'moodle', sev: 'crit', text: `LMS ${op} call failed for ${s ? s.first + ' ' + s.last : m.stu} (${m.enr}): ${m.err}`, route: { page: 'integration' }, roles: ['Admissions Head', 'System Administrator', 'Centre Administrator'], branch: e?.branch });
    await addAudit(repo, 'Integration error', m.id, `LMS ${op} call ${m.status}: ${m.err}`, 'System');
  }
  return m;
}

// ---------------- WhatsApp / e-mail ----------------
export async function sendComm(env: Env, repo: Repo, commId: string) {
  const c = await repo.get<any>('comm', commId);
  if (!c || !/^Queued/.test(c.status)) return c;
  const l = await repo.get<any>('lead', c.lead);
  const cfg = await repo.setting<any>('cfg');
  if (!l) return c;
  const isTest = repo.isTest || !!c.test || !!l.test;
  const tpl = (cfg.comms || []).find((t: any) => t.id === c.tplId) || (cfg.comms || []).find((t: any) => t.n === c.tpl && t.ch === c.ch);
  try {
    if (c.ch === 'WhatsApp') {
      if (cfg.consentReq?.wa && !l.wa) throw new Error('Blocked – no WhatsApp consent');
      const mode = modeFor(env, cfg, 'whatsapp', isTest);
      let r;
      if (tpl?.waTemplate) {
        const [branch, programs, cslr] = await Promise.all([repo.get<any>('branch', l.branch), repo.many<any>('program'), l.cslr ? repo.get<any>('staff', l.cslr) : null]);
        const progName = (programs.find((p) => p.id === l.prog) || { name: l.prog }).name;
        const params = templateParams(tpl.body, l, { progName, branchName: branch?.name || l.branch, counsellor: cslr?.name || 'our team' });
        r = await wa.sendTemplate({ env, mode, isTest }, l.phone, tpl.waTemplate, tpl.waLang || env.WHATSAPP_TEMPLATE_LANG || 'en', params, c.id);
      } else {
        r = await wa.sendText({ env, mode, isTest }, l.phone, c.text, c.id);
      }
      c.waMsgId = r.id;
      c.status = mode === 'live' ? 'Sent' : 'Sent (mock)';
    } else {
      if (cfg.consentReq?.em && !l.em) throw new Error('Blocked – no email consent');
      if (!l.email) throw new Error('No e-mail address on lead');
      const mode = modeFor(env, cfg, 'email', isTest);
      const branch = await repo.get<any>('branch', l.branch);
      const subject = c.subj || tpl?.subject || `Your enquiry at Lab of Future ${branch?.name || ''}`.trim();
      const r = await deliverEmail(env, cfg, { mode, isTest }, { to: l.email, subject, text: c.text, ref: c.id, inReplyTo: c.inReplyTo, references: c.refs });
      c.mailId = r.id;
      c.status = mode === 'live' ? 'Sent' : 'Sent (mock)';
    }
    c.sentAt = nowIso();
  } catch (err: any) {
    c.status = 'Failed – ' + String(err?.message || err).slice(0, 160);
    addEv(l, 'warn', `${c.ch} "${c.tpl}" failed: ${c.status.slice(9)}`);
    await repo.put('lead', l);
  }
  await repo.put('comm', c);
  return c;
}

export async function sendStudentMail(env: Env, repo: Repo, studentId: string, index: number) {
  const s = await repo.get<any>('student', studentId);
  const entry = s?.comm?.[index];
  if (!s || !entry || entry.mailId || !/simulated|Queued/i.test(entry.status)) return;
  const cfg = await repo.setting<any>('cfg');
  const mode = modeFor(env, cfg, 'email', repo.isTest || !!s.test);
  const to = entry.to || (s.parents || [])[0]?.email;
  try {
    if (!to) throw new Error('No parent e-mail');
    // Payment e-mails: the receipt in the e-mail body, invoice and receipt as PDF attachments
    let extra: { html?: string; attachments?: MailAttachment[] } = {};
    if (entry.docs?.payment) {
      try {
        const d = await loadBillingDoc(repo, String(entry.docs.payment));
        if (d) {
          const names = docFileNames(d), logo = `${String(env.APP_BASE_URL || '').replace(/\/+$/, '')}/lof-logo.png`;
          extra = {
            html: paymentEmailHtml(entry.text, d, logo),
            attachments: [
              { filename: names.invoice, contentType: 'application/pdf', content: await invoicePdf(d) },
              { filename: names.receipt, contentType: 'application/pdf', content: await receiptPdf(d) },
            ],
          };
        }
      } catch (err: any) {
        console.warn(`invoice/receipt for ${entry.docs.payment} not attached:`, err?.message || err); // the text e-mail still goes out
      }
    }
    const r = await deliverEmail(env, cfg, { mode, isTest: repo.isTest || !!s.test }, { to, subject: entry.subject || `Welcome to Lab of Future – ${s.first} ${s.last} (${s.id})`, text: entry.text, ref: s.id, inReplyTo: entry.inReplyTo, references: entry.refs, ...extra });
    if (extra.attachments) entry.attached = extra.attachments.map((a) => a.filename);
    entry.mailId = r.id;
    entry.status = mode === 'live' ? 'Sent' : 'Sent (mock)';
  } catch (err: any) {
    entry.status = 'Failed – ' + String(err?.message || err).slice(0, 160);
  }
  await repo.put('student', s);
}

/** Transactional message to the parent on a student record (e.g. a payment link); recorded on the student. */
export async function sendToParent(env: Env, repo: Repo, s: any, channel: 'WhatsApp' | 'Email', text: string) {
  const cfg = await repo.setting<any>('cfg');
  const parent = (s?.parents || [])[0] || {};
  const entry: any = { at: nowIso(), ch: channel, tpl: 'Payment link', text, status: 'Queued' };
  try {
    if (channel === 'Email') {
      if (!parent.email) throw new Error('No parent e-mail on the student record');
      const mode = modeFor(env, cfg, 'email', !!s.test || repo.isTest);
      const r = await deliverEmail(env, cfg, { mode, isTest: !!s.test }, { to: parent.email, subject: `Payment link – ${s.first} ${s.last} (${s.id})`, text, ref: s.id });
      entry.mailId = r.id; entry.status = mode === 'live' ? 'Sent' : 'Sent (mock)';
    } else {
      if (!parent.mobile) throw new Error('No parent mobile on the student record');
      const mode = modeFor(env, cfg, 'whatsapp', !!s.test || repo.isTest);
      const r = await wa.sendText({ env, mode, isTest: !!s.test }, parent.mobile, text, s.id);
      entry.waMsgId = r.id; entry.status = mode === 'live' ? 'Sent' : 'Sent (mock)';
    }
  } catch (err: any) {
    entry.status = 'Failed – ' + String(err?.message || err).slice(0, 160);
  }
  s.comm = [...(s.comm || []), entry];
  await repo.put('student', s);
  return { ok: !entry.status.startsWith('Failed'), status: entry.status };
}

// ---------------- ERPNext ----------------
export async function pushPaymentToErp(env: Env, repo: Repo, paymentId: string) {
  const p = await repo.get<any>('payment', paymentId);
  if (!p || p.erp?.name) return p;
  const cfg = await repo.setting<any>('cfg');
  const mode = modeFor(env, cfg, 'erpnext', repo.isTest || !!p.test);
  const x: erp.ErpCtx = { env, cfg, mode, isTest: repo.isTest || !!p.test };
  const s = await repo.get<any>('student', p.stu);
  try {
    const parent = (s?.parents || [])[0] || {};
    const customer = await erp.ensureCustomer(x, { name: parent.name || `${s?.first} ${s?.last}`, phone: parent.mobile, email: parent.email, studentId: p.stu }, p.id);
    const r = await erp.createPaymentEntry(x, p, customer, s ? `${s.first} ${s.last}` : p.stu);
    p.erp = { name: r.name, at: nowIso(), mode, existing: !!r.existing };
  } catch (err: any) {
    p.erp = { error: String(err?.message || err), at: nowIso(), mode, attempts: (p.erp?.attempts || 0) + 1 };
    await notify(repo, { type: 'erp', sev: 'warn', text: `ERPNext push failed for ${p.rc}: ${p.erp.error}`, route: { page: 'payRecords' }, roles: ['System Administrator', 'Management'], branch: p.branch });
  }
  await repo.put('payment', p);
  return p;
}

// ---------------- Google Calendar ----------------
export async function calendarForTask(env: Env, repo: Repo, taskId: string) {
  const t = await repo.get<any>('task', taskId);
  const cfg = await repo.setting<any>('cfg');
  if (!t || t.calEvent || !enabledInConfig(cfg, 'gcal')) return t;
  const l = await repo.get<any>('lead', t.lead);
  const cs = t.cslr ? await repo.get<any>('staff', t.cslr) : null;
  try {
    const r = await calendarInsert({ env, mode: modeFor(env, cfg, 'gcal', repo.isTest || !!t.test), isTest: repo.isTest || !!t.test }, {
      summary: `${t.type}: ${l?.student} (${l?.parent})`, description: `Lead ${t.lead} · ${l?.phone} · counsellor ${cs?.name || '—'}\n${t.remarks || ''}`,
      start: t.due, minutes: 15, taskId: t.id,
    });
    t.calEvent = r.id;
  } catch (err: any) {
    t.calError = String(err?.message || err);
  }
  await repo.put('task', t);
  return t;
}

// ---------------- Payment links ----------------
/** Links staff share are valid for this long; reminder links stay open until the next reminder replaces them. */
export const LINK_HOURS = 24;
/** The address parents get: the CRM's own page, which shows "already paid" / "expired" or forwards to the gateway. */
export const payLinkUrl = (env: Env, id: string) => `${env.APP_BASE_URL.replace(/\/+$/, '')}/webhooks/pay/l/${id}`;
/** True when a link that is still open has run past its validity. */
export const linkExpired = (link: any, now = nowIso()) => link.status === 'created' && !!link.expires_at && link.expires_at < now;

export async function createPaymentLink(env: Env, repo: Repo, enrId: string, amount: number | undefined, createdBy: string, opts: { kind?: 'collect' | 'reminder' } = {}) {
  const e = await repo.get<any>('enrollment', enrId);
  if (!e) throw new Error('Enrollment not found');
  if (e.status === 'Withdrawn') throw new Error('Enrollment is withdrawn');
  const outstanding = r2(e.total - e.paid);
  const amt = r2(amount ?? outstanding);
  if (!(amt > 0) || amt > outstanding + 0.005) throw new Error(`Amount must be between 0 and the outstanding ${money(outstanding, e.cur)}`);
  const s = await repo.get<any>('student', e.stu);
  const parent = (s?.parents || [])[0] || {};
  const programs = await repo.many<any>('program');
  return makeLink(env, repo, {
    amount: amt, currency: e.cur, enrollmentId: e.id, isTest: repo.isTest || !!e.test, createdBy, kind: opts.kind || 'collect',
    description: `Lab of Future – ${(programs.find((p) => p.id === e.prog) || { name: e.prog }).name} – ${s?.first} ${s?.last} (${e.id})`,
    customer: { name: parent.name || `${s?.first} ${s?.last}`, email: parent.email, phone: parent.mobile },
  });
}

/** Creates the hosted link at the gateway and stores it. */
async function makeLink(env: Env, repo: Repo, a: {
  amount: number; currency: string; enrollmentId: string; isTest: boolean; createdBy: string; description: string;
  customer: LinkInput['customer']; oppId?: string; draft?: string; draftBy?: string; kind: 'collect' | 'opp' | 'reminder';
}) {
  const cfg = await repo.setting<any>('cfg');
  const provider = gatewayFor(a.currency);
  const mode = modeFor(env, cfg, provider, a.isTest);
  // Random, unguessable link ids (they appear in customer-facing URLs)
  const rand = [...crypto.getRandomValues(new Uint8Array(10))].map((x) => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[x % 31]).join('');
  const linkId = (a.isTest ? 'TST-PL-' : 'PL-') + rand;
  if (mode === 'mock' && env.APP_ENV === 'production' && !a.isTest) {
    throw new Error(`Online payments are not set up yet – ${provider === 'telr' ? 'Telr' : 'Razorpay'} is not live. Record the payment at the counter instead.`);
  }
  const base = env.APP_BASE_URL.replace(/\/+$/, '');
  // Reminder links have no time limit (the next reminder replaces them); everything else works for 24 hours
  const expiresAt = a.kind === 'reminder' ? null : new Date(Date.now() + LINK_HOURS * 36e5).toISOString();
  const input: LinkInput = {
    linkId, amount: a.amount, currency: a.currency, description: a.description, customer: a.customer,
    returnUrl: `${base}/webhooks/pay/return?link=${linkId}`, callbackUrl: `${base}/webhooks/${provider}`,
    ...(expiresAt ? { expireBy: Math.floor(Date.parse(expiresAt) / 1000) } : {}),
  };
  const ctx = { env, mode, isTest: a.isTest };
  const r = provider === 'telr' ? await telrCreate(ctx, input) : await razorpayCreate(ctx, input);
  await env.DB.prepare('INSERT INTO payment_links (id,provider,provider_ref,enrollment_id,amount,currency,url,status,created_by,is_test,opp_id,draft,draft_by,expires_at,kind) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(linkId, mode === 'mock' ? `${provider}-mock` : provider, r.providerRef, a.enrollmentId, a.amount, a.currency, r.url, 'created', a.createdBy, a.isTest ? 1 : 0, a.oppId ?? null, a.draft ?? null, a.draftBy ?? null, expiresAt, a.kind).run();
  await addAudit(repo, 'Payment link created', linkId, `${money(a.amount, a.currency)} via ${provider}${mode === 'mock' ? ' (mock)' : ''} for ${a.oppId ? `${a.oppId} (enrols ${a.enrollmentId} on payment)` : a.enrollmentId}`, a.createdBy);
  return { id: linkId, provider, mode, url: payLinkUrl(env, linkId), providerRef: r.providerRef, amount: a.amount, currency: a.currency, expiresAt };
}

/**
 * Link for an instalment reminder e-mail. It has no time limit; sending it closes the link of the previous reminder
 * for the same enrolment, so only the latest reminder's link can be paid.
 */
export async function reminderLink(env: Env, repo: Repo, enrId: string, amount: number) {
  const old = (await env.DB.prepare("SELECT id,provider,provider_ref,is_test FROM payment_links WHERE enrollment_id=? AND kind='reminder' AND status='created'").bind(enrId).all<any>()).results || [];
  await env.DB.prepare("UPDATE payment_links SET status='replaced' WHERE enrollment_id=? AND kind='reminder' AND status='created'").bind(enrId).run();
  const cfg = await repo.setting<any>('cfg');
  for (const l of old) {
    if (!String(l.provider).startsWith('razorpay')) continue;
    try { await razorpayCancel({ env, mode: l.provider.endsWith('-mock') ? 'mock' : modeFor(env, cfg, 'razorpay', !!l.is_test), isTest: !!l.is_test }, l.provider_ref); } catch (e) { console.error('razorpay cancel', l.id, e); }
  }
  return createPaymentLink(env, repo, enrId, amount, 'Email automation', { kind: 'reminder' });
}

// ---------------- Payment links shared from an opportunity ----------------
// The enrolment form is filled in when the link is shared. It is checked then (dry run) and kept with the link;
// when the parent pays, the same changes are applied – the student is enrolled – and the payment is recorded.
const DRAFT_COLLS = ['students', 'enr', 'opps', 'leads', 'ms', 'notifs', 'audit'];
/** The parent's payment is what enrols the student: whoever may share the link has enrolment rights for this one form. */
export function linkPerms(perms: any, user: User) {
  const p = structuredClone(perms || {});
  p.enrollments ||= {};
  const cur = String(p.enrollments[user.role] || '');
  if (!cur.includes('C')) p.enrollments[user.role] = cur + 'C';
  return p;
}
/** Counsellors (edit opportunities), enrolment staff and payment staff may share an opportunity's payment link. */
export const canShareOppLink = (perms: any, user: User) =>
  String(perms?.enrollments?.[user.role] || '').includes('C') || String(perms?.opportunities?.[user.role] || '').includes('E') || String(perms?.payments?.[user.role] || '').includes('C');

export async function createOppPaymentLink(env: Env, repo: Repo, user: User, perms: any, oppId: string, changes: Change[], amount: number | undefined) {
  const opp = await repo.get<any>('opp', oppId);
  if (!opp) throw new Error('Opportunity not found');
  if (['Enrolled', 'Lost'].includes(opp.stage)) throw new Error(`This opportunity is already ${opp.stage.toLowerCase()}`);
  if (!Array.isArray(changes) || !changes.length || changes.length > 20) throw new Error('Fill in the enrolment details first');
  if (changes.some((c) => !c || c.op !== 'upsert' || !DRAFT_COLLS.includes(c.coll))) throw new Error('The payment link form can hold only the student, the enrolment and the opportunity');
  const enrCh = changes.filter((c) => c.coll === 'enr');
  if (enrCh.length !== 1 || enrCh[0].doc?.opp !== oppId || enrCh[0].base) throw new Error('The form must hold one new enrolment for this opportunity');
  if (changes.some((c) => (c.coll === 'opps' && c.id !== oppId) || (c.coll === 'leads' && (c.id !== opp.lead || !c.base)))) throw new Error('The form can change only this opportunity and its lead');
  const draft: Change[] = changes.map((c) => ({ coll: c.coll, id: c.id, op: 'upsert' as const, doc: c.doc, ...(c.base ? { base: c.base } : {}) }));
  const check = await applySync(env, repo, user, linkPerms(perms, user), structuredClone(draft), [], { dryRun: true });
  if (!check.ok) throw new Error(check.rejected.map((x) => x.reason).join('; '));
  const e = check.docs.find((x) => x.coll === 'enr')!.doc;
  const stu = check.docs.find((x) => x.coll === 'students')?.doc || (await repo.get<any>('student', e.stu));
  const lead = await repo.get<any>('lead', opp.lead);
  const amt = r2(amount ?? e.sched?.[0]?.amt ?? e.total);
  if (!(amt > 0) || amt > e.total + 0.005) throw new Error(`Amount must be between 0 and the fee ${money(e.total, e.cur)}`);
  const parent = (stu?.parents || [])[0] || {};
  const programs = await repo.many<any>('program');
  // One open link per opportunity: a new one replaces the previous (a payment on an older link still enrols only once)
  await env.DB.prepare("UPDATE payment_links SET status='replaced' WHERE opp_id=? AND status='created' AND draft IS NOT NULL").bind(oppId).run();
  const link = await makeLink(env, repo, {
    amount: amt, currency: e.cur, enrollmentId: e.id, isTest: repo.isTest || !!opp.test, createdBy: user.name, oppId, draft: JSON.stringify(draft), draftBy: user.id, kind: 'opp',
    description: `Lab of Future – ${(programs.find((p) => p.id === e.prog) || { name: e.prog }).name} – ${stu ? `${stu.first} ${stu.last}` : opp.student} (${oppId})`,
    customer: { name: parent.name || lead?.parent || opp.parent || opp.student, email: parent.email || lead?.email, phone: parent.mobile || lead?.phone },
  });
  const full = amt >= e.total - 0.005;
  opp.hist = [...(opp.hist || []), { at: nowIso(), by: user.name, text: `Payment link ${link.id} shared: ${money(amt, e.cur)}${full ? ' (full fee)' : ` of ${money(e.total, e.cur)} (first instalment)`} – the student is enrolled automatically on payment` }];
  await repo.put('opp', opp);
  return { ...link, opp: oppId, enrollment: e.id, total: e.total, full, student: stu ? `${stu.first} ${stu.last}` : opp.student, oppDoc: opp };
}

/** Makes sure the enrolment a paid opportunity link stands for exists; applies the stored form when it does not. */
async function enrolFromDraft(env: Env, repo: Repo, link: any): Promise<{ enrId: string; jobs: Job[] } | { error: string }> {
  const have = await repo.get<any>('enrollment', link.enrollment_id);
  if (have) return { enrId: have.id, jobs: [] };
  const opp = link.opp_id ? await repo.get<any>('opp', link.opp_id) : null;
  if (!opp) return { error: 'the opportunity no longer exists' };
  if (opp.stage === 'Enrolled') {
    // Enrolled meanwhile (at the counter or through another link): the payment goes to that enrolment
    const e = (await repo.many<any>('enrollment', "json_extract(data,'$.opp')=?", [opp.id])).find((x) => x.status !== 'Withdrawn');
    return e ? { enrId: e.id, jobs: [] } : { error: 'the opportunity is enrolled but its enrolment was not found' };
  }
  if (opp.stage === 'Lost') return { error: 'the opportunity was marked lost' };
  const user = link.draft_by ? await loadUser(repo, link.draft_by) : null;
  if (!user) return { error: 'the staff member who shared the link no longer has access' };
  if (!user.scope.includes(opp.branch)) return { error: `${user.name} no longer has access to this branch` };
  const draft: Change[] = JSON.parse(link.draft);
  for (const c of draft) if (c.coll === 'enr' && c.doc) c.doc.date = dayKey(new Date()); // enrolled on the day the parent paid
  const perms = await repo.setting<any>('perms');
  const r = await applySync(env, repo, user, linkPerms(perms, user), draft);
  if (!r.ok) return { error: r.rejected.map((x) => x.reason).join('; ') };
  await addAudit(repo, 'Enrolled from payment link', link.enrollment_id, `${opp.id} enrolled when the parent paid ${link.id}`, 'Payment gateway');
  return { enrId: link.enrollment_id, jobs: r.jobs };
}

/** A Telr order closes on Telr's side after a while; a link that is still valid in the CRM gets a fresh order. */
export async function reopenTelrOrder(env: Env, repo: Repo, link: any) {
  let name = 'Parent', email: string | undefined, phone: string | undefined;
  const e = await repo.get<any>('enrollment', link.enrollment_id);
  if (e) {
    const p = ((await repo.get<any>('student', e.stu))?.parents || [])[0] || {};
    name = p.name || name; email = p.email; phone = p.mobile;
  } else if (link.opp_id) {
    const o = await repo.get<any>('opp', link.opp_id);
    const l = o ? await repo.get<any>('lead', o.lead) : null;
    name = l?.parent || o?.parent || name; email = l?.email; phone = l?.phone;
  }
  const cfg = await repo.setting<any>('cfg');
  const base = env.APP_BASE_URL.replace(/\/+$/, '');
  const r = await telrCreate({ env, mode: modeFor(env, cfg, 'telr', !!link.is_test), isTest: !!link.is_test }, {
    linkId: link.id, amount: link.amount, currency: link.currency, description: `Lab of Future – payment ${link.id}`, customer: { name, email, phone },
    returnUrl: `${base}/webhooks/pay/return?link=${link.id}`, callbackUrl: `${base}/webhooks/telr`,
  });
  await env.DB.prepare("UPDATE payment_links SET provider_ref=?, url=? WHERE id=? AND status='created'").bind(r.providerRef, r.url, link.id).run();
  return r.url;
}

/** Marks a link paid and records the CRM payment exactly once (webhook, return URL or reconciliation). */
export async function settleLink(env: Env, repo: Repo, linkId: string, info: { amount: number; txnRef: string; method: string }) {
  const link = await env.DB.prepare('SELECT * FROM payment_links WHERE id=?').bind(linkId).first<any>();
  if (!link) throw new Error('Payment link not found');
  if (link.status === 'paid') return { already: true, paymentId: link.payment_id };
  // Claim the link atomically so concurrent webhook + return URL cannot double-record
  const claim = await env.DB.prepare("UPDATE payment_links SET status='paid', paid_at=? WHERE id=? AND status<>'paid'").bind(nowIso(), linkId).run();
  if (!claim.meta.changes) return { already: true };
  repo.isTest = repo.isTest || !!link.is_test;
  let p: any;
  let jobs: Job[] = [];
  try {
    let enrId = link.enrollment_id;
    let amt = Math.min(info.amount || link.amount, link.amount);
    if (link.draft) {
      // Shared from an opportunity: enrol the student first (once), then record the payment against that enrolment
      const ready = await enrolFromDraft(env, repo, link);
      const e = 'enrId' in ready ? await repo.get<any>('enrollment', ready.enrId) : null;
      const open = e ? r2(e.total - e.paid) : 0;
      if (!('enrId' in ready) || !e || open <= 0.005) return await paidNotApplied(env, repo, link, info, 'error' in ready ? ready.error : 'the enrolment is already fully paid');
      enrId = e.id;
      jobs = ready.jobs;
      amt = Math.min(amt, open);
    }
    p = await recordPayment(repo, { enr: enrId, amt, method: info.method, ref: info.txnRef, by: 'Payment gateway', gateway: { provider: link.provider, link: linkId, ref: link.provider_ref, txn: info.txnRef } });
  } catch (err) {
    // nothing was recorded – reopen the link so the gateway can retry
    await env.DB.prepare("UPDATE payment_links SET status='created', paid_at=NULL WHERE id=? AND payment_id IS NULL").bind(linkId).run();
    throw err;
  }
  // The payment exists from here on: the link stays paid whatever happens next
  await env.DB.prepare('UPDATE payment_links SET payment_id=? WHERE id=?').bind(p.id, linkId).run();
  try {
    const s = await repo.get<any>('student', p.stu);
    await notify(repo, { type: 'pay', sev: 'ok', text: `Payment received online: ${money(p.amt, p.cur)} – ${s?.first} ${s?.last} (${p.rc})`, route: { page: 'payRecords' }, roles: ['Reception', 'Centre Administrator', 'Management'], branch: p.branch });
    await addAudit(repo, 'Payment recorded (gateway)', p.id, `${money(p.amt, p.cur)} · ${link.provider} ${info.txnRef} · ${p.rc}`, 'Payment gateway');
  } catch (e) { console.error('post-payment notification failed', e); }
  return { paymentId: p.id, payment: p, jobs };
}

/** The parent paid but the student could not be enrolled automatically: the link stays paid and the centre finishes by hand. */
async function paidNotApplied(env: Env, repo: Repo, link: any, info: { amount: number; txnRef: string }, why: string) {
  await env.DB.prepare('UPDATE payment_links SET apply_error=? WHERE id=?').bind(why.slice(0, 500), link.id).run();
  const opp = link.opp_id ? await repo.get<any>('opp', link.opp_id) : null;
  const text = `Online payment ${money(info.amount || link.amount, link.currency)} received on link ${link.id}${opp ? ` for ${opp.student}` : ''}, but the student could not be enrolled automatically: ${why}. Enrol the student and record the payment with reference ${info.txnRef}.`;
  try {
    await notify(repo, { type: 'pay', sev: 'crit', text: text.slice(0, 300), route: { page: 'opps' }, roles: ['Reception', 'Centre Administrator', 'Admissions Head'], branch: opp?.branch });
    await addAudit(repo, 'Payment link paid – enrolment not completed', link.id, text.slice(0, 1000), 'Payment gateway');
  } catch (e) { console.error('paid-not-applied notification failed', e); }
  return { paymentId: null as string | null, needsManual: true, reason: why, jobs: [] as Job[] };
}

const SECRET_KEYS = /token|secret|password|authkey|signature|api[_-]?key/i;
const scrub = (v: unknown): string => {
  if (typeof v === 'string') {
    try { return scrub(JSON.parse(v)); } catch { return v.replace(/([?&](?:token|access_token|wstoken)=)[^&\s"]+/gi, '$1***'); }
  }
  return JSON.stringify(v, (k, val) => (k && SECRET_KEYS.test(k) ? '***' : val));
};
export async function logInbound(env: Env, integration: string, operation: string, ok: boolean, request: unknown, response: unknown, ref?: string, isTest = false, error?: string) {
  await writeLog(env, { integration, direction: 'in', operation, mode: 'live', ok, status: ok ? 200 : 400, request: scrub(request), response: scrub(response), ref, isTest, error });
}

export { fmtDT };
