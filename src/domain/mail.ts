// E-mail settings (Configuration → Email Outgoing / Email Incoming), outgoing delivery rules and incoming processing.
//   cfg.mailOut – applied to every e-mail the CRM sends (sender name, reply-to, copy, signature, pause, daily limit)
//   cfg.mailIn  – how a received e-mail is filed (student / lead match, unknown senders, blocked senders)
import type { Env, Job } from '../types';
import { Repo, nowIso } from '../lib/db';
import { allow } from '../lib/ratelimit';
import { sendEmail } from '../integrations/gcal-email';
import { modeFor, writeLog, type Mode } from '../integrations/base';
import { loadSmtp } from '../integrations/smtp';
import { imapImport, imapHostFor, type ImapConnect } from '../integrations/imap';
import { parseMail } from '../integrations/mime';
import { addEv, createLead, notify } from './core';
import { logInbound } from './workflows';

export const MAIL_OUT_DEFAULTS = { on: true, fromName: 'Lab of Future', replyTo: '', bcc: '', signature: '', dailyLimit: 1800 };
export const MAIL_IN_DEFAULTS = { on: false, mailbox: '', unknown: 'review' as 'review' | 'lead' | 'ignore', branch: '', prog: '', block: [] as string[], notify: true };

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const DOMAIN_RE = /^@?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const isPlain = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x);

