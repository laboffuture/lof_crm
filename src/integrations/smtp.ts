// Outgoing e-mail over SMTP (Google Workspace smtp.gmail.com, Microsoft 365, Zoho, any SMTP server).
// Uses the Workers TCP socket API (cloudflare:sockets), which workerd provides both locally and on the VPS.
//   security 'ssl'      – TLS from the first byte (port 465)
//   security 'starttls' – plain connection upgraded with STARTTLS (port 587)
// The server settings live in cfg.mailOut.smtp; the password lives encrypted in the 'smtp_pass' setting and
// never reaches a browser.
import { connect } from 'cloudflare:sockets';
import type { Env } from '../types';
import { b64 } from '../lib/crypto';
import { decryptSecret } from '../lib/totp';

export type SmtpSecurity = 'ssl' | 'starttls';
export interface SmtpServer { host: string; port: number; security: SmtpSecurity; user: string; pass: string }
export interface SmtpMessage { from: string; fromName?: string; to: string; replyTo?: string; bcc?: string; subject: string; text: string; html?: string }
export interface SmtpSocket {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  startTls?: () => SmtpSocket;
  close: () => Promise<void> | void;
}
export type SmtpConnect = (host: string, port: number, security: SmtpSecurity) => SmtpSocket;

const workerdConnect: SmtpConnect = (host, port, security) =>
  connect({ hostname: host, port }, { secureTransport: security === 'ssl' ? 'on' : 'starttls', allowHalfOpen: false }) as unknown as SmtpSocket;

const enc = new TextEncoder();
const b64utf8 = (s: string) => b64(enc.encode(s));
const wrap76 = (s: string) => s.replace(/.{1,76}/g, (x) => x + '\r\n');
const ascii = (s: string) => /^[\x20-\x7e]*$/.test(s);

