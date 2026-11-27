// Incoming e-mail (Configuration → Email Incoming): decoding received e-mails, the IMAP conversation against a fake
// mailbox, filing new e-mails every check, and replying from the CRM in the same conversation.
import { describe, it, expect, beforeEach } from 'vitest';
import { parseMail, stripQuoted } from '../../src/integrations/mime';
import { imapImport, imapHostFor } from '../../src/integrations/imap';
import { buildMime, type SmtpSocket } from '../../src/integrations/smtp';
import { pollMailbox } from '../../src/domain/mail';
import { setup, USERS, type TestCtx } from '../helpers/app';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const mailFrom = (from: string, o: { id?: string; subject?: string; body?: string; refs?: string; extra?: string } = {}) => [
  `From: "Mona Q" <${from}>`, 'To: ranjith@laboffuture.com',
  `Subject: =?UTF-8?B?${b64(o.subject || 'Frage zur Gebühr – Robotics')}?=`,
  'Date: Thu, 12 Nov 2026 09:15:00 +0400',
  `Message-ID: ${o.id || '<m1@mail.example>'}`,
  ...(o.refs ? [`In-Reply-To: ${o.refs.split(' ').pop()}`, `References: ${o.refs}`] : []),
  ...(o.extra ? [o.extra] : []),
  'MIME-Version: 1.0', 'Content-Type: multipart/alternative; boundary="b1"', '',
  '--b1', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: quoted-printable', '',
  (o.body || 'Hello, when does the next class start? Danke =E2=80=93 Mona') + '=',
  '', 'On Wed, 11 Nov 2026 at 10:00, Lab of Future <ranjith@laboffuture.com> wrote:', '> Dear parent,', '> welcome.', '',
  '--b1', 'Content-Type: text/html; charset=UTF-8', '', '<p>Hello, when does the next class start?</p>', '--b1--', '',
].join('\r\n');