/** Validates cfg.mailOut / cfg.mailIn and returns them cleaned, or a problem message. */
export function checkMailSettings(out: unknown, inn: unknown, branches: { id: string; programs?: string[] }[]):
  { problem: string } | { mailOut?: typeof MAIL_OUT_DEFAULTS; mailIn?: typeof MAIL_IN_DEFAULTS } {
  const res: { mailOut?: typeof MAIL_OUT_DEFAULTS; mailIn?: typeof MAIL_IN_DEFAULTS } = {};
  if (out !== undefined) {
    if (!isPlain(out)) return { problem: 'Email Outgoing settings are invalid' };
    const fromName = String(out.fromName ?? '').trim(), replyTo = String(out.replyTo ?? '').trim().toLowerCase(), bcc = String(out.bcc ?? '').trim().toLowerCase();
    const signature = String(out.signature ?? ''), dailyLimit = Number(out.dailyLimit);
    if (!fromName || fromName.length > 60 || /[<>"\r\n]/.test(fromName)) return { problem: 'Sender name must be 1–60 characters without < > or quotes' };
    if (replyTo && !EMAIL_RE.test(replyTo)) return { problem: 'Reply-to must be a valid e-mail address' };
    if (bcc && !EMAIL_RE.test(bcc)) return { problem: 'Copy address must be a valid e-mail address' };
    if (signature.length > 1000) return { problem: 'Signature must be at most 1,000 characters' };
    if (!Number.isInteger(dailyLimit) || dailyLimit < 0 || dailyLimit > 10000) return { problem: 'Daily limit must be a whole number from 0 to 10,000 (0 = no limit)' };
    res.mailOut = { on: out.on !== false, fromName, replyTo, bcc, signature, dailyLimit };
  }
  if (inn !== undefined) {
    if (!isPlain(inn)) return { problem: 'Email Incoming settings are invalid' };
    const mailbox = String(inn.mailbox ?? '').trim().toLowerCase(), unknown = String(inn.unknown ?? 'review');
    if (mailbox && !EMAIL_RE.test(mailbox)) return { problem: 'Mailbox must be a valid e-mail address' };
    if (!['review', 'lead', 'ignore'].includes(unknown)) return { problem: 'Unknown-sender rule is invalid' };
    const branch = String(inn.branch ?? ''), prog = String(inn.prog ?? '');
    if (unknown === 'lead') {
      const b = branches.find((x) => x.id === branch);
      if (!b) return { problem: 'Choose the branch for leads created from e-mail' };
      if (!(b.programs || []).includes(prog)) return { problem: 'Choose a programme offered at that branch for leads created from e-mail' };
    }
    if (!Array.isArray(inn.block) || inn.block.length > 200) return { problem: 'Blocked senders: at most 200 entries' };
    const block = [...new Set(inn.block.map((x: unknown) => String(x).trim().toLowerCase()).filter(Boolean))] as string[];
    const bad = block.find((x) => !EMAIL_RE.test(x) && !DOMAIN_RE.test(x));
    if (bad) return { problem: `Blocked sender "${bad}" is not an e-mail address or domain` };
    res.mailIn = { on: inn.on === true, mailbox, unknown: unknown as any, branch, prog, block, notify: inn.notify !== false };
  }
  return res;
}

const outSettings = (cfg: any) => ({ ...MAIL_OUT_DEFAULTS, ...(cfg?.mailOut || {}) });

/** Sends one e-mail with the Email Outgoing rules applied. Every CRM e-mail goes through here. */
export async function deliverEmail(env: Env, cfg: any, g: { mode: Mode; isTest?: boolean }, m: { to: string; subject: string; text: string; ref?: string; inReplyTo?: string; references?: string }) {
  const o = outSettings(cfg);
  if (!o.on) throw new Error('E-mail sending is paused (Configuration → Email Outgoing)');
  if (g.mode === 'live' && !g.isTest && o.dailyLimit > 0 && !(await allow(env, 'email-out-day', o.dailyLimit, 86400))) {
    throw new Error(`Daily e-mail limit of ${o.dailyLimit} reached – sending resumes tomorrow`);
  }
  const text = o.signature.trim() ? `${m.text}\n\n${o.signature.trim()}` : m.text;
  return sendEmail({ env, mode: g.mode, isTest: g.isTest }, { ...m, text, fromName: o.fromName, replyTo: o.replyTo || undefined, bcc: o.bcc || undefined });
}

// ---------------------------------------------------------------- incoming
export interface InboundEmail {
  messageId: string; from: string; fromName?: string; subject: string; text: string; at?: string;
  /** From a real mailbox: the e-mail's own Message-ID and thread (used to reply in the same conversation) */
  msgId?: string; refs?: string; auto?: boolean;
}
export interface InboundResult { status: string; ref?: string; refType?: 'student' | 'lead'; queuedComms?: string[] }
const PROVIDER = 'email-in';
const AUTO_REPLY = /^(auto(matic)?[ -]?reply|out of (the )?office|automatische antwort|undeliverable|delivery status notification)/i;

const record = (env: Env, m: InboundEmail, r: InboundResult, sim: boolean) =>
  env.DB.prepare('INSERT OR IGNORE INTO webhook_events (provider,event_id,result) VALUES (?,?,?)')
    .bind(PROVIDER, m.messageId, JSON.stringify({ at: m.at || nowIso(), from: m.from, fromName: m.fromName || '', subject: m.subject.slice(0, 200), snippet: m.text.slice(0, 200), ...r, sim: sim || undefined })).run();

/** Files one received e-mail: student parent → lead → unknown-sender rule. `sim` marks Testing simulations. */
export async function processInboundEmail(env: Env, repo: Repo, cfg: any, m: InboundEmail, sim = false): Promise<InboundResult> {
  const rules = { ...MAIL_IN_DEFAULTS, ...(cfg?.mailIn || {}) };
  const from = m.from.trim().toLowerCase();
  const done = async (r: InboundResult) => { await record(env, m, r, sim); await logInbound(env, 'email', 'message.received', true, { from, subject: m.subject }, r, r.ref, sim); return r; };
  if (await env.DB.prepare('SELECT 1 FROM webhook_events WHERE provider=? AND event_id=?').bind(PROVIDER, m.messageId).first()) return { status: 'Duplicate' };
  if (!EMAIL_RE.test(from)) return done({ status: 'Ignored – no valid sender' });
  const domain = from.split('@')[1];
  if (rules.block.some((b: string) => b === from || b.replace(/^@/, '') === domain)) return done({ status: 'Blocked sender' });
  if (m.auto || AUTO_REPLY.test(m.subject) || /^(mailer-daemon|postmaster|no-?reply)@/.test(from)) return done({ status: 'Auto-reply skipped' });

  const at = m.at || nowIso(), text = m.text.slice(0, 4096), subject = m.subject.slice(0, 200);
  const note = `${sim ? '[Simulation] ' : ''}${subject}`;
  // thread headers for replying from the CRM (only well-formed <id> tokens are kept)
  const ids = (v?: string) => (String(v || '').match(/<[^<>\s"]{3,250}>/g) || []).slice(-20).join(' ');
  const thread = ids(m.msgId) ? { msgId: ids(m.msgId).split(' ')[0], refs: ids(m.refs) || undefined } : {};

  // 1. Parent e-mail on a student record (siblings share the address – file on each)
  const students = ((await env.DB.prepare(
    `SELECT data FROM docs WHERE type='student' AND EXISTS (SELECT 1 FROM json_each(json_extract(data,'$.parents')) p WHERE lower(json_extract(p.value,'$.email'))=?)`,
  ).bind(from).all<{ data: string }>()).results || []).map((r) => JSON.parse(r.data));
  if (students.length) {
    for (const s of students) {
      s.comm = [...(s.comm || []), { at, ch: 'Email', tpl: 'Incoming', subject, text, from, status: 'Received', inbound: true, sim: sim || undefined, ...thread }];
      await repo.put('student', s);
      if (rules.notify) await notify(repo, { type: 'new', sev: 'info', text: `E-mail from ${m.fromName || from} about ${s.first} ${s.last}: "${note.slice(0, 80)}"`, route: { page: 'student', id: s.id }, roles: ['Centre Administrator', 'Admissions Head'], branch: s.branch });
    }
    return done({ status: 'Matched to student', ref: students.map((s) => s.id).join(', '), refType: 'student' });
  }

  // 2. Lead with this e-mail (newest open lead first)
  const leads = await repo.many<any>('lead', 'ref2=?', [from], 'created_at DESC');
  const l = leads.find((x) => x.status === 'Open') || leads[0];
  const fileOnLead = async (lead: any, status: string) => {
    const id = await repo.newId('cm');
    await repo.put('comm', { id, lead: lead.id, ch: 'Email', tpl: 'Inbound', subject, text, from, at, status: 'Received', by: lead.parent, inbound: true, sim: sim || undefined, test: lead.test || undefined, ...thread });
    addEv(lead, 'msg', `E-mail received: "${note.slice(0, 120)}"`, lead.parent);
    await repo.put('lead', lead);
    if (rules.notify) await notify(repo, { type: 'new', sev: 'info', text: `E-mail from ${lead.parent} (${lead.student}): "${note.slice(0, 80)}"`, route: { page: 'lead', id: lead.id }, roles: ['Counsellor', 'Centre Administrator'], branch: lead.branch, cslr: lead.cslr });
    return done({ status, ref: lead.id, refType: 'lead' });
  };
  if (l) return fileOnLead(l, 'Matched to lead');

  // 3. Unknown sender
  if (rules.unknown === 'lead') {
    // a simulated unknown sender creates a test lead (TST-…), removed by Testing console → Delete test data
    const created = await createLead(sim ? new Repo(repo.db, repo.actor, true) : repo, {
      student: 'Unknown (e-mail enquiry)', parent: m.fromName?.trim() || from, phone: '', email: from, branch: rules.branch, prog: rules.prog,
      src: 'E-mail', em: true, notes: `${subject}\n\n${text}`.slice(0, 1000),
    }, 'E-mail');
    // the caller dispatches the lead's automatic acknowledgement messages
    return { ...(await fileOnLead(created.lead, 'New lead created')), queuedComms: created.queuedComms };
  }
  if (rules.unknown === 'review') {
    await notify(repo, { type: 'new', sev: 'info', text: `E-mail from unknown sender ${m.fromName ? m.fromName + ' ' : ''}<${from}>: "${note.slice(0, 80)}" – review under Configuration → Email Incoming`, route: { page: 'config', tab: 'mailIn' }, roles: ['Admissions Head', 'System Administrator'] });
    return done({ status: 'Needs review' });
  }
  return done({ status: 'Ignored – unknown sender' });
}

/** Most recent received e-mails with how they were filed (Configuration → Email Incoming). */
export async function recentInbound(env: Env, limit = 50) {
  const rows = (await env.DB.prepare('SELECT event_id, received_at, result FROM webhook_events WHERE provider=? ORDER BY received_at DESC LIMIT ?').bind(PROVIDER, limit).all<any>()).results || [];
  return rows.map((r) => ({ id: r.event_id, receivedAt: r.received_at, ...JSON.parse(r.result || '{}') }));
}

// ---------------------------------------------------------------- reading the mailbox (IMAP)
// The mailbox is the one signed in under Email Outgoing (same username and app password). Where the last check
// stopped is kept in the server-only setting 'mail_in_state'; browsers never receive it.
const STATE_KEY = 'mail_in_state';
interface MailInState { host?: string; mailbox?: string; uidValidity?: number; lastUid?: number; lastCheck?: string; lastError?: string; imported?: number; since?: string }
export interface PollResult { status: 'off' | 'mock' | 'busy' | 'started' | 'ok' | 'error'; imported: number; message: string; jobs: Job[] }

/** What Configuration → Email Incoming shows about the mailbox connection. */
export async function mailInStatus(env: Env, cfg: any) {
  const st = await new Repo(env.DB).setting<MailInState>(STATE_KEY);
  const smtp = cfg?.mailOut?.smtp || {}, mailbox = String(smtp.user || '').toLowerCase();
  const host = smtp.host ? imapHostFor(smtp.host) : '';
  const mode = modeFor(env, cfg, 'email');
  const current = !!st.uidValidity && st.mailbox === mailbox && st.host === host;
  return {
    on: { ...MAIL_IN_DEFAULTS, ...(cfg?.mailIn || {}) }.on, mode, host, mailbox,
    connected: mode === 'live' && current && !st.lastError,
    lastCheck: st.lastCheck || null, lastError: st.lastError || '', imported: current ? st.imported || 0 : 0, since: current ? st.since || null : null,
  };
}

/**
 * Reads new e-mails from the mailbox and files them (every 5 minutes from the background job, or "Check now").
 * The first successful check only notes where the mailbox stands: e-mails from then on are imported.
 */
export async function pollMailbox(env: Env, opts: { connect?: ImapConnect } = {}): Promise<PollResult> {
  const repo = new Repo(env.DB, 'E-mail import');
  const cfg = await repo.setting<any>('cfg');
  const none = (status: PollResult['status'], message: string): PollResult => ({ status, imported: 0, message, jobs: [] });
  if (!{ ...MAIL_IN_DEFAULTS, ...(cfg?.mailIn || {}) }.on) return none('off', 'Import incoming e-mail is switched off');
  const smtp = modeFor(env, cfg, 'email') === 'live' ? await loadSmtp(env) : null;
  if (!smtp) return none('mock', 'The mailbox is not read: the SMTP server under Email Outgoing is incomplete, or this server runs in mock mode');
  if (!(await allow(env, 'mail-in-poll', 1, 50))) return none('busy', 'A check is already running – try again in a minute');

  const host = imapHostFor(smtp.server.host), mailbox = smtp.server.user.toLowerCase();
  const prev = await repo.setting<MailInState>(STATE_KEY);
  const same = prev.host === host && prev.mailbox === mailbox && !!prev.uidValidity;
  const pos = same ? { uidValidity: prev.uidValidity!, lastUid: prev.lastUid || 0 } : null;
  const own = new Set([mailbox, String(smtp.from || '').toLowerCase()]);
  const jobs: Job[] = [];
  let imported = 0;
  const t0 = Date.now(), url = `imap://${host}:993`;
  const base = { host, mailbox, imported: same ? prev.imported || 0 : 0, since: same ? prev.since : undefined };
  try {
    const r = await imapImport({ host, port: 993, user: smtp.server.user, pass: smtp.server.pass }, pos, async (uid, raw) => {
      const p = parseMail(raw);
      if (own.has(p.from)) return; // a copy of our own e-mail
      const res = await processInboundEmail(env, repo, cfg, {
        messageId: p.messageId || `imap-${host}-${uid}`, from: p.from, fromName: p.fromName, subject: p.subject, text: p.text,
        at: p.date || undefined, msgId: p.messageId, refs: p.references, auto: p.auto,
      });
      if (res.status !== 'Duplicate') imported++;
      for (const id of res.queuedComms || []) jobs.push({ kind: 'send_comm', id });
    }, { connect: opts.connect });
    await repo.putSetting(STATE_KEY, { ...base, uidValidity: r.uidValidity, lastUid: r.lastUid, lastCheck: nowIso(), lastError: '', imported: base.imported + imported, since: r.first ? nowIso() : base.since || nowIso() });
    await writeLog(env, { integration: 'email', direction: 'in', operation: 'imap.fetch', mode: 'live', method: 'IMAP', url, status: 200, ok: true, ms: Date.now() - t0, response: r.first ? 'connected' : `${r.handled} new${r.more ? ', more waiting' : ''}` });
    const message = r.first ? `Connected to ${mailbox} – e-mails arriving from now on are imported`
      : imported ? `${imported} new e-mail${imported === 1 ? '' : 's'} imported` : 'No new e-mails';
    return { status: r.first ? 'started' : 'ok', imported, message, jobs };
  } catch (e: any) {
    const message = String(e?.message || e).slice(0, 300);
    await repo.putSetting(STATE_KEY, { ...base, uidValidity: prev.uidValidity, lastUid: prev.lastUid, lastCheck: nowIso(), lastError: message, imported: base.imported + imported });
    await writeLog(env, { integration: 'email', direction: 'in', operation: 'imap.fetch', mode: 'live', method: 'IMAP', url, status: 0, ok: false, ms: Date.now() - t0, error: message });
    // tell the administrators once, when a working connection starts failing
    if (!prev.lastError) await notify(repo, { type: 'new', sev: 'warn', text: `Incoming e-mail could not be read from ${mailbox}: ${message.slice(0, 140)}`, route: { page: 'config', tab: 'mailIn' }, roles: ['System Administrator'] });
    return { status: 'error', imported, message, jobs };
  }
}
