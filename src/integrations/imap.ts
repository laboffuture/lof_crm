// Reads new e-mails from the mailbox over IMAP (Google Workspace imap.gmail.com, Microsoft 365
// outlook.office365.com, …) with the same username and app password as the SMTP server under Configuration →
// Email Outgoing. Used by the background job every 5 minutes (domain/mail.ts → pollMailbox). TLS on port 993 only.
//
// Only e-mails that arrive after the mailbox is connected are imported: the first check just notes where the
// mailbox stands (UIDNEXT). Each imported e-mail is marked as read and left in the inbox.
import { connect } from 'cloudflare:sockets';
import type { SmtpSocket } from './smtp';
import { bytesToBinary } from './mime';

export interface ImapServer { host: string; port: number; user: string; pass: string }
export type ImapConnect = (host: string, port: number) => SmtpSocket;
/** Where the last check stopped: the mailbox's UIDVALIDITY and the highest UID already imported. */
export interface ImapPosition { uidValidity: number; lastUid: number }
export interface ImapRun extends ImapPosition { first: boolean; handled: number; more: boolean }

const workerdConnect: ImapConnect = (host, port) =>
  connect({ hostname: host, port }, { secureTransport: 'on', allowHalfOpen: false }) as unknown as SmtpSocket;

/** The IMAP server that belongs to an SMTP server name. */
export function imapHostFor(smtpHost: string): string {
  const h = smtpHost.trim().toLowerCase();
  if (h === 'smtp.gmail.com' || h === 'smtp-relay.gmail.com') return 'imap.gmail.com';
  if (h === 'smtp.office365.com' || h === 'smtp-mail.outlook.com') return 'outlook.office365.com';
  if (h === 'smtp.zoho.com' || h === 'smtppro.zoho.com') return h.replace(/^smtp(pro)?\./, 'imap$1.');
  return h.replace(/^smtp\./, 'imap.');
}

