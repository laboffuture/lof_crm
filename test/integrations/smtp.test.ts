// SMTP sending (Configuration → Email Outgoing → SMTP server): the protocol conversation against a fake
// server, the MIME message, and that the password stays on the server.
import { describe, it, expect, beforeEach } from 'vitest';
import { smtpSend, loadSmtp, type SmtpSocket } from '../../src/integrations/smtp';
import { setup, USERS, type TestCtx } from '../helpers/app';

/** A scripted SMTP server speaking over in-memory streams. */
function fakeServer(o: { starttls?: boolean; authOk?: boolean } = {}) {
  const log: string[] = [];
  let data = '', inData = false, buf = '';
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const say = (s: string) => ctrl.enqueue(enc.encode(s + '\r\n'));
  const handle = (l: string, tls: boolean) => {
    if (inData) { if (l === '.') { inData = false; say('250 2.0.0 OK queued'); } else data += l + '\n'; return; }
    log.push(l);
    if (/^EHLO /.test(l)) { say('250-fake.smtp at your service'); if (o.starttls && !tls) say('250-STARTTLS'); say('250 AUTH LOGIN PLAIN XOAUTH2'); }
    else if (l === 'STARTTLS') say('220 2.0.0 Ready to start TLS');
    else if (/^AUTH PLAIN /.test(l)) say(o.authOk === false ? '535-5.7.8 Username and Password not accepted.\r\n535 5.7.8 Learn more' : '235 2.7.0 Accepted');
    else if (/^(MAIL FROM|RCPT TO):/.test(l)) say('250 2.1.0 OK');
    else if (l === 'DATA') { inData = true; say('354 Go ahead'); }
    else if (l === 'QUIT') say('221 2.0.0 closing connection');
    else say('502 unknown');
  };
  const make = (tls: boolean): SmtpSocket => {
    const readable = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; } });
    const writable = new WritableStream<Uint8Array>({
      write(chunk) { buf += dec.decode(chunk); let i; while ((i = buf.indexOf('\r\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 2); handle(l, tls); } },
    });
    return { readable, writable, startTls: () => make(true), close() {} };
  };
  const connect = (host: string, port: number, security: string) => { log.push(`CONNECT ${host}:${port} ${security}`); const s = make(security === 'ssl'); say('220 fake.smtp ESMTP ready'); return s; };
  return { connect, log, data: () => data };
}
const SRV = { host: 'smtp.gmail.com', port: 465, security: 'ssl' as const, user: 'communications@laboffuture.com', pass: 'abcd efgh ijkl mnop' };
const MSG = { from: 'communications@laboffuture.com', fromName: 'Lab of Future', to: 'parent@example.com', bcc: 'archive@laboffuture.com', replyTo: 'office@laboffuture.com', subject: 'Fee receipt – Aarav', text: 'Dear parent,\nThank you.', html: '<p>Thank you.</p>' };
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

describe('SMTP conversation', () => {
  it('signs in over SSL and sends one message to the recipient and the copy address', async () => {
    const f = fakeServer();
    const r = await smtpSend(SRV, MSG, { connect: f.connect });
    expect(r.id).toMatch(/@laboffuture\.com$/);
    expect(f.log).toEqual([
      'CONNECT smtp.gmail.com:465 ssl', 'EHLO crm.laboffuture.com', 'AUTH PLAIN ' + b64('\u0000communications@laboffuture.com\u0000abcd efgh ijkl mnop'),
      'MAIL FROM:<communications@laboffuture.com>', 'RCPT TO:<parent@example.com>', 'RCPT TO:<archive@laboffuture.com>', 'DATA', 'QUIT',
    ]);
    const d = f.data();
    expect(d).toContain('From: "Lab of Future" <communications@laboffuture.com>');
    expect(d).toContain('To: <parent@example.com>');
    expect(d).toContain('Reply-To: <office@laboffuture.com>');
    expect(d).toContain('Subject: =?UTF-8?B?'); // the en dash is encoded
    expect(d).not.toMatch(/^Bcc:/m); // the copy address stays hidden
    const text = d.split('Content-Type: text/plain; charset=UTF-8')[1].split('\n\n')[1].split('--')[0].replace(/\s/g, '');
    expect(Buffer.from(text, 'base64').toString('utf8')).toBe('Dear parent,\r\nThank you.');
  });
  it('upgrades to TLS with STARTTLS on port 587 and says hello again', async () => {
    const f = fakeServer({ starttls: true });
    await smtpSend({ ...SRV, port: 587, security: 'starttls' }, MSG, { connect: f.connect });
    expect(f.log.slice(0, 4)).toEqual(['CONNECT smtp.gmail.com:587 starttls', 'EHLO crm.laboffuture.com', 'STARTTLS', 'EHLO crm.laboffuture.com']);
  });
  it('explains a refused sign-in without revealing the password', async () => {
    const f = fakeServer({ authOk: false });
    const err = await smtpSend(SRV, MSG, { connect: f.connect }).catch((e) => e);
    expect(err.message).toMatch(/Sign-in – 535 .*app password/);
    expect(err.message).not.toContain(SRV.pass);
  });
  it('checks the connection without sending when there is no message', async () => {
    const f = fakeServer();
    expect((await smtpSend(SRV, null, { connect: f.connect })).response).toBe('Signed in to smtp.gmail.com');
    expect(f.log).not.toContain('DATA');
  });
});

describe('SMTP settings', () => {
  let t: TestCtx;
  beforeEach(async () => { t = await setup(); });
  const put = async (body: any, email = USERS.admin) => t.call('PUT', '/api/v1/mail/smtp', { token: await t.login(email), body });
  const ok = { host: 'smtp.gmail.com', port: 465, security: 'ssl', user: 'communications@laboffuture.com', from: 'communications@laboffuture.com', pass: 'abcd efgh ijkl mnop' };

  it('saves the server, keeps the password encrypted and never sends it to a browser', async () => {
    const r = await put(ok);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ smtp: { host: 'smtp.gmail.com', port: 465, security: 'ssl', passSet: true }, missing: [] });
    const stored = (await t.sql<any>("SELECT data FROM settings WHERE key='smtp_pass'"))[0].data;
    expect(stored).not.toContain('abcd');
    expect((await loadSmtp(t.env))?.server.pass).toBe('abcd efgh ijkl mnop');
    const boot = await t.call('GET', '/api/v1/bootstrap', { token: await t.login(USERS.admin) });
    expect(boot.body.data.cfg.mailOut.smtp).toMatchObject({ host: 'smtp.gmail.com', passSet: true });
    expect(JSON.stringify(boot.body)).not.toContain('abcd efgh');
    const backup = await t.call('GET', '/api/v1/admin/db/backup', { token: await t.login(USERS.admin) });
    expect(JSON.stringify(backup.body)).not.toContain('smtp_pass');
    const status = await t.call('GET', '/api/v1/mail/status', { token: await t.login(USERS.admin) });
    expect(status.body.outgoing).toMatchObject({ provider: 'SMTP', from: 'communications@laboffuture.com', missing: [] });
  });
  it('keeps the saved password when the form is saved again without one', async () => {
    await put(ok);
    expect((await put({ ...ok, pass: '', port: 587, security: 'starttls' })).body.smtp).toMatchObject({ port: 587, passSet: true });
    expect((await loadSmtp(t.env))?.server).toMatchObject({ port: 587, security: 'starttls', pass: 'abcd efgh ijkl mnop' });
  });
  it('is not changed or removed by saving other configuration', async () => {
    await put(ok);
    const boot = await t.call('GET', '/api/v1/bootstrap', { token: await t.login(USERS.admin) });
    const cfg = boot.body.data.cfg;
    cfg.mailOut = { ...cfg.mailOut, fromName: 'LOF', smtp: { host: 'evil.example', user: 'x', from: 'x@evil.example', passSet: true } };
    expect((await t.call('PUT', '/api/v1/sync', { token: await t.login(USERS.admin), body: { changes: [], settings: [{ key: 'cfg', doc: cfg }] } })).status).toBe(200);
    const saved = JSON.parse((await t.sql<any>("SELECT data FROM settings WHERE key='cfg'"))[0].data).mailOut;
    expect(saved.fromName).toBe('LOF');
    expect(saved.smtp).toMatchObject({ host: 'smtp.gmail.com', user: 'communications@laboffuture.com' });
  });
  it('checks the input and who may change it', async () => {
    expect((await put({ ...ok, host: 'not a host' })).body.error).toMatch(/SMTP server name/);
    expect((await put({ ...ok, port: 25 })).body.error).toMatch(/Port 25 is blocked/);
    expect((await put({ ...ok, security: 'none' })).body.error).toMatch(/SSL or STARTTLS/);
    expect((await put({ ...ok, from: 'nope' })).body.error).toMatch(/From address/);
    expect((await put(ok, USERS.priya)).status).toBe(403);
  });
});
