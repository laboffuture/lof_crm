import type { NewLeadInput } from '../domain/core';
import { HttpError } from '../types';

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
