// Configuration → Email Outgoing / Email Incoming (API side).
//   GET  /api/v1/mail/status              SMTP server, live/mock mode, sender address, settings still missing
//   PUT  /api/v1/mail/smtp                { host, port, security, user, from, pass? }  saves the SMTP server (password kept encrypted on the server)
//   POST /api/v1/mail/smtp/verify         connects and signs in to the SMTP server without sending
//   POST /api/v1/mail/test-send           { to }  sends a test e-mail with the Email Outgoing rules
//   GET  /api/v1/mail/inbound             the 50 most recent received e-mails and how each was filed
//   POST /api/v1/mail/inbound/simulate    { from, fromName, subject, text }  runs the Email Incoming rules on a sample e-mail
//   POST /api/v1/mail/inbound/check       reads new e-mails from the mailbox now (otherwise every 5 minutes)
//   POST /api/v1/mail/compose             { targets: [{ type: lead|opp|student, id }], template, subject, body, reply? }  individual / bulk e-mail
//                                         reply = { type: lead|student, id, comm?: lead comm id, index?: student comm index }
//                                         answers a received e-mail in the same conversation
//   GET  /api/v1/mail/automation/log      the 100 most recent automated e-mails (Configuration → Email Automation)
//   POST /api/v1/mail/automation/run      runs the switched-on automations now
// Viewing needs configuration view access; sending and simulating need configuration edit access.
import { Hono } from 'hono';
import { requireAuth, need, can, type AppEnv } from '../lib/auth';
import { allow } from '../lib/ratelimit';
import { Repo } from '../lib/db';
import { HttpError } from '../types';
import { addAudit } from '../domain/core';
import { deliverEmail, processInboundEmail, recentInbound, mailInStatus, pollMailbox } from '../domain/mail';
import { composeMail, recentAutoMail, runMailAutomations, MAX_BULK, type MailTarget } from '../domain/mail-send';
import { EMAIL_PLACEHOLDERS } from '../domain/email-templates';
import { modeFor, smtpMissing } from '../integrations/base';
import { SMTP_DEFAULTS, type SmtpSecurity } from '../integrations/smtp';
import { emailPing } from '../integrations/gcal-email';
import { MAIL_OUT_DEFAULTS } from '../domain/mail';
import { encryptSecret } from '../lib/totp';
import { dispatch } from '../jobs';

const mail = new Hono<AppEnv>();
mail.use('*', requireAuth);
const wait = (c: any) => (p: Promise<unknown>) => c.executionCtx.waitUntil(p);
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const cfgOf = (c: any) => new Repo(c.env.DB).setting<any>('cfg');

mail.get('/status', async (c) => {
  need(c, 'configuration', 'V');
  const cfg = await cfgOf(c);
  return c.json({
    outgoing: { provider: 'SMTP', mode: modeFor(c.env, cfg, 'email'), smtp: { ...SMTP_DEFAULTS, ...(cfg?.mailOut?.smtp || {}) }, from: cfg?.mailOut?.smtp?.from || '', missing: smtpMissing(cfg) },
    incoming: await mailInStatus(c.env, cfg),
  });
});

// ---------------- mailbox (Configuration → Email Incoming → Check now)
mail.post('/inbound/check', async (c) => {
  need(c, 'configuration', 'E');
  if (!(await allow(c.env, 'mail-in-check:' + c.get('user').id, 20, 3600))) throw new HttpError(429, 'At most 20 checks per hour');
  const r = await pollMailbox(c.env);
  if (r.jobs.length) await dispatch(c.env, wait(c), r.jobs);
  return c.json({ ok: r.status !== 'error', status: r.status, imported: r.imported, message: r.message, incoming: await mailInStatus(c.env, await cfgOf(c)) });
});

