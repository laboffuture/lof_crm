// Decodes one received e-mail (RFC 5322 / MIME) into what the CRM files: sender, subject, date, thread headers and
// the readable text. Attachments are ignored; HTML-only e-mails are turned into plain text; the quoted earlier
// conversation under "On … wrote:" is cut off so the history shows only what the parent wrote.

export interface ParsedMail {
  messageId: string;   // "<id@host>" or ''
  inReplyTo: string;
  references: string;  // space-separated "<id>" list
  from: string;        // lower-case address
  fromName: string;
  subject: string;
  date: string | null; // ISO
  text: string;
  auto: boolean;       // auto-reply, out-of-office, bulk robot mail
}

/** Bytes → a string with one character per byte (keeps 8-bit content intact for later decoding). */
export function bytesToBinary(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return s;
}
const binaryToBytes = (s: string) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff; return b; };

function decoder(charset: string): TextDecoder {
  const cs = (charset || 'utf-8').trim().toLowerCase().replace(/^"|"$/g, '');
  try { return new TextDecoder(/^(us-)?ascii$/.test(cs) ? 'utf-8' : cs); } catch { return new TextDecoder('utf-8'); }
}

/** RFC 2047 encoded words (=?UTF-8?B?…?= / =?ISO-8859-1?Q?…?=) and raw 8-bit UTF-8 in a header value. */
export function decodeHeader(raw: string): string {
  let s = raw;
  if (/[^\x00-\x7f]/.test(s)) s = new TextDecoder('utf-8').decode(binaryToBytes(s));
  s = s.replace(/(=\?[^?\s]+\?[bBqQ]\?[^?\s]*\?=)\s+(?==\?[^?\s]+\?[bBqQ]\?)/g, '$1');
  return s.replace(/=\?([^?\s]+)\?([bBqQ])\?([^?\s]*)\?=/g, (_m, cs: string, e: string, t: string) => {
    try {
      const bytes = e.toUpperCase() === 'B'
        ? binaryToBytes(atob(t.replace(/[^A-Za-z0-9+/=]/g, '')))
        : binaryToBytes(t.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_x, h) => String.fromCharCode(parseInt(h, 16))));
      return decoder(cs.split('*')[0]).decode(bytes);
    } catch { return t; }
  });
}

function splitHead(s: string): [string, string] {
  const m = /\r?\n\r?\n/.exec(s);
  return m ? [s.slice(0, m.index), s.slice(m.index + m[0].length)] : [s, ''];
}

function parseHeaders(head: string): Map<string, string> {
  const h = new Map<string, string>();
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    if (!h.has(k)) h.set(k, line.slice(i + 1).trim());
  }
  return h;
}

/** "text/plain; charset=utf-8; name=\"a b\"" → { value: 'text/plain', params: { charset: 'utf-8', name: 'a b' } } */
function params(v: string): { value: string; params: Record<string, string> } {
  const parts = v.match(/(?:[^;"]|"(?:\\.|[^"])*")+/g) || [''];
  const out: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim().toLowerCase()] = p.slice(i + 1).trim().replace(/^"(.*)"$/, '$1').replace(/\\(.)/g, '$1');
  }
  return { value: parts[0].trim().toLowerCase(), params: out };
}

function decodeBody(body: string, cte: string, charset: string): string {
  const e = (cte || '').trim().toLowerCase();
  let bytes: Uint8Array;
  if (e === 'base64') { try { bytes = binaryToBytes(atob(body.replace(/[^A-Za-z0-9+/=]/g, ''))); } catch { bytes = new Uint8Array(0); } }
  else if (e === 'quoted-printable') bytes = binaryToBytes(body.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_x, h) => String.fromCharCode(parseInt(h, 16))));
  else bytes = binaryToBytes(body);
  return decoder(charset).decode(bytes);
}

