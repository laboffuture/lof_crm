// LOF CRM to LMS Integration Guide v1.1, 2 November 2026.
// Moodle accepts form-encoded calls and reports application errors even with HTTP 200.
import type { Env } from '../types';
import { callApi, logMock, redact, type Mode } from './base';

export interface LmsCtx {
  env: Env;
  mode: Mode;
  isTest?: boolean;
  flags?: any;
}
export interface TrackItem {
  track: string;
  credits: string[];
  product_name?: string;
}
export interface SkillsLabItem {
  program: string;
  sessions: number;
  valid_until?: string;
  product_name?: string;
}
export interface Purchase {
  reference: string;
  student_id: string;
  student_first_name: string;
  student_last_name: string;
  student_email: string;
  student_phone: string;
  student_dob: string;
  branch: string;
  valid_until: string;
  parent_id?: string;
  parent_name?: string;
  parent_email?: string;
  parent_phone?: string;
  items: TrackItem[];
  skillslabs: SkillsLabItem[];
}
export interface Receipt {
  accepted?: boolean;
  duplicate?: boolean;
  inboxid?: number;
  warnings?: { item?: string; message: string }[];
  purchaseknown?: boolean;
}
export class LmsError extends Error {
  constructor(
    message: string,
    public retryable = false,
    public code = 'invalidresponse',
  ) {
    super(message);
    this.name = 'LmsError';
  }
}

const FUNCTIONS = {
  enrol: 'local_lofplatform_erp_purchase',
  cancel: 'local_lofplatform_erp_cancel',
  catalogue: 'local_lofplatform_erp_catalogue',
  lookup: 'local_lofplatform_erp_student_lookup',
} as const;
const FIELDS = [
  'reference',
  'student_id',
  'student_first_name',
  'student_last_name',
  'student_email',
  'student_phone',
  'student_dob',
  'branch',
  'valid_until',
  'parent_id',
  'parent_name',
  'parent_email',
  'parent_phone',
] as const;

/** Public endpoint metadata only: never expose URL credentials, query values or tokens. */
export function diagnosticEndpoint(env: Pick<Env, 'LMS_URL' | 'LMS_TOKEN'>): string | null {
  try {
    const url = new URL(env.LMS_URL || '');
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return redact(url.toString(), [env.LMS_TOKEN, env.LMS_TOKEN && encodeURIComponent(env.LMS_TOKEN)]);
  } catch {
    return null;
  }
}

/** Explicit allowlist: financial fields and credentials from payloads can never reach Moodle. */
export function purchaseForm(payload: Purchase): URLSearchParams {
  const form = new URLSearchParams();
  for (const key of FIELDS) if (payload[key] !== undefined && payload[key] !== '') form.set(key, String(payload[key]));
  (payload.items || []).forEach((item, i) => {
    form.set(`items[${i}][track]`, item.track);
    item.credits.forEach((code, j) => form.set(`items[${i}][credits][${j}]`, code));
    if (item.product_name) form.set(`items[${i}][product_name]`, item.product_name);
  });
  (payload.skillslabs || []).forEach((item, i) => {
    form.set(`skillslabs[${i}][program]`, item.program);
    form.set(`skillslabs[${i}][sessions]`, String(item.sessions));
    if (item.valid_until) form.set(`skillslabs[${i}][valid_until]`, item.valid_until);
    if (item.product_name) form.set(`skillslabs[${i}][product_name]`, item.product_name);
  });
  return form;
}