/** RFC 2047 encoded words for non-ASCII header text (each word stays under 75 characters). */
export function encodeHeader(s: string): string {
  s = s.replace(/[\r\n]+/g, ' ');
  if (ascii(s)) return s;
  const words: string[] = [];
  let cur = '';
  for (const ch of Array.from(s)) {
    if (enc.encode(cur + ch).length > 45) { words.push(cur); cur = ''; }
    cur += ch;
  }
  if (cur) words.push(cur);
  return words.map((w) => `=?UTF-8?B?${b64utf8(w)}?=`).join('\r\n ');
}
const mailbox = (name: string | undefined, addr: string) => {
  const n = String(name || '').replace(/[<>"\r\n]/g, '').trim();
  if (!n) return `<${addr}>`;
  return (ascii(n) ? `"${n}"` : encodeHeader(n)) + ` <${addr}>`;
};

/** The full MIME message (plain text + HTML alternative), CRLF line endings, ready for DATA. */
export function buildMime(m: SmtpMessage, messageId: string, date = new Date()): string {
  const boundary = 'lof_' + crypto.randomUUID().replace(/-/g, '');
  const head = [
    `From: ${mailbox(m.fromName, m.from)}`,
    `To: <${m.to}>`,
    ...(m.replyTo ? [`Reply-To: <${m.replyTo}>`] : []),
    `Subject: ${encodeHeader(m.subject)}`,
    `Date: ${date.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${messageId}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const part = (type: string, body: string) =>
    `--${boundary}\r\nContent-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(b64utf8(body))}`;
  return head.join('\r\n') + '\r\n\r\n' + part('text/plain', m.text.replace(/\r?\n/g, '\r\n')) + (m.html ? part('text/html', m.html) : '') + `--${boundary}--\r\n`;
}

class SmtpError extends Error {}

/** One SMTP conversation: reads multi-line replies and sends commands. */
class Session {
  private reader!: ReadableStreamDefaultReader<Uint8Array>;
  private writer!: WritableStreamDefaultWriter<Uint8Array>;
  private buf = '';
  private dec = new TextDecoder();
  constructor(public sock: SmtpSocket) { this.attach(sock); }
  attach(s: SmtpSocket) { this.sock = s; this.reader = s.readable.getReader(); this.writer = s.writable.getWriter(); this.buf = ''; }
  release() { this.reader.releaseLock(); this.writer.releaseLock(); }
  private async line(): Promise<string> {
    for (;;) {
      const i = this.buf.indexOf('\n');
      if (i >= 0) { const l = this.buf.slice(0, i).replace(/\r$/, ''); this.buf = this.buf.slice(i + 1); return l; }
      const { value, done } = await this.reader.read();
      if (done) throw new SmtpError('the mail server closed the connection');
      this.buf += this.dec.decode(value, { stream: true });
    }
  }
  async reply(): Promise<{ code: number; text: string }> {
    const lines: string[] = [];
    for (;;) {
      const l = await this.line();
      if (!/^\d{3}([ -]|$)/.test(l)) throw new SmtpError('unexpected reply from the mail server: ' + l.slice(0, 120));
      lines.push(l);
      if (l[3] !== '-') return { code: +l.slice(0, 3), text: lines.map((x) => x.slice(4)).join(' ').trim() };
    }
  }
  async write(s: string) { await this.writer.write(enc.encode(s)); }
  async cmd(s: string, ok: number[], step: string) {
    await this.write(s + '\r\n');
    const r = await this.reply();
    if (!ok.includes(r.code)) throw new SmtpError(`${step} – ${r.code} ${r.text}`.slice(0, 300));
    return r;
  }
}

const friendly = (msg: string) =>
  /^Sign-in – 53[45]/.test(msg) ? msg + ' (check the username and password – Google Workspace needs an app password)' : msg;

/**
 * Connects, signs in and sends one message (m = null only checks the connection and sign-in).
 * Returns the Message-ID and the server's final reply.
 */
export async function smtpSend(srv: SmtpServer, m: SmtpMessage | null, o: { connect?: SmtpConnect; timeoutMs?: number; helo?: string } = {}) {
  const conn = o.connect || workerdConnect;
  const helo = o.helo || 'crm.laboffuture.com';
  let s: Session | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    s = new Session(conn(srv.host, srv.port, srv.security));
    let r = await s.reply();
    if (r.code !== 220) throw new SmtpError(`Connect – ${r.code} ${r.text}`);
    let ehlo = await s.cmd(`EHLO ${helo}`, [250], 'Hello');
    if (srv.security === 'starttls') {
      if (!/STARTTLS/i.test(ehlo.text)) throw new SmtpError('The mail server does not offer STARTTLS on this port – try port 465 with SSL');
      await s.cmd('STARTTLS', [220], 'Start TLS');
      if (!s.sock.startTls) throw new SmtpError('STARTTLS is not available in this runtime');
      s.release();
      s.attach(s.sock.startTls());
      ehlo = await s.cmd(`EHLO ${helo}`, [250], 'Hello');
    }
    if (srv.user) {
      if (/AUTH[ =][^\n]*PLAIN/i.test(ehlo.text)) {
        await s.cmd('AUTH PLAIN ' + b64utf8(`\u0000${srv.user}\u0000${srv.pass}`), [235], 'Sign-in');
      } else {
        await s.cmd('AUTH LOGIN', [334], 'Sign-in');
        await s.cmd(b64utf8(srv.user), [334], 'Sign-in');
        await s.cmd(b64utf8(srv.pass), [235], 'Sign-in');
      }
    }
    if (!m) { await s.write('QUIT\r\n'); return { id: '', response: 'Signed in to ' + srv.host }; }
    const domain = m.from.split('@')[1] || 'localhost';
    const id = `${crypto.randomUUID()}@${domain}`;
    await s.cmd(`MAIL FROM:<${m.from}>`, [250], 'Sender');
    for (const rcpt of [m.to, ...(m.bcc ? [m.bcc] : [])]) await s.cmd(`RCPT TO:<${rcpt}>`, [250, 251], 'Recipient ' + rcpt);
    await s.cmd('DATA', [354], 'Message');
    const data = buildMime(m, id).replace(/\r\n\./g, '\r\n..');
    await s.write(data + '.\r\n');
    r = await s.reply();
    if (r.code !== 250) throw new SmtpError(`Message – ${r.code} ${r.text}`);
    await s.write('QUIT\r\n');
    return { id, response: `${r.code} ${r.text}`.slice(0, 300) };
  };
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new SmtpError(`No answer from ${srv.host}:${srv.port} within ${(o.timeoutMs ?? 30000) / 1000}s – check the host, port and security`)), o.timeoutMs ?? 30000); }),
    ]);
  } catch (e: any) {
    const msg = e instanceof SmtpError ? e.message : `Could not reach ${srv.host}:${srv.port} – ${e?.message || e}`;
    throw new Error(friendly(srv.pass ? msg.split(srv.pass).join('***') : msg));
  } finally {
    clearTimeout(timer);
    try { await (s as Session | null)?.sock.close(); } catch { /* already closed */ }
  }
}

// ---------------------------------------------------------------- settings
export const SMTP_DEFAULTS = { host: 'smtp.gmail.com', port: 465, security: 'ssl' as SmtpSecurity, user: '', from: '', passSet: false };
export type SmtpSettings = typeof SMTP_DEFAULTS;

/** The configured server and sending address, with the password decrypted; null when incomplete. */
export async function loadSmtp(env: Env): Promise<{ server: SmtpServer; from: string } | null> {
  const row = async (k: string) => {
    const r = await env.DB.prepare('SELECT data FROM settings WHERE key=?').bind(k).first<{ data: string }>();
    return r ? JSON.parse(r.data) : null;
  };
  const s = { ...SMTP_DEFAULTS, ...((await row('cfg'))?.mailOut?.smtp || {}) } as SmtpSettings;
  const p = await row('smtp_pass');
  if (!s.host || !s.user || !s.from || !p?.enc) return null;
  let pass: string;
  try { pass = await decryptSecret(p.enc, env.JWT_SECRET); } catch { throw new Error('The saved SMTP password cannot be read (the server secret changed) – enter it again in Configuration → Email Outgoing'); }
  return { server: { host: s.host, port: s.port, security: s.security, user: s.user, pass }, from: s.from };
}