const ENT: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, n: string) => {
      if (n[0] === '#') { const c = n[1] === 'x' || n[1] === 'X' ? parseInt(n.slice(2), 16) : parseInt(n.slice(1), 10); return Number.isFinite(c) && c > 0 && c < 0x110000 ? String.fromCodePoint(c) : m; }
      return ENT[n.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** The new part of a reply: everything above "On … wrote:" / "-----Original Message-----" / a quoted block. */
export function stripQuoted(text: string): string {
  const t = text.replace(/\r\n?/g, '\n');
  const cuts = [
    /^[ \t]*On [^\n]{3,300}?(?:\n[^\n]{0,200}?)?wrote:[ \t]*$/m,
    /^[ \t]*-{2,}[ \t]*Original Message[ \t]*-{2,}/mi,
    /^[ \t]*From:[^\n]*\n(?:[^\n]*\n)?[ \t]*(?:Sent|Date):/m,
    /^(?:>[^\n]*\n?){2,}\s*$/m,
  ];
  let end = t.length;
  for (const re of cuts) { const m = re.exec(t); if (m && m.index < end) end = m.index; }
  const kept = t.slice(0, end).trim();
  return kept || t.trim();
}

function walk(head: Map<string, string>, body: string, out: { plain?: string; html?: string }, depth = 0) {
  if (depth > 8) return;
  const ct = params(head.get('content-type') || 'text/plain');
  if (/^attachment/i.test(head.get('content-disposition') || '')) return;
  if (ct.value.startsWith('multipart/')) {
    const b = ct.params.boundary;
    if (!b) return;
    const sep = ('--' + b).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const chunks = body.split(new RegExp('(?:^|\\r?\\n)' + sep + '(?:--)?[ \\t]*(?=\\r?\\n|$)'));
    for (const c of chunks.slice(1)) {
      const part = c.replace(/^\r?\n/, '');
      if (!part.trim()) continue;
      const [h, bd] = splitHead(part);
      walk(parseHeaders(h), bd, out, depth + 1);
    }
    return;
  }
  const cte = head.get('content-transfer-encoding') || '';
  if (ct.value === 'text/plain' && out.plain === undefined) out.plain = decodeBody(body, cte, ct.params.charset || 'utf-8');
  else if (ct.value === 'text/html' && out.html === undefined) out.html = decodeBody(body, cte, ct.params.charset || 'utf-8');
}

const ids = (v: string) => (v.match(/<[^<>\s]+>/g) || []).join(' ');

/** Parses one raw e-mail (the bytes as fetched from the mailbox). */
export function parseMail(raw: Uint8Array | string): ParsedMail {
  const s = typeof raw === 'string' ? raw : bytesToBinary(raw);
  const [head, body] = splitHead(s);
  const h = parseHeaders(head);
  const fromRaw = decodeHeader(h.get('from') || '');
  const m = /^(.*?)<\s*([^<>\s]+)\s*>\s*$/.exec(fromRaw);
  const from = (m ? m[2] : fromRaw.replace(/\(.*\)/g, '')).trim().toLowerCase();
  const fromName = m ? m[1].trim().replace(/^"(.*)"$/, '$1').replace(/\\(.)/g, '$1').trim() : '';
  const d = h.get('date') ? new Date(h.get('date')!.replace(/\s*\([^)]*\)\s*$/, '')) : null;
  const out: { plain?: string; html?: string } = {};
  walk(h, body, out);
  const text = stripQuoted(out.plain !== undefined && out.plain.trim() ? out.plain : htmlToText(out.html || ''));
  const auto = (!!h.get('auto-submitted') && !/^no\b/i.test(h.get('auto-submitted')!)) || h.has('x-autoreply') || h.has('x-autorespond')
    || /^(auto_reply|junk)$/i.test(h.get('precedence') || '');
  return {
    messageId: ids(h.get('message-id') || '').split(' ')[0] || '',
    inReplyTo: ids(h.get('in-reply-to') || '').split(' ')[0] || '',
    references: ids(h.get('references') || ''),
    from, fromName: fromName.slice(0, 80),
    subject: decodeHeader(h.get('subject') || '').replace(/\s+/g, ' ').trim() || '(no subject)',
    date: d && !isNaN(+d) ? d.toISOString() : null,
    text, auto,
  };
}