/** A scripted IMAP server (one INBOX) over in-memory streams. */
function fakeImap(o: { pass?: string; uidValidity?: number } = {}) {
  const box = new Map<number, string>([[1, mailFrom('old@example.com', { id: '<old1@x>' })], [2, mailFrom('old@example.com', { id: '<old2@x>' })]]);
  const seen = new Set<number>(), log: string[] = [];
  let next = 3;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const connect = (host: string, port: number): SmtpSocket => {
    log.push(`CONNECT ${host}:${port}`);
    let ctrl!: ReadableStreamDefaultController<Uint8Array>, buf = '';
    const say = (s: string) => ctrl.enqueue(enc.encode(s + '\r\n'));
    const readable = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; say('* OK [CAPABILITY IMAP4rev1] ready'); } });
    const handle = (line: string) => {
      const [tag, ...rest] = line.split(' '), cmd = rest.join(' ');
      log.push(cmd.startsWith('LOGIN') ? 'LOGIN …' : cmd);
      if (cmd.startsWith('LOGIN')) return say(cmd.includes(`"${o.pass ?? 'abcd efgh ijkl mnop'}"`) ? `${tag} OK LOGIN completed` : `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)`);
      if (cmd === 'SELECT INBOX') { say(`* ${box.size} EXISTS`); say(`* OK [UIDVALIDITY ${o.uidValidity ?? 7}] UIDs valid`); say(`* OK [UIDNEXT ${next}] next`); return say(`${tag} OK [READ-WRITE] SELECT completed`); }
      let m = /^UID SEARCH UID (\d+):\*$/.exec(cmd);
      if (m) { const from = +m[1]; const u = [...box.keys()].filter((k) => k >= from); say('* SEARCH ' + (u.length ? u : [Math.max(...box.keys())]).join(' ')); return say(`${tag} OK SEARCH completed`); }
      m = /^UID FETCH (\d+) /.exec(cmd);
      if (m) { const raw = box.get(+m[1])!; const n = enc.encode(raw).length; ctrl.enqueue(enc.encode(`* 1 FETCH (UID ${m[1]} BODY[]<0> {${n}}\r\n`)); ctrl.enqueue(enc.encode(raw)); say(')'); return say(`${tag} OK FETCH completed`); }
      m = /^UID STORE (\d+) \+FLAGS\.SILENT \(\\Seen\)$/.exec(cmd);
      if (m) { seen.add(+m[1]); return say(`${tag} OK STORE completed`); }
      if (cmd === 'LOGOUT') { say('* BYE'); return say(`${tag} OK LOGOUT completed`); }
      say(`${tag} BAD unknown`);
    };
    const writable = new WritableStream<Uint8Array>({ write(chunk) { buf += dec.decode(chunk); let i; while ((i = buf.indexOf('\r\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 2); handle(l); } } });
    return { readable, writable, close() {} };
  };
  return { connect, log, seen, add: (raw: string) => { box.set(next, raw); return next++; } };
}
const SRV = { host: 'imap.gmail.com', port: 993, user: 'ranjith@laboffuture.com', pass: 'abcd efgh ijkl mnop' };

describe('decoding a received e-mail', () => {
  it('reads sender, encoded subject, thread headers and only the new part of the text', () => {
    const p = parseMail(mailFrom('Mona@Example.com', { refs: '<a@x> <b@x>' }));
    expect(p).toMatchObject({ from: 'mona@example.com', fromName: 'Mona Q', subject: 'Frage zur Gebühr – Robotics', messageId: '<m1@mail.example>', inReplyTo: '<b@x>', references: '<a@x> <b@x>', auto: false });
    expect(p.text).toBe('Hello, when does the next class start? Danke – Mona');
    expect(p.date).toBe('2026-11-12T05:15:00.000Z');
  });
  it('turns HTML-only e-mails into text and spots auto-replies', () => {
    const p = parseMail('From: a@b.co\r\nSubject: Hi\r\nAuto-Submitted: auto-replied\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Line one<br>Line &amp; two</p><style>p{}</style>');
    expect(p.text).toBe('Line one\nLine & two');
    expect(p.auto).toBe(true);
  });
  it('keeps a message that is all quote rather than returning nothing', () => {
    expect(stripQuoted('> only quoted\n> text')).toBe('> only quoted\n> text');
  });
  it('knows the IMAP server for common SMTP servers', () => {
    expect(imapHostFor('smtp.gmail.com')).toBe('imap.gmail.com');
    expect(imapHostFor('smtp.office365.com')).toBe('outlook.office365.com');
    expect(imapHostFor('smtp.example.org')).toBe('imap.example.org');
  });
});

describe('IMAP conversation', () => {
  it('first check only notes where the mailbox stands, later checks import and mark new e-mails as read', async () => {
    const f = fakeImap();
    const got: number[] = [];
    const first = await imapImport(SRV, null, async (uid) => { got.push(uid); }, { connect: f.connect });
    expect(first).toMatchObject({ first: true, uidValidity: 7, lastUid: 2, handled: 0 });
    expect(f.log).toContain('LOGIN …');
    f.add(mailFrom('a@b.co', { id: '<n3@x>' })); f.add(mailFrom('a@b.co', { id: '<n4@x>' }));
    const r = await imapImport(SRV, first, async (uid, raw) => { got.push(uid); expect(parseMail(raw).messageId).toMatch(/^<n[34]@x>$/); }, { connect: f.connect });
    expect(r).toMatchObject({ first: false, lastUid: 4, handled: 2 });
    expect(got).toEqual([3, 4]);
    expect([...f.seen]).toEqual([3, 4]);
    const again = await imapImport(SRV, r, async () => { throw new Error('nothing should be fetched'); }, { connect: f.connect });
    expect(again).toMatchObject({ lastUid: 4, handled: 0 });
  });
  it('starts again from now when the mailbox was reset (new UIDVALIDITY)', async () => {
    const r = await imapImport(SRV, { uidValidity: 1, lastUid: 99 }, async () => { throw new Error('no import'); }, { connect: fakeImap({ uidValidity: 9 }).connect });
    expect(r).toMatchObject({ first: true, uidValidity: 9, lastUid: 2 });
  });
  it('explains a refused sign-in without revealing the password', async () => {
    const err = await imapImport(SRV, null, null, { connect: fakeImap({ pass: 'other' }).connect }).catch((e) => e);
    expect(err.message).toMatch(/Sign-in – .*Invalid credentials.*app password/);
    expect(err.message).not.toContain(SRV.pass);
  });
});

describe('reply headers', () => {
  it('a reply carries In-Reply-To and References, and nothing else gets into the headers', () => {
    const mime = buildMime({ from: 'a@laboffuture.com', to: 'p@example.com', subject: 'Re: Hi', text: 'x', inReplyTo: '<m1@mail.example>', references: '<a@x> <m1@mail.example>\r\nBcc: evil@x.com' }, 'id@laboffuture.com');
    expect(mime).toContain('In-Reply-To: <m1@mail.example>\r\n');
    expect(mime).toContain('References: <a@x> <m1@mail.example>\r\n');
    expect(mime).not.toMatch(/^Bcc:/m);
  });
});

describe('reading the mailbox (every 5 minutes / Check now)', () => {
  let t: TestCtx, lead: any, f: ReturnType<typeof fakeImap>;
  const poll = async () => { await t.sql('DELETE FROM rate_limits'); return pollMailbox(t.env, { connect: f.connect }); };
  beforeEach(async () => {
    t = await setup({ INTEGRATION_MODE: 'auto' } as any);
    f = fakeImap();
    const tok = await t.login(USERS.admin);
    expect((await t.call('PUT', '/api/v1/mail/smtp', { token: tok, body: { host: 'smtp.gmail.com', port: 465, security: 'ssl', user: 'ranjith@laboffuture.com', from: 'ranjith@laboffuture.com', pass: SRV.pass } })).status).toBe(200);
    await t.sql(`UPDATE settings SET data=json_set(data,'$.mailIn',json('{"on":true,"unknown":"review","branch":"","prog":"","block":[],"notify":true}')) WHERE key='cfg'`);
    lead = JSON.parse((await t.sql<any>("SELECT data FROM docs WHERE type='lead' AND ref2 <> '' AND json_extract(data,'$.em')=1 AND json_extract(data,'$.status')='Open' AND ref2 NOT IN (SELECT lower(json_extract(p.value,'$.email')) FROM docs d, json_each(json_extract(d.data,'$.parents')) p WHERE d.type='student') LIMIT 1"))[0].data);
  });

  it('connects, then files new e-mails on the lead once, and a reply stays in the conversation', async () => {
    expect(await poll()).toMatchObject({ status: 'started', imported: 0 });
    f.add(mailFrom(lead.email, { id: '<parent-1@mail.example>', refs: '<first@laboffuture.com>' }));
    f.add(mailFrom('ranjith@laboffuture.com', { id: '<own@x>' })); // our own copy – skipped
    expect(await poll()).toMatchObject({ status: 'ok', imported: 1 });
    expect([...f.seen]).toEqual([3, 4]);

    const comm = (await t.sql<any>("SELECT data FROM docs WHERE type='comm'")).map((r) => JSON.parse(r.data)).find((c) => c.inbound && c.lead === lead.id && c.msgId);
    expect(comm).toMatchObject({ ch: 'Email', status: 'Received', from: lead.email.toLowerCase(), subject: 'Frage zur Gebühr – Robotics', msgId: '<parent-1@mail.example>', refs: '<first@laboffuture.com>' });
    expect(comm.text).toBe('Hello, when does the next class start? Danke – Mona');

    const st = await t.call('GET', '/api/v1/mail/status', { token: await t.login(USERS.admin) });
    expect(st.body.incoming).toMatchObject({ on: true, mode: 'live', host: 'imap.gmail.com', mailbox: 'ranjith@laboffuture.com', connected: true, imported: 1, lastError: '' });

    // the same e-mail delivered again (e.g. copied back into the inbox) is not filed twice
    f.add(mailFrom(lead.email, { id: '<parent-1@mail.example>' }));
    expect(await poll()).toMatchObject({ status: 'ok', imported: 0 });

    // Reply from the lead's history: queued with the thread headers, and the received e-mail is marked answered
    const r = await t.call('POST', '/api/v1/mail/compose', { token: await t.login(USERS.admin), body: { targets: [{ type: 'lead', id: lead.id }], subject: 'Re: Frage', body: 'Next Monday at 4 pm.', reply: { type: 'lead', id: lead.id, comm: comm.id } } });
    expect(r.status).toBe(200);
    expect(r.body.queued).toBe(1);
    const all = (await t.sql<any>("SELECT data FROM docs WHERE type='comm'")).map((x) => JSON.parse(x.data));
    expect(all.find((c) => c.tpl === 'Reply' && c.lead === lead.id)).toMatchObject({ inReplyTo: '<parent-1@mail.example>', refs: '<first@laboffuture.com> <parent-1@mail.example>' });
    expect(all.find((c) => c.id === comm.id).repliedAt).toBeTruthy();
  });

  it('a reply can only answer a received e-mail of that same record', async () => {
    const r = await t.call('POST', '/api/v1/mail/compose', { token: await t.login(USERS.admin), body: { targets: [{ type: 'lead', id: lead.id }], subject: 'Re: x', body: 'y', reply: { type: 'lead', id: lead.id, comm: 'CM-NOPE' } } });
    expect(r.body).toMatchObject({ queued: 0, skipped: [{ reason: 'The e-mail being answered was not found' }] });
  });

  it('reports a refused sign-in once to the administrators, without the password', async () => {
    f = fakeImap({ pass: 'something else' });
    const r = await poll();
    expect(r.status).toBe('error');
    expect(r.message).not.toContain(SRV.pass);
    const st = await t.call('GET', '/api/v1/mail/status', { token: await t.login(USERS.admin) });
    expect(st.body.incoming.lastError).toMatch(/Invalid credentials/);
    await poll();
    const n = await t.sql<any>("SELECT COUNT(*) AS n FROM docs WHERE type='notification' AND data LIKE '%could not be read%'");
    expect(n[0].n).toBe(1);
  });

  it('does nothing while import is off or the server runs in mock mode', async () => {
    await t.sql(`UPDATE settings SET data=json_set(data,'$.mailIn.on',json('false')) WHERE key='cfg'`);
    expect((await poll()).status).toBe('off');
    const m = await setup();
    expect((await pollMailbox(m.env, { connect: f.connect })).status).toBe('off');
    expect(f.log).toEqual([]);
  });
});