async function post(c: LmsCtx, operation: keyof typeof FUNCTIONS, form: URLSearchParams, ref?: string): Promise<any> {
  form.set('wstoken', c.env.LMS_TOKEN || '');
  form.set('wsfunction', FUNCTIONS[operation]);
  form.set('moodlewsrestformat', 'json');
  const r = await callApi(
    c.env,
    {
      integration: 'lms',
      operation,
      method: 'POST',
      url: c.env.LMS_URL || '',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: form,
      ref,
      secrets: [c.env.LMS_TOKEN],
      timeoutMs: 30000,
    },
    c.isTest,
  );
  if (!r.ok)
    throw new LmsError(
      r.status
        ? `HTTP ${r.status} from LMS ${operation}`
        : `No answer from LMS ${operation}: ${redact(r.text, [c.env.LMS_TOKEN])}`,
      !r.status || r.status === 408 || r.status === 429 || r.status >= 500,
      'transport',
    );
  const result = r.json == null ? null : JSON.parse(redact(JSON.stringify(r.json), [c.env.LMS_TOKEN]));
  if (!result || typeof result !== 'object')
    throw new LmsError('LMS returned no valid JSON acknowledgement; delivery is uncertain', true);
  if (result.exception || result.errorcode || result.error || result.ok === false)
    throw new LmsError(
      `LMS ${result.errorcode || 'error'}: ${String(result.message || result.error || 'Request refused').slice(0, 500)}`,
      false,
      result.errorcode || 'refused',
    );
  if (operation === 'enrol' || operation === 'cancel') {
    if (result.accepted !== true && result.duplicate !== true)
      throw new LmsError('LMS did not acknowledge the order; delivery is uncertain', true);
    if (
      result.warnings !== undefined &&
      (!Array.isArray(result.warnings) || result.warnings.some((w: any) => !w || typeof w.message !== 'string'))
    )
      throw new LmsError('LMS returned invalid warnings; check the received order with LOF');
    if (operation === 'cancel' && typeof result.purchaseknown !== 'boolean')
      throw new LmsError('LMS cancellation did not report purchaseknown; check with LOF');
  }
  if (operation === 'catalogue' && !Array.isArray(result) && !Array.isArray(result.tracks))
    throw new LmsError('LMS catalogue response contains no Track list; confirm the response format with LOF');
  return result;
}

export async function enrol(c: LmsCtx, payload: Purchase, ref?: string): Promise<Receipt> {
  if (c.mode === 'mock') {
    if (c.flags?.moodleFail) {
      await logMock(c.env, 'lms', 'enrol', payload, { error: 'HTTP 503 (simulated outage)' }, ref, c.isTest, false);
      throw new LmsError('HTTP 503 Service Unavailable (simulated outage – Testing Console)', true, 'transport');
    }
    const res = { accepted: true, duplicate: false, inboxid: 1, warnings: [] };
    await logMock(c.env, 'lms', 'enrol', payload, res, ref, c.isTest);
    return res;
  }
  return post(c, 'enrol', purchaseForm(payload), ref);
}

export async function cancel(c: LmsCtx, reference: string, ref?: string, reason?: string): Promise<Receipt> {
  if (c.mode === 'mock') {
    if (c.flags?.moodleFail) {
      await logMock(
        c.env,
        'lms',
        'cancel',
        { reference },
        { error: 'HTTP 503 (simulated outage)' },
        ref,
        c.isTest,
        false,
      );
      throw new LmsError('HTTP 503 Service Unavailable (simulated outage – Testing Console)', true, 'transport');
    }
    const res = { accepted: true, duplicate: false, inboxid: 1, purchaseknown: true, warnings: [] };
    await logMock(c.env, 'lms', 'cancel', { reference }, res, ref, c.isTest);
    return res;
  }
  return post(c, 'cancel', new URLSearchParams({ reference, ...(reason ? { reason } : {}) }), ref);
}

export async function catalogue(c: LmsCtx, track?: string) {
  if (c.mode === 'mock') {
    const res = { tracks: [], mock: true };
    await logMock(c.env, 'lms', 'catalogue', track ? { track } : {}, res, undefined, c.isTest);
    return res;
  }
  return post(c, 'catalogue', new URLSearchParams(track ? { track } : {}));
}

export async function studentLookup(c: LmsCtx, student_id: string) {
  if (c.mode === 'live') return post(c, 'lookup', new URLSearchParams({ student_id }));
  const res = { student_id, mock: true };
  await logMock(c.env, 'lms', 'lookup', { student_id }, res, student_id, c.isTest);
  return res;
}

/** Existing connection-test callers now use the documented read-only catalogue function. */
export const ping = catalogue;