// ---------------- SMTP server (Configuration → Email Outgoing)
const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
mail.put('/smtp', async (c) => {
  need(c, 'configuration', 'E');
  const user = c.get('user');
  if (!(await allow(c.env, 'mail-smtp:' + user.id, 20, 3600))) throw new HttpError(429, 'At most 20 changes per hour');
  const b = (await c.req.json().catch(() => ({}))) || {};
  const host = String(b.host || '').trim().toLowerCase(), port = Number(b.port), security = String(b.security || '') as SmtpSecurity;
  const login = String(b.user || '').trim(), from = String(b.from || '').trim().toLowerCase(), pass = String(b.pass ?? '');
  if (!HOST_RE.test(host) || host.length > 253) throw new HttpError(400, 'Enter the SMTP server name, e.g. smtp.gmail.com');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new HttpError(400, 'Port must be a number from 1 to 65535 (465 for SSL, 587 for STARTTLS)');
  if (port === 25) throw new HttpError(400, 'Port 25 is blocked for outgoing mail – use 465 (SSL) or 587 (STARTTLS)');
  if (security !== 'ssl' && security !== 'starttls') throw new HttpError(400, 'Security must be SSL or STARTTLS');
  if (!login || login.length > 200 || /[\r\n]/.test(login)) throw new HttpError(400, 'Enter the username (usually the full e-mail address)');
  if (!EMAIL_RE.test(from)) throw new HttpError(400, 'Enter the From address, e.g. ranjith@laboffuture.com');
  if (pass.length > 200 || /[\r\n]/.test(pass)) throw new HttpError(400, 'The password is too long or has line breaks');
  const repo = new Repo(c.env.DB, user.name);
  const cfg = (await repo.setting<any>('cfg')) || {};
  const old = { ...SMTP_DEFAULTS, ...(cfg.mailOut?.smtp || {}) };
  if (pass) await repo.putSetting('smtp_pass', { enc: await encryptSecret(pass, c.env.JWT_SECRET) });
  const passSet = !!pass || (old.passSet && !b.clearPass);
  if (b.clearPass && !pass) await repo.putSetting('smtp_pass', {});
  const smtp = { host, port, security, user: login, from, passSet };
  cfg.mailOut = { ...MAIL_OUT_DEFAULTS, ...(cfg.mailOut || {}), smtp };
  await repo.putSetting('cfg', cfg);
  await addAudit(repo, 'SMTP server changed', 'Email Outgoing', `${host}:${port} (${security}) as ${login}${pass ? ' · new password' : ''}`);
  return c.json({ ok: true, smtp, mode: modeFor(c.env, cfg, 'email'), missing: smtpMissing(cfg) });
});
mail.post('/smtp/verify', async (c) => {
  need(c, 'configuration', 'E');
  if (!(await allow(c.env, 'mail-smtp-verify:' + c.get('user').id, 10, 3600))) throw new HttpError(429, 'At most 10 connection checks per hour');
  const cfg = await cfgOf(c);
  const missing = smtpMissing(cfg);
  if (missing.length) throw new HttpError(400, 'Fill in first: ' + missing.join(', '));
  const mode = modeFor(c.env, cfg, 'email');
  try {
    const r = await emailPing({ env: c.env, mode });
    return c.json({ ok: true, mode, ...r });
  } catch (e: any) {
    throw new HttpError(400, String(e?.message || e));
  }
});

mail.post('/test-send', async (c) => {
  need(c, 'configuration', 'E');
  const user = c.get('user');
  const to = String((await c.req.json().catch(() => ({})))?.to || '').trim().toLowerCase();
  if (!EMAIL_RE.test(to)) throw new HttpError(400, 'Enter a valid e-mail address');
  if (!(await allow(c.env, 'mail-test:' + user.id, 10, 3600))) throw new HttpError(429, 'At most 10 test e-mails per hour');
  const cfg = await cfgOf(c);
  const mode = modeFor(c.env, cfg, 'email');
  try {
    const r = await deliverEmail(c.env, cfg, { mode }, {
      to, ref: 'TEST-MAIL', subject: 'Lab of Future CRM – test e-mail',
      text: `This is a test e-mail from the Lab of Future CRM, sent by ${user.name}.\n\nIf you can read this, outgoing e-mail is working.`,
    });
    await addAudit(new Repo(c.env.DB, user.name), 'Test e-mail sent', to, `Mode ${mode}`);
    return c.json({ ok: true, mode, id: r.id });
  } catch (e: any) {
    throw new HttpError(400, String(e?.message || e));
  }
});

mail.get('/inbound', async (c) => {
  need(c, 'configuration', 'V');
  return c.json({ items: await recentInbound(c.env) });
});

