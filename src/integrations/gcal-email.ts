// Google Calendar (service account) and transactional e-mail (SMTP)
import type { Env } from '../types';
import { callApi, logMock, writeLog, type Mode } from './base';
import { loadSmtp, smtpSend } from './smtp';
import { signRs256 } from '../lib/crypto';

export interface SimpleCtx { env: Env; mode: Mode; isTest?: boolean }

// ---------------- Google Calendar ----------------
let cachedToken: { token: string; exp: number } | null = null;

async function googleToken(env: Env): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;
  const sa = JSON.parse(env.GCAL_SERVICE_ACCOUNT_JSON || '{}');
  const now = Math.floor(Date.now() / 1000);
  const assertion = await signRs256({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/calendar.events', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }, sa.private_key);
  const r = await callApi(env, {
    integration: 'gcal', operation: 'oauth.token', method: 'POST', url: 'https://oauth2.googleapis.com/token',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }), secrets: [assertion],
  });
  if (!r.ok) throw new Error(`Google OAuth: ${r.json?.error_description || r.status}`);
  cachedToken = { token: r.json.access_token, exp: Date.now() + r.json.expires_in * 1000 };
  return cachedToken.token;
}

export async function calendarInsert(g: SimpleCtx, ev: { summary: string; description: string; start: string; minutes: number; taskId: string }) {
  const body = {
    summary: ev.summary, description: ev.description,
    start: { dateTime: ev.start, timeZone: 'Asia/Dubai' }, end: { dateTime: new Date(new Date(ev.start).getTime() + ev.minutes * 60000).toISOString(), timeZone: 'Asia/Dubai' },
    extendedProperties: { private: { crmTask: ev.taskId } }, reminders: { useDefault: true },
  };
  if (g.mode === 'mock') {
    const id = 'mockevt' + ev.taskId.toLowerCase().replace(/[^a-z0-9]/g, '');
    await logMock(g.env, 'gcal', 'events.insert', body, { id, status: 'confirmed' }, ev.taskId, g.isTest);
    return { id };
  }
  const token = await googleToken(g.env);
  const r = await callApi(g.env, {
    integration: 'gcal', operation: 'events.insert', method: 'POST', url: `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(g.env.GCAL_CALENDAR_ID || '')}/events`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body), ref: ev.taskId, secrets: [token],
  }, g.isTest);
  if (!r.ok) throw new Error(`Google Calendar: ${r.json?.error?.message || r.status}`);
  return { id: r.json.id };
}

export async function calendarPing(g: SimpleCtx) {
  if (g.mode === 'mock') {
    await logMock(g.env, 'gcal', 'calendars.get', {}, { summary: 'LOF follow-ups (mock)' }, undefined, g.isTest);
    return { summary: 'LOF follow-ups (mock)' };
  }
  const token = await googleToken(g.env);
  const r = await callApi(g.env, { integration: 'gcal', operation: 'calendars.get', url: `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(g.env.GCAL_CALENDAR_ID || '')}`, headers: { authorization: `Bearer ${token}` }, secrets: [token] }, g.isTest);
  if (!r.ok) throw new Error(r.json?.error?.message || `HTTP ${r.status}`);
  return { summary: r.json.summary };
}

// ---------------- E-mail (SMTP – Configuration → Email Outgoing) ----------------
const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export async function sendEmail(e: SimpleCtx, m: { to: string; subject: string; text: string; ref?: string; fromName?: string; replyTo?: string; bcc?: string }) {
  const smtp = e.mode === 'live' ? await loadSmtp(e.env) : null;
  const msg = {
    from: smtp?.from || 'not-configured@localhost', fromName: m.fromName, to: m.to, subject: m.subject.replace(/[\r\n]+/g, ' '), text: m.text,
    replyTo: m.replyTo, bcc: m.bcc,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#1b2633">${esc(m.text).replace(/\n/g, '<br>')}<p style="color:#5d6a7a;font-size:12px;margin-top:24px">Lab of Future</p></div>`,
  };
  const logged = { from: msg.from, fromName: msg.fromName, to: msg.to, subject: msg.subject, text: msg.text, replyTo: msg.replyTo, bcc: msg.bcc };
  if (e.mode === 'mock') {
    const id = 'mock-' + crypto.randomUUID();
    await logMock(e.env, 'email', 'emails.send', logged, { id }, m.ref, e.isTest);
    return { id };
  }
  if (!smtp) throw new Error('E-mail: the SMTP server is not set up (Configuration → Email Outgoing)');
  const t0 = Date.now();
  try {
    const r = await smtpSend(smtp.server, msg);
    await writeLog(e.env, { integration: 'email', direction: 'out', operation: 'smtp.send', mode: 'live', method: 'SMTP', url: `smtp://${smtp.server.host}:${smtp.server.port}`, status: 250, ok: true, ms: Date.now() - t0, request: JSON.stringify(logged), response: r.response, ref: m.ref, isTest: e.isTest });
    return { id: r.id };
  } catch (err: any) {
    await writeLog(e.env, { integration: 'email', direction: 'out', operation: 'smtp.send', mode: 'live', method: 'SMTP', url: `smtp://${smtp.server.host}:${smtp.server.port}`, status: 0, ok: false, ms: Date.now() - t0, request: JSON.stringify(logged), error: String(err?.message || err), ref: m.ref, isTest: e.isTest });
    throw new Error('E-mail: ' + String(err?.message || err));
  }
}

/** Connects and signs in to the SMTP server without sending anything. */
export async function emailPing(e: SimpleCtx) {
  if (e.mode === 'mock') {
    await logMock(e.env, 'email', 'smtp.verify', {}, { ok: true }, undefined, e.isTest);
    return { server: 'mock' };
  }
  const smtp = await loadSmtp(e.env);
  if (!smtp) throw new Error('The SMTP server is not set up (Configuration → Email Outgoing)');
  const t0 = Date.now();
  try {
    const r = await smtpSend(smtp.server, null);
    await writeLog(e.env, { integration: 'email', direction: 'out', operation: 'smtp.verify', mode: 'live', method: 'SMTP', url: `smtp://${smtp.server.host}:${smtp.server.port}`, status: 235, ok: true, ms: Date.now() - t0, response: r.response, isTest: e.isTest });
    return { server: `${smtp.server.host}:${smtp.server.port}`, from: smtp.from };
  } catch (err: any) {
    await writeLog(e.env, { integration: 'email', direction: 'out', operation: 'smtp.verify', mode: 'live', method: 'SMTP', url: `smtp://${smtp.server.host}:${smtp.server.port}`, status: 0, ok: false, ms: Date.now() - t0, error: String(err?.message || err), isTest: e.isTest });
    throw err;
  }
}
