// Hosted checkout contract: Easebuzz's official Node kit, easebuzz-lib/utils.js.
// CRM browser code never handles card details or the merchant salt.
import { HttpError, type Env } from '../types';
import type { LinkInput, LinkResult, PayCtx } from './payments';
import { callApi, logMock } from './base';
import { safeEqual, toHex } from '../lib/crypto';

const sha512 = async (value: string) => toHex(await crypto.subtle.digest('SHA-512', new TextEncoder().encode(value)));
const udfs = Array.from({ length: 10 }, (_, i) => `udf${i + 1}`);
type Fields = Record<string, string>;

export function easebuzzEnvironment(env: Env): 'test' | 'prod' {
  const value = env.EASEBUZZ_ENV || 'test';
  if (value !== 'test' && value !== 'prod') throw new Error('EASEBUZZ_ENV must be test or prod');
  return value;
}
export const easebuzzPayBase = (env: Env) =>
  easebuzzEnvironment(env) === 'prod' ? 'https://pay.easebuzz.in' : 'https://testpay.easebuzz.in';
const dashboardBase = (env: Env) =>
  easebuzzEnvironment(env) === 'prod' ? 'https://dashboard.easebuzz.in' : 'https://testdashboard.easebuzz.in';

/** Environment-only readiness. Does not contact Easebuzz or expose credential values. */
export function easebuzzSetup(env: Env) {
  let environment: 'test' | 'prod';
  try {
    environment = easebuzzEnvironment(env);
  } catch {
    return {
      environment: 'invalid' as const,
      currency: 'INR',
      configured: false,
      paymentApi: null,
      transactionApi: null,
      webhook: null,
      returnUrl: null,
      problems: ['EASEBUZZ_ENV must be test or prod'],
    };
  }
  const problems: string[] = [];
  if (env.INTEGRATION_MODE !== 'auto') problems.push('Set INTEGRATION_MODE=auto');
  if (!env.EASEBUZZ_KEY?.trim()) problems.push('EASEBUZZ_KEY is missing');
  if (!env.EASEBUZZ_SALT?.trim()) problems.push('EASEBUZZ_SALT is missing');
  if (environment === 'test' && env.APP_ENV === 'production')
    problems.push('Sandbox checkout must use a separate non-production CRM');
  let base: URL | undefined;
  try {
    base = new URL(env.APP_BASE_URL);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash)
      throw new Error('Invalid CRM address');
  } catch {
    base = undefined;
    problems.push('APP_BASE_URL must be the CRM HTTP(S) address without credentials, query or fragment');
  }
  if (environment === 'prod' && base) {
    const h = base.hostname.toLowerCase();
    const privateHost =
      !h.includes('.') ||
      /(^|\.)(localhost|local|test|example|invalid)$/.test(h) ||
      /^(0|10|127)\./.test(h) ||
      /^169\.254\./.test(h) ||
      /^192\.168\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
      h.includes(':');
    if (base.protocol !== 'https:' || privateHost)
      problems.push(
        'Live checkout requires a public HTTPS APP_BASE_URL; localhost and placeholder addresses cannot receive live callbacks',
      );
  }
  const callbackBase = base ? (base.origin + base.pathname).replace(/\/+$/, '') : null;
  return {
    environment,
    currency: 'INR',
    configured: problems.length === 0,
    paymentApi: easebuzzPayBase(env) + '/payment/initiateLink',
    transactionApi: dashboardBase(env) + '/transaction/v2/retrieve',
    webhook: callbackBase ? callbackBase + '/webhooks/easebuzz' : null,
    returnUrl: callbackBase ? callbackBase + '/webhooks/easebuzz/return' : null,
    problems,
  };
}

function credentials(env: Env) {
  if (!env.EASEBUZZ_KEY?.trim() || !env.EASEBUZZ_SALT?.trim())
    throw new Error('Easebuzz merchant key and salt are not configured');
  return { key: env.EASEBUZZ_KEY.trim(), salt: env.EASEBUZZ_SALT.trim() };
}

export async function easebuzzRequestHash(fields: Fields, salt: string) {
  return sha512(
    ['key', 'txnid', 'amount', 'productinfo', 'firstname', 'email', ...udfs]
      .map((k) => fields[k] || '')
      .concat(salt)
      .join('|'),
  );
}
export async function easebuzzResponseHash(fields: Fields, salt: string) {
  return sha512(
    [
      salt,
      fields.status || '',
      ...[...udfs].reverse().map((k) => fields[k] || ''),
      ...['email', 'firstname', 'productinfo', 'amount', 'txnid', 'key'].map((k) => fields[k] || ''),
    ].join('|'),
  );
}
export async function easebuzzVerifyResponse(env: Env, fields: Fields) {
  const { key, salt } = credentials(env);
  return (
    safeEqual(fields.key || '', key) &&
    /^[a-f0-9]{128}$/i.test(fields.hash || '') &&
    safeEqual((fields.hash || '').toLowerCase(), await easebuzzResponseHash(fields, salt))
  );
}