class ImapError extends Error {}
const enc = new TextEncoder();
const quote = (s: string) => '"' + s.replace(/[\\"]/g, (m) => '\\' + m) + '"';

/** One IMAP conversation: tagged commands, responses with {n} literals read in. */
class Session {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private buf = new Uint8Array(0);
  private tag = 0;
  constructor(private sock: SmtpSocket) {
    this.reader = sock.readable.getReader();
    this.writer = sock.writable.getWriter();
  }
  private async fill() {
    const r = await this.reader.read();
    if (r.done || !r.value) throw new ImapError('The mail server closed the connection');
    const b = new Uint8Array(this.buf.length + r.value.length);
    b.set(this.buf); b.set(r.value, this.buf.length);
    this.buf = b;
  }
  private async line(): Promise<string> {
    for (;;) {
      for (let i = 0; i + 1 < this.buf.length; i++) {
        if (this.buf[i] === 13 && this.buf[i + 1] === 10) {
          const l = bytesToBinary(this.buf.subarray(0, i));
          this.buf = this.buf.subarray(i + 2);
          return l;
        }
      }
      if (this.buf.length > 1 << 20) throw new ImapError('The mail server sent an over-long line');
      await this.fill();
    }
  }
  private async bytes(n: number): Promise<Uint8Array> {
    while (this.buf.length < n) await this.fill();
    const b = this.buf.slice(0, n);
    this.buf = this.buf.subarray(n);
    return b;
  }
  /** One response line; a literal {n} is read in and stands as \0 in the text. */
  async response(): Promise<{ text: string; lits: Uint8Array[] }> {
    let text = '';
    const lits: Uint8Array[] = [];
    for (;;) {
      const l = await this.line();
      const m = /\{(\d+)\}$/.exec(l);
      if (!m) return { text: text + l, lits };
      if (+m[1] > 4 << 20) throw new ImapError('E-mail too large');
      text += l.slice(0, m.index) + '\0';
      lits.push(await this.bytes(+m[1]));
    }
  }
  /** Sends a command and returns its untagged responses; `label` replaces the command in errors (no password). */
  async cmd(c: string, label = c.split(' ')[0]): Promise<{ text: string; lits: Uint8Array[] }[]> {
    const t = 'A' + ++this.tag;
    await this.writer.write(enc.encode(`${t} ${c}\r\n`));
    const out: { text: string; lits: Uint8Array[] }[] = [];
    for (;;) {
      const r = await this.response();
      if (r.text.startsWith(t + ' ')) {
        const st = r.text.slice(t.length + 1);
        if (!/^OK\b/i.test(st)) throw new ImapError(`${label} – ${st.replace(/^(NO|BAD)\s*/i, '').slice(0, 200)}`);
        return out;
      }
      out.push(r);
    }
  }
  async close() {
    try { await this.writer.close(); } catch { /* already closed */ }
    try { await this.sock.close(); } catch { /* already closed */ }
  }
}

/**
 * Connects, signs in and imports e-mails newer than `pos` (oldest first, at most `max` per run). `handle` files
 * each one; it is then marked as read. If `handle` throws, the run stops there and that e-mail is tried again
 * next time. With no position (or a mailbox that was reset) nothing is imported: the run returns where the
 * mailbox stands now. `handle` = null only signs in and checks the inbox (Check connection).
 */
export async function imapImport(
  srv: ImapServer, pos: ImapPosition | null, handle: ((uid: number, raw: Uint8Array) => Promise<void>) | null,
  opts: { connect?: ImapConnect; timeoutMs?: number; max?: number } = {},
): Promise<ImapRun> {
  const s = new Session((opts.connect || workerdConnect)(srv.host, srv.port));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new ImapError(`No answer from ${srv.host} within ${Math.round((opts.timeoutMs ?? 45000) / 1000)} s`)), opts.timeoutMs ?? 45000); });
  const run = async (): Promise<ImapRun> => {
    const hello = await s.response();
    if (!/^\* (OK|PREAUTH)/i.test(hello.text)) throw new ImapError('Unexpected greeting – ' + hello.text.slice(0, 120));
    try {
      await s.cmd(`LOGIN ${quote(srv.user)} ${quote(srv.pass)}`, 'Sign-in');
    } catch (e: any) {
      const hint = /AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed|authentication failed/i.test(e.message)
        ? ' (Google Workspace needs an app password, and IMAP must be allowed for the mailbox)' : '';
      throw new ImapError(e.message + hint);
    }
    const sel = await s.cmd('SELECT INBOX');
    const num = (re: RegExp) => { for (const r of sel) { const m = re.exec(r.text); if (m) return +m[1]; } return 0; };
    const uidValidity = num(/\[UIDVALIDITY (\d+)\]/i), uidNext = num(/\[UIDNEXT (\d+)\]/i);
    if (!uidValidity) throw new ImapError('The mail server did not report UIDVALIDITY');
    let top = uidNext - 1;
    if (!uidNext) { // servers that omit UIDNEXT: ask for the newest UID
      const r = (await s.cmd('UID SEARCH ALL')).find((x) => /^\* SEARCH/i.test(x.text));
      top = Math.max(0, ...((r?.text.match(/\d+/g) || []).map(Number)));
    }
    if (!handle || !pos || pos.uidValidity !== uidValidity) {
      return { uidValidity, lastUid: pos && pos.uidValidity === uidValidity ? pos.lastUid : top, first: !pos || pos.uidValidity !== uidValidity, handled: 0, more: false };
    }
    let lastUid = pos.lastUid, handled = 0;
    if (top <= lastUid) return { uidValidity, lastUid, first: false, handled, more: false };
    const found = (await s.cmd(`UID SEARCH UID ${lastUid + 1}:*`)).find((x) => /^\* SEARCH/i.test(x.text));
    const uids = [...new Set((found?.text.replace(/^\* SEARCH/i, '').match(/\d+/g) || []).map(Number))].filter((u) => u > lastUid).sort((a, b) => a - b);
    const max = opts.max ?? 25;
    for (const uid of uids.slice(0, max)) {
      const f = (await s.cmd(`UID FETCH ${uid} (UID BODY.PEEK[]<0.262144>)`)).find((x) => x.lits.length && /FETCH/i.test(x.text));
      if (f) {
        await handle(uid, f.lits[0]);
        await s.cmd(`UID STORE ${uid} +FLAGS.SILENT (\\Seen)`);
        handled++;
      }
      lastUid = uid;
    }
    try { await s.cmd('LOGOUT'); } catch { /* the server may just close */ }
    return { uidValidity, lastUid, first: false, handled, more: uids.length > max };
  };
  try {
    return await Promise.race([run(), timeout]);
  } catch (e: any) {
    const msg = String(e?.message || e);
    throw new Error(srv.pass ? msg.split(srv.pass).join('•••') : msg);
  } finally {
    clearTimeout(timer);
    await s.close();
  }
}
