import type { NewLeadInput } from '../domain/core';
import { HttpError } from '../types';
import { callApi, logMock } from './base';
import { waNumber, type WaCtx } from './whatsapp';

/** Maps the JSON posted by the API node after the WhatsApp Flow is submitted. */
export function parseGupshupSubmission(body: unknown): { id: string; input: NewLeadInput } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Expected a JSON object');
  const fields = body as Record<string, unknown>;
  const field = (key: string, max: number, required = false) => {
    const raw = fields[key];
    if (raw !== undefined && typeof raw !== 'string') throw new HttpError(400, `${key} must be a string`);
    const value = raw?.trim() || '';
    if (required && !value) throw new HttpError(400, `${key} is required`);
    if (value.length > max) throw new HttpError(400, `${key} must be at most ${max} characters`);
    return value;
  };
  const consent = (key: string) => {
    const value = fields[key];
    if (value !== undefined && typeof value !== 'boolean') throw new HttpError(400, `${key} must be a boolean`);
    return value === true;
  };

  const id = field('submission_id', 512, true);
  const phone = field('phone', 16, true);
  if (!/^\+?[1-9]\d{6,14}$/.test(phone)) throw new HttpError(400, 'phone must include the country code and contain 7 to 15 digits');
  const email = field('email', 160);
  if (email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new HttpError(400, 'Enter a valid e-mail address');

  return {
    id,
    input: {
      student: field('student', 120, true), parent: field('parent', 120, true),
      phone: phone.startsWith('+') ? phone : '+' + phone, email,
      branch: field('branch', 60, true), prog: field('prog', 60, true), src: 'WhatsApp',
      school: field('school', 160), grade: field('grade', 40), notes: field('notes', 2000), camp: field('campaign', 120),
      wa: consent('wa_consent'), em: consent('email_consent'),
      external: { gupshup: { submissionId: id } },
    },
  };
}

export function gupshupTemplateIds(value: string | undefined): Record<string, string> {
  if (!value?.trim()) return {};
  const message = 'GUPSHUP_TEMPLATE_IDS must map CRM template IDs to quoted Gupshup template IDs';
  let ids: unknown;
  try { ids = JSON.parse(value); } catch { throw new Error(message); }
  if (!ids || typeof ids !== 'object' || Array.isArray(ids) ||
      Object.values(ids).some((id) => typeof id !== 'string' || !/^\d+$/.test(id))) {
    throw new Error(message);
  }
  return ids as Record<string, string>;
}

export async function sendGupshupTemplate(w: WaCtx, to: string, templateId: string, ref: string): Promise<{ id: string }> {
  const phone = waNumber(to);
  if (!/^[1-9]\d{6,14}$/.test(phone)) throw new Error('Gupshup requires an international phone number');
  const body = new URLSearchParams({
    send_to: phone, msg_type: 'text', userid: w.env.GUPSHUP_CLIENT_ID?.trim() || '',
    auth_scheme: 'plain', v: '1.1', format: 'json', method: 'SendMessage',
    isHSM: 'true', isTemplate: 'true', linkTrackingEnabled: 'true', msg_id: ref, whatsAppTemplateId: templateId,
  });
  if (w.mode === 'mock') {
    const id = 'gupshup.MOCK.' + ref;
    await logMock(w.env, 'gupshup', 'messages.send', Object.fromEntries(body), { response: { id, status: 'success' } }, ref, w.isTest);
    return { id };
  }
  const token = w.env.GUPSHUP_API_TOKEN?.trim();
  if (!body.get('userid') || !token) throw new Error('Set GUPSHUP_CLIENT_ID and GUPSHUP_API_TOKEN before sending');
  const result = await callApi(w.env, {
    integration: 'gupshup', operation: 'messages.send', method: 'POST',
    url: 'https://mediaapi.smsgupshup.com/GatewayAPI/rest',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' },
    body, ref, secrets: [token],
    acceptResponse: (json) => json?.response?.status === 'success' &&
      typeof json.response.id === 'string' && !!json.response.id.trim(),
  }, w.isTest);
  if (!result.ok) {
    if (!result.status || result.status >= 500) throw new Error('Gupshup send could not be confirmed');
    if (result.status >= 200 && result.status < 300) throw new Error('Gupshup rejected the message or returned an invalid acknowledgement');
    throw new Error(`Gupshup send failed (HTTP ${result.status})`);
  }
  return { id: result.json.response.id.trim() };
}