export function assertEasebuzzCurrency(currency: string) {
  if (currency !== 'INR')
    throw new Error(
      `Easebuzz ${currency} checkout is awaiting the merchant's verified multicurrency API setup. Record an already received payment at the counter, or complete the Easebuzz setup. No currency conversion or alternative gateway is used.`,
    );
}

export async function easebuzzCreate(p: PayCtx, input: LinkInput): Promise<LinkResult> {
  assertEasebuzzCurrency(input.currency);
  if (!Number.isFinite(input.amount) || input.amount < 1)
    throw new Error('Easebuzz payment amount must be at least INR 1');
  const email = (input.customer.email || '').trim();
  const phone = (input.customer.phone || '').replace(/[\s()-]/g, '');
  const firstname = input.customer.name.trim().split(/\s+/)[0] || '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error('Add a valid parent email before creating an Easebuzz payment link');
  if (!/^\+?\d{5,20}$/.test(phone))
    throw new Error('Add a valid parent phone before creating an Easebuzz payment link');
  const fields: Fields = {
    // Keep the full description in CRM; send the sandbox-compatible ASCII fee
    // label and the unique payment reference.
    txnid: input.linkId,
    amount: input.amount.toFixed(2),
    productinfo: 'LOF course fees ' + input.linkId.replace(/[^a-zA-Z0-9]/g, ''),
    firstname,
    email,
    phone,
    surl: input.callbackUrl + '/return',
    furl: input.callbackUrl + '/return',
  };
  if (p.mode === 'mock') {
    await logMock(p.env, 'easebuzz', 'payment.initiate', fields, { status: 1, data: 'MOCK' }, input.linkId, p.isTest);
    return { provider: 'easebuzz', providerRef: input.linkId, url: input.returnUrl };
  }
  const { key, salt } = credentials(p.env);
  fields.key = key;
  fields.hash = await easebuzzRequestHash(fields, salt);
  const r = await callApi(
    p.env,
    {
      integration: 'easebuzz',
      operation: 'payment.initiate',
      method: 'POST',
      url: easebuzzPayBase(p.env) + '/payment/initiateLink',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields),
      ref: input.linkId,
      secrets: [key, salt, fields.hash],
      acceptResponse: (j) => j?.status === 1,
    },
    p.isTest,
  );
  if (!r.ok || r.json?.status !== 1 || typeof r.json?.data !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(r.json.data)) {
    const message =
      typeof r.json?.error_desc === 'string'
        ? r.json.error_desc.slice(0, 200)
        : `Payment link could not be created (HTTP ${r.status}); check the integration log`;
    const clean = [key, salt, fields.hash].reduce((msg, secret) => msg.split(secret).join('***'), message);
    throw new HttpError(502, `Easebuzz: ${clean}`);
  }
  return {
    provider: 'easebuzz',
    providerRef: input.linkId,
    url: easebuzzPayBase(p.env) + '/pay/' + encodeURIComponent(r.json.data),
  };
}

/** Server-to-server check; never treats a browser success flag as proof of payment. */
export async function easebuzzRetrieve(env: Env, txnid: string, isTest = false) {
  const { key, salt } = credentials(env);
  const hash = await sha512([key, txnid, salt].join('|'));
  const r = await callApi(
    env,
    {
      integration: 'easebuzz',
      operation: 'transaction.retrieve',
      method: 'POST',
      url: dashboardBase(env) + '/transaction/v2/retrieve',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ key, txnid, hash }),
      ref: txnid,
      secrets: [key, salt, hash],
    },
    isTest,
  );
  if (!r.ok || !r.json)
    throw new HttpError(502, `Easebuzz transaction check failed (HTTP ${r.status}); confirmation can be retried`);
  return r.json;
}

export function easebuzzTransaction(response: any, txnid: string) {
  if (response?.status !== true && response?.status !== 1) return null;
  const data = response.msg ?? response.data;
  const rows = Array.isArray(data) ? data : data && typeof data === 'object' ? [data] : [];
  return rows.find((row: any) => row?.txnid === txnid) || null;
}

/** A read-only probe is not proof of valid credentials when the transaction is absent. */
export async function easebuzzPing(p: PayCtx) {
  if (p.mode === 'mock')
    return { mock: true, note: 'Enable payments and configure the merchant key and salt to test Easebuzz' };
  const provider = easebuzzEnvironment(p.env) === 'test' ? 'easebuzz-test' : 'easebuzz';
  const link = await p.env.DB.prepare(
    'SELECT provider_ref FROM payment_links WHERE provider=? ORDER BY created_at DESC LIMIT 1',
  )
    .bind(provider)
    .first<{ provider_ref: string }>();
  if (!link)
    throw new Error(
      'Create and open a checkout first, then test its transaction lookup. A missing transaction cannot verify credentials.',
    );
  const response = await easebuzzRetrieve(p.env, link.provider_ref, true);
  const transaction = easebuzzTransaction(response, link.provider_ref);
  if (!transaction)
    throw new Error('Easebuzz has no transaction for the latest link yet. Open the checkout, then retry this test.');
  return {
    environment: easebuzzEnvironment(p.env),
    authenticated: true,
    transactionStatus: transaction.status,
    note: 'Transaction API verified. A completed checkout is required to test payment settlement.',
  };
}