mail.post('/inbound/simulate', async (c) => {
  need(c, 'configuration', 'E');
  const user = c.get('user');
  const b = (await c.req.json().catch(() => ({}))) || {};
  const from = String(b.from || '').trim();
  if (!EMAIL_RE.test(from)) throw new HttpError(400, 'Enter the sender’s e-mail address');
  if (!(await allow(c.env, 'mail-sim:' + user.id, 30, 3600))) throw new HttpError(429, 'At most 30 simulations per hour');
  const cfg = await cfgOf(c);
  const r = await processInboundEmail(c.env, new Repo(c.env.DB, 'E-mail simulation'), cfg, {
    messageId: 'sim-' + crypto.randomUUID(), from, fromName: String(b.fromName || '').slice(0, 80),
    subject: String(b.subject || '(no subject)').slice(0, 200), text: String(b.text || '').slice(0, 4096),
  }, true);
  if (r.queuedComms?.length) await dispatch(c.env, wait(c), r.queuedComms.map((id) => ({ kind: 'send_comm' as const, id })));
  return c.json({ ok: true, status: r.status, ref: r.ref || null, refType: r.refType || null });
});

// ---------------- individual and bulk e-mail (Leads, Opportunities, Admissions, Students)
const RESOURCE: Record<string, string> = { lead: 'leads', opp: 'opportunities', student: 'students' };
mail.post('/compose', async (c) => {
  const user = c.get('user'), perms = c.get('perms');
  const b = (await c.req.json().catch(() => ({}))) || {};
  const targets: MailTarget[] = Array.isArray(b.targets) ? b.targets.filter((t: any) => t && RESOURCE[t.type] && typeof t.id === 'string').map((t: any) => ({ type: t.type, id: t.id })) : [];
  if (!targets.length) throw new HttpError(400, 'Choose at least one recipient');
  if (targets.length > MAX_BULK) throw new HttpError(400, `At most ${MAX_BULK} recipients per e-mail – narrow the list`);
  for (const type of new Set(targets.map((t) => t.type))) {
    const r = RESOURCE[type];
    if (!(can(perms, user, r, 'E') || can(perms, user, r, 'C'))) throw new HttpError(403, `${user.role} cannot e-mail ${r}`);
  }
  const subject = String(b.subject || '').trim(), body = String(b.body || '');
  if (!subject || subject.length > 200) throw new HttpError(400, 'Enter a subject (up to 200 characters)');
  if (!body.trim() || body.length > 10000) throw new HttpError(400, 'Enter a message (up to 10,000 characters)');
  const bad = [...(subject + ' ' + body).matchAll(/{([^{}]*)}/g)].map((m) => m[1]).find((p) => !EMAIL_PLACEHOLDERS[p]);
  if (bad !== undefined) throw new HttpError(400, `Unknown placeholder {${bad}}`);
  if (!(await allow(c.env, 'mail-compose:' + user.id, 30, 3600))) throw new HttpError(429, 'At most 30 e-mail sends per hour – try again later');
  const rp = b.reply && typeof b.reply === 'object' && (b.reply.type === 'lead' || b.reply.type === 'student') && typeof b.reply.id === 'string'
    ? { type: b.reply.type as 'lead' | 'student', id: b.reply.id, comm: typeof b.reply.comm === 'string' ? b.reply.comm : undefined, index: Number.isInteger(b.reply.index) ? b.reply.index : undefined }
    : undefined;
  if (b.reply && !rp) throw new HttpError(400, 'The e-mail being answered is not valid');
  const r = await composeMail(c.env, user, targets, { name: String(b.template || '').slice(0, 80), subject, body, reply: rp });
  await dispatch(c.env, wait(c), r.jobs);
  await addAudit(new Repo(c.env.DB, user.name), r.queued > 1 ? 'Bulk e-mail sent' : 'E-mail sent', targets.length === 1 ? targets[0].id : targets.length + ' recipients', `${subject.slice(0, 80)} – ${r.queued} queued, ${r.skipped.length} skipped`);
  return c.json({ ok: true, queued: r.queued, skipped: r.skipped });
});

// ---------------- automated e-mails (Configuration → Email Automation)
mail.get('/automation/log', async (c) => {
  need(c, 'configuration', 'V');
  return c.json({ items: await recentAutoMail(c.env) });
});
mail.post('/automation/run', async (c) => {
  need(c, 'configuration', 'E');
  if (!(await allow(c.env, 'mail-auto-run:' + c.get('user').id, 10, 3600))) throw new HttpError(429, 'At most 10 manual runs per hour');
  const r = await runMailAutomations(c.env, Date.now(), { force: true });
  await dispatch(c.env, wait(c), r.jobs);
  return c.json({ ok: true, queued: r.jobs.length, counts: r.counts });
});

export default mail;
