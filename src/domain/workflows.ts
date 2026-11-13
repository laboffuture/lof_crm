// Integration-backed workflows: LMS enrol/cancel calls, outbound messages, ERPNext push, calendar, payment links.
import { Repo, nowIso } from '../lib/db';
import type { Env } from '../types';
import { modeFor, enabledInConfig, writeLog } from '../integrations/base';
import * as lms from '../integrations/lms';
import { lmsEnrolPayload, lmsMissing } from './terms';
import * as wa from '../integrations/whatsapp';
import * as erp from '../integrations/erpnext';
import { calendarInsert } from '../integrations/gcal-email';
import { deliverEmail } from './mail';
import { gatewayFor, telrCreate, razorpayCreate, type LinkInput } from '../integrations/payments';
import { addAudit, addEv, fmtDT, money, notify, recordPayment, r2, templateParams } from './core';
import { ID_FORMAT } from '../lib/indexing';

import { activatePaidLms } from './lms-orders';

const testFlags = (repo: Repo) => repo.setting<any>('test_flags');

// ---------------- LMS (enrol / cancel calls) ----------------
export async function processSync(env: Env, repo: Repo, syncId: string, options: { queued?: boolean } = {}) {
  const m = await repo.get<any>('moodle_sync', syncId);
  if (!m || ['Success', 'Closed', 'Warnings'].includes(m.status) || (options.queued && m.status !== 'Pending')) return m;
  // Queue jobs get a fresh System repository. Keep notifications/audit for test calls
  // in the test namespace as well, without changing the caller's repository scope.
  if (m.test && !repo.isTest) repo = new Repo(repo.db, repo.actor, true);
  const cfg = await repo.setting<any>('cfg');
  const isTest = repo.isTest || !!m.test;
  const lc: lms.LmsCtx = { env, mode: modeFor(env, cfg, 'lms', isTest), isTest, flags: await testFlags(repo) };
  const s = await repo.get<any>('student', m.stu);
  const e = await repo.get<any>('enrollment', m.enr);
  const op = m.op === 'cancel' ? 'cancel' : 'enrol';
  const tag = lc.mode === 'mock' ? ' (mock)' : '';
  m.hist ||= [];
  const hold = async (status: string, message: string) => {
    const at = nowIso();
    await env.DB.prepare("UPDATE docs SET status=?, data=json_insert(json_set(data,'$.status',?,'$.err',?,'$.last',?),'$.hist[#]',json(?)) WHERE type='moodle_sync' AND id=? AND status=? AND status NOT IN ('Processing','Success','Closed','Warnings')")
      .bind(status, status, message, at, JSON.stringify({ at, s: status, msg: message }), m.id, m.status).run();
    return repo.get<any>('moodle_sync', m.id);
  };
  if (!s || !e) return hold('Retry Required', 'Student or enrolment record missing');
  if (op === 'enrol' && e.status === 'Withdrawn') return hold('Closed', 'Not sent – the enrolment was withdrawn');
  if (op === 'enrol' && e.payStatus !== 'Paid') return hold('Awaiting Payment', 'Not sent – waiting for full payment (guide section 7)');
  // Business orders must reach Moodle in local/UAT environments too. Only explicit
  // Testing Console records and the automated test environment may simulate delivery.
  if (env.APP_ENV !== 'test' && !isTest && lc.mode !== 'live') return hold('Awaiting Setup', 'Not sent – enable LMS, set INTEGRATION_MODE=auto and configure LMS_URL / LMS_TOKEN; business orders cannot be simulated');
  if (lc.mode === 'live' && op === 'enrol' && !m.payload && (!cfg.lms?.confirmed || !cfg.lms?.packages?.[e.prog]?.[e.pkg])) return hold('Awaiting Setup', 'Not sent – confirm the exact LMS package mapping and branch codes with LOF');
  // Claim atomically. Queue redelivery and simultaneous retries must not issue overlapping calls.
  // A redelivered queue job may only claim Pending. Failed calls must first be
  // requeued by the timed scheduler or a staff retry, including after retryMax.
  const queuedOnly = options.queued ? " AND status='Pending'" : '';
  const claim = await env.DB.prepare("UPDATE docs SET status='Processing', data=json_set(data,'$.status','Processing','$.processingAt',?) WHERE type='moodle_sync' AND id=? AND status NOT IN ('Processing','Success','Closed','Warnings')" + queuedOnly)
    .bind(nowIso(), m.id).run();
  if (!claim.meta.changes) return repo.get<any>('moodle_sync', m.id);
  m.status = 'Processing'; m.processingAt = nowIso();
  m.attempts = (m.attempts || 0) + 1;
  m.hist.push({ at: m.processingAt, s: 'Processing', msg: `${op} call, attempt ${m.attempts}${tag}` });
  await repo.put('moodle_sync', m);
  try {
    let result: lms.Receipt;
    if (op === 'cancel') {
      const purchases = await repo.many<any>('moodle_sync', 'ref1=?', [e.id]);
      if (purchases.some((x) => x.op !== 'cancel' && x.status === 'Processing')) throw new lms.LmsError('Purchase is still processing; cancellation will retry', true);
      m.requestUrl = lc.mode === 'live' ? lms.diagnosticEndpoint(env) : null;
      await repo.put('moodle_sync', m);
      result = await lms.cancel(lc, e.id, m.id, m.reason);
    } else {
      const program = await repo.get<any>('program', e.prog);
      const payload: lms.Purchase = m.payload || lmsEnrolPayload(e, s, program, cfg.lms || {});
      const problems = lmsMissing(payload);
      if (problems.length) throw new lms.LmsError('Not sent – missing or invalid ' + problems.join(', '), false, 'localvalidation');
      // Freeze before the first network attempt. A timeout may mean LMS already received it.
      m.payload = payload;
      m.cid = payload.items[0]?.track || payload.skillslabs[0]?.program || '';
      m.credits = payload.items.flatMap((x) => x.credits);
      m.requestUrl = lc.mode === 'live' ? lms.diagnosticEndpoint(env) : null;
      await repo.put('moodle_sync', m);
      result = await lms.enrol(lc, payload, m.id);
    }
    m.response = result; m.deliveryMode = lc.mode;
    m.warnings = result.warnings || [];
    if (op === 'cancel' && result.purchaseknown === false) m.warnings.push({ item: 'reference', message: 'LMS has not received this purchase reference. Check it with LOF.' });
    m.status = m.warnings.length ? 'Warnings' : 'Success';
    m.err = m.warnings.map((w: any) => `${w.item ? w.item + ': ' : ''}${w.message}`).join('; ');
    m.last = nowIso();
    const msg = m.warnings.length ? `Received with warnings: ${m.err}` : `${result.duplicate ? 'Duplicate reference acknowledged' : 'LMS received ' + op + ' reference ' + e.id}; LMS staff processing/access verification is separate${tag}`;
    m.hist.push({ at: m.last, s: m.status, msg });
    await repo.put('moodle_sync', m);
    await notify(repo, { type: 'moodle', sev: m.warnings.length ? 'warn' : 'ok', text: `LMS ${op} ${m.warnings.length ? 'needs review' : 'received'} for ${s.first} ${s.last} (${m.enr})${tag}${m.err ? ': ' + m.err : ''}`, route: { page: 'integration' }, roles: ['Admissions Head', 'System Administrator', 'Centre Administrator'], branch: e.branch });
    await addAudit(repo, `LMS ${op} call`, m.id, `${m.status}${tag}`, 'System');
  } catch (err: any) {
    // Moodle explicitly says invalidparameter was not received: corrected data may be rebuilt.
    // For uncertain delivery (timeout/5xx/malformed response), the original snapshot stays frozen.
    if (err instanceof lms.LmsError && err.code === 'invalidparameter') delete m.payload;
    const max = cfg.integ?.lms?.retryMax ?? 3;
    m.status = err instanceof lms.LmsError && err.retryable && m.attempts < max ? 'Failed' : 'Retry Required';
    m.err = String(err?.message || err);
    m.last = nowIso();
    m.hist.push({ at: m.last, s: m.status, msg: m.err });
    await repo.put('moodle_sync', m);
    await notify(repo, { type: 'moodle', sev: 'crit', text: `LMS ${op} call failed for ${s.first} ${s.last} (${m.enr}): ${m.err}`, route: { page: 'integration' }, roles: ['Admissions Head', 'System Administrator', 'Centre Administrator'], branch: e.branch });
    await addAudit(repo, 'Integration error', m.id, `LMS ${op} call ${m.status}: ${m.err}`, 'System');
  }
  return m;
}

/** Called by gateway settlement after payment is durably recorded. Cron also recovers queued orders. */
export async function sendPaidLms(env: Env, repo: Repo, enrollmentId: string) {
  const e = await repo.get<any>('enrollment', enrollmentId);
  if (!e) return;
  for (const id of await activatePaidLms(repo, e)) {
    if (env.JOBS) await env.JOBS.send({ kind: 'moodle_sync', id });
    else await processSync(env, repo, id);
  }
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
      const r = await deliverEmail(env, cfg, { mode, isTest }, { to: l.email, subject, text: c.text, ref: c.id });
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
    const r = await deliverEmail(env, cfg, { mode, isTest: repo.isTest || !!s.test }, { to, subject: entry.subject || `Welcome to Lab of Future – ${s.first} ${s.last} (${s.id})`, text: entry.text, ref: s.id });
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
export async function createPaymentLink(env: Env, repo: Repo, enrId: string, amount: number | undefined, createdBy: string) {
  const e = await repo.get<any>('enrollment', enrId);
  if (!e) throw new Error('Enrollment not found');
  if (e.status === 'Withdrawn') throw new Error('Enrollment is withdrawn');
  const outstanding = r2(e.total - e.paid);
  const amt = r2(amount ?? outstanding);
  if (!(amt > 0) || amt > outstanding + 0.005) throw new Error(`Amount must be between 0 and the outstanding ${money(outstanding, e.cur)}`);
  const s = await repo.get<any>('student', e.stu);
  const parent = (s?.parents || [])[0] || {};
  const cfg = await repo.setting<any>('cfg');
  const provider = gatewayFor(e.cur);
  const mode = modeFor(env, cfg, provider, repo.isTest || !!e.test);
  // Random, unguessable link ids (they appear in customer-facing URLs)
  const rand = [...crypto.getRandomValues(new Uint8Array(10))].map((x) => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[x % 31]).join('');
  const linkId = (repo.isTest || e.test ? 'TST-PL-' : 'PL-') + rand;
  if (mode === 'mock' && env.APP_ENV === 'production' && !(repo.isTest || e.test)) {
    throw new Error(`Online payments are not set up yet – ${provider === 'telr' ? 'Telr' : 'Razorpay'} is not live. Record the payment at the counter instead.`);
  }
  const base = env.APP_BASE_URL.replace(/\/+$/, '');
  const programs = await repo.many<any>('program');
  const input: LinkInput = {
    linkId, amount: amt, currency: e.cur, description: `Lab of Future – ${(programs.find((p) => p.id === e.prog) || { name: e.prog }).name} – ${s?.first} ${s?.last} (${e.id})`,
    customer: { name: parent.name || `${s?.first} ${s?.last}`, email: parent.email, phone: parent.mobile },
    returnUrl: `${base}/webhooks/pay/return?link=${linkId}`, callbackUrl: `${base}/webhooks/${provider}`,
  };
  const ctx = { env, mode, isTest: repo.isTest || !!e.test };
  const r = provider === 'telr' ? await telrCreate(ctx, input) : await razorpayCreate(ctx, input);
  await env.DB.prepare('INSERT INTO payment_links (id,provider,provider_ref,enrollment_id,amount,currency,url,status,created_by,is_test) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(linkId, mode === 'mock' ? `${provider}-mock` : provider, r.providerRef, e.id, amt, e.cur, r.url, 'created', createdBy, ctx.isTest ? 1 : 0).run();
  await addAudit(repo, 'Payment link created', linkId, `${money(amt, e.cur)} via ${provider}${mode === 'mock' ? ' (mock)' : ''} for ${e.id}`, createdBy);
  return { id: linkId, provider, mode, url: r.url, providerRef: r.providerRef, amount: amt, currency: e.cur };
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
  try {
    const amt = Math.min(info.amount || link.amount, link.amount);
    p = await recordPayment(repo, { enr: link.enrollment_id, amt, method: info.method, ref: info.txnRef, by: 'Payment gateway', gateway: { provider: link.provider, link: linkId, ref: link.provider_ref, txn: info.txnRef } });
  } catch (err) {
    // nothing was recorded – reopen the link so the gateway can retry
    await env.DB.prepare("UPDATE payment_links SET status='created', paid_at=NULL WHERE id=? AND payment_id IS NULL").bind(linkId).run();
    throw err;
  }
  // The payment exists from here on: the link stays paid whatever happens next
  await env.DB.prepare('UPDATE payment_links SET payment_id=? WHERE id=?').bind(p.id, linkId).run();
  try {
    await sendPaidLms(env, repo, p.enr);
    const s = await repo.get<any>('student', p.stu);
    await notify(repo, { type: 'pay', sev: 'ok', text: `Payment received online: ${money(p.amt, p.cur)} – ${s?.first} ${s?.last} (${p.rc})`, route: { page: 'payRecords' }, roles: ['Reception', 'Centre Administrator', 'Management'], branch: p.branch });
    await addAudit(repo, 'Payment recorded (gateway)', p.id, `${money(p.amt, p.cur)} · ${link.provider} ${info.txnRef} · ${p.rc}`, 'Payment gateway');
  } catch (e) { console.error('post-payment notification failed', e); }
  return { paymentId: p.id, payment: p };
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
