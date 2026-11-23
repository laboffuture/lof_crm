import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { vi } from 'vitest';
import { TestD1 } from './d1';
import { app } from '../../src/index';
import type { Env } from '../../src/types';
import { easebuzzResponseHash } from '../../src/integrations/easebuzz';

const root = new URL('../../', import.meta.url);
const seedPath = new URL('migrations/0002_seed.sql', root);

/** Seed is generated once from the prototype (scripts/build-seed.mjs). */
function seedSql() {
  if (!existsSync(seedPath)) execFileSync(process.execPath, ['scripts/build-seed.mjs'], { cwd: root });
  return readFileSync(seedPath, 'utf8');
}
const migrations = readdirSync(new URL('migrations/', root)).filter((name) => name.endsWith('.sql')).sort();
const migrationSql = migrations.map((name) => name === '0002_seed.sql' ? seedSql() : readFileSync(new URL('migrations/' + name, root), 'utf8'));

export const PASSWORD = 'Welcome@LOF2026';
export const USERS = {
  admin: 'vikram.sethi@example.com', // System Administrator
  priya: 'priya.nair@example.com', // Counsellor, Al Karama
  fatima: 'fatima.khan@example.com', // Counsellor, Sports City
  hassan: 'hassan.ali@example.com', // Centre Administrator, Al Karama
  nadia: 'nadia.farouk@example.com', // Admissions Head, UAE
  deepa: 'deepa.krishnan@example.com', // Admissions Head, India
  layla: 'layla.haddad@example.com', // Reception
  khalid: 'khalid.rahman@example.com', // Management
};

export const SECRETS = {
  JWT_SECRET: 'test-jwt-secret-0123456789abcdefghij',
  WEBSITE_FORM_SECRET: 'web-secret',
  META_APP_SECRET: 'meta-secret',
  META_VERIFY_TOKEN: 'meta-verify',
  META_PAGE_ACCESS_TOKEN: 'meta-page-token',
  WHATSAPP_PHONE_NUMBER_ID: '1234567890',
  WHATSAPP_ACCESS_TOKEN: 'wa-token-xyz',
  WHATSAPP_APP_SECRET: 'wa-secret',
  WHATSAPP_VERIFY_TOKEN: 'wa-verify',
  EXOTEL_SID: 'labofuture1',
  EXOTEL_API_KEY: 'exo-key',
  EXOTEL_API_TOKEN: 'exo-token',
  EXOTEL_CALLER_ID: '04-5550000',
  EXOTEL_WEBHOOK_TOKEN: 'exo-hook',
  LMS_URL: 'https://lms.test/api/booking',
  LMS_TOKEN: 'lms-token-abc123',
  TELR_STORE_ID: '12345',
  TELR_AUTH_KEY: 'telr-auth',
  RAZORPAY_KEY_ID: 'rzp_test_key',
  RAZORPAY_KEY_SECRET: 'rzp-secret',
  RAZORPAY_WEBHOOK_SECRET: 'rzp-hook',
  ERPNEXT_URL: 'https://erp.test',
  ERPNEXT_API_KEY: 'erp-key',
  ERPNEXT_API_SECRET: 'erp-secret',
  ERPNEXT_PAID_TO_AED: 'Bank AED - LOF',
  ERPNEXT_PAID_TO_INR: 'Bank INR - LOF',
};

export interface TestCtx {
  env: Env;
  d1: TestD1;
  call: (method: string, path: string, o?: { token?: string; body?: unknown; raw?: string; headers?: Record<string, string> }) => Promise<{ status: number; body: any; text: string; headers: Headers }>;
  login: (email: string) => Promise<string>;
  sql: <T = any>(q: string, ...b: unknown[]) => Promise<T[]>;
  setCfg: (fn: (cfg: any) => void) => Promise<void>;
}

/** Fresh in-memory database with schema + prototype seed, and an app caller that awaits background work. */
export async function setup(overrides: Partial<Env> = {}, opts: { keepMustChange?: boolean; strictIds?: boolean } = {}): Promise<TestCtx> {
  const d1 = new TestD1();
  for (const sql of migrationSql) d1.db.exec(sql);
  // Demo logins must change their password; most tests start from accounts that already did
  if (!opts.keepMustChange) d1.db.exec('UPDATE staff_auth SET must_change=0');
  // Sync tests write hand-picked ids (RF-26-0009, CL-900 …). In the app those numbers come from /seq first;
  // moving the counters ahead stands in for that so the ids count as issued. strictIds keeps the seeded counters.
  if (!opts.strictIds) d1.db.exec("UPDATE sequences SET value=value+10000 WHERE name IN ('opp','enr','pay','student','ap','rf','pd','ms','task','call','cm','notif','audit')");
  const env = { DB: d1 as unknown as D1Database, APP_ENV: 'test', APP_BASE_URL: 'https://crm.test', INTEGRATION_MODE: 'mock', ALLOW_IMPERSONATION: 'true', META_GRAPH_VERSION: 'v21.0', MFA_REQUIRED_ROLES: '', ...SECRETS, ...overrides } as Env;
  const tokens: Record<string, string> = {};

  const call: TestCtx['call'] = async (method, path, o = {}) => {
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
    const headers: Record<string, string> = { ...(o.headers || {}) };
    if (o.token) headers.authorization = 'Bearer ' + o.token;
    let body: string | undefined = o.raw;
    if (o.body !== undefined) { body = JSON.stringify(o.body); headers['content-type'] ||= 'application/json'; }
    const res = await app.fetch(new Request('https://crm.test' + path, { method, headers, body }), env, ctx);
    // background jobs (WhatsApp, Moodle, ERPNext …) finish before the test inspects state
    for (let i = 0; i < 5 && pending.length; i++) await Promise.all(pending.splice(0));
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* html/text */ }
    return { status: res.status, body: json, text, headers: res.headers };
  };
  const login = async (email: string) => {
    if (tokens[email]) return tokens[email];
    const r = await call('POST', '/api/v1/auth/login', { body: { email, password: PASSWORD } });
    if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${r.text}`);
    return (tokens[email] = r.body.token);
  };
  const sql = async <T = any>(q: string, ...b: unknown[]) => (await d1.prepare(q).bind(...b).all<T>()).results;
  const setCfg = async (fn: (cfg: any) => void) => {
    const r = await d1.prepare("SELECT data FROM settings WHERE key='cfg'").first<any>();
    const cfg = JSON.parse(r.data);
    fn(cfg);
    await d1.prepare("UPDATE settings SET data=? WHERE key='cfg'").bind(JSON.stringify(cfg)).run();
  };
  return { env, d1, call, login, sql, setCfg };
}

export const doc = async (t: TestCtx, type: string, id: string) => {
  const r = await t.d1.prepare('SELECT data FROM docs WHERE type=? AND id=?').bind(type, id).first<any>();
  return r ? JSON.parse(r.data) : null;
};

/** Route-based fetch stub for live-mode adapter tests. Unmatched requests fail the test loudly. */
export function stubFetch(routes: [RegExp, (req: { url: string; method: string; body: string; headers: Record<string, string> }) => { status?: number; json?: unknown; text?: string }][]) {
  const calls: { url: string; method: string; body: string; headers: Record<string, string> }[] = [];
  const fn = vi.fn(async (input: any, init: any = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = init.method || 'GET';
    const body = init.body == null ? '' : String(init.body);
    const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const req = { url, method, body, headers };
    calls.push(req);
    const hit = routes.find(([re]) => re.test(url));
    if (!hit) return new Response(JSON.stringify({ error: 'unexpected request ' + url }), { status: 599 });
    const r = hit[1](req);
    return new Response(r.text ?? JSON.stringify(r.json ?? null), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return { calls, fn };
}

/** An isolated provider double. No test contacts Easebuzz or another integration. */
export async function setupEasebuzz() {
  const t = await setup({
    INTEGRATION_MODE: 'auto', APP_BASE_URL: 'https://crm.example.com',
    EASEBUZZ_ENV: 'prod', EASEBUZZ_KEY: 'fixture-easebuzz-key', EASEBUZZ_SALT: 'fixture-easebuzz-salt',
  });
  await t.setCfg((cfg) => {
    for (const config of Object.values(cfg.integ) as { on: boolean }[]) config.on = false;
    cfg.integ.pay.on = true;
  });
  const transactions = new Map<string, { amount: string; status: string }>();
  stubFetch([
    [/^https:\/\/pay\.easebuzz\.in\/payment\/initiateLink$/, ({ body }) => {
      const fields = new URLSearchParams(body);
      transactions.set(fields.get('txnid')!, { amount: fields.get('amount')!, status: 'pending' });
      return { json: { status: 1, data: 'fixture-hosted-checkout' } };
    }],
    [/^https:\/\/dashboard\.easebuzz\.in\/transaction\/v2\/retrieve$/, ({ body }) => {
      const txnid = new URLSearchParams(body).get('txnid')!;
      const transaction = transactions.get(txnid);
      return transaction ? { json: { status: true, msg: [{ ...transaction, txnid, currency: 'INR', easepayid: 'paid-' + txnid, mode: 'UPI' }] } }
        : { json: { status: false, msg: 'Transaction not found.' } };
    }],
  ]);
  return {
    ...t,
    async pay(id: string) {
      const transaction = transactions.get(id);
      if (!transaction) throw new Error('The fixture link does not exist');
      transaction.status = 'success';
      const fields = { txnid: id, key: t.env.EASEBUZZ_KEY!, status: 'success', amount: transaction.amount };
      const hash = await easebuzzResponseHash(fields, t.env.EASEBUZZ_SALT!);
      return t.call('POST', '/webhooks/easebuzz', {
        raw: new URLSearchParams({ ...fields, hash }).toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
    },
  };
}

/** Reuse the seeded fixtures for payment tests while using the currently supported checkout currency. */
export async function useInrFixtures(t: TestCtx, branch: string) {
  await t.d1.prepare("UPDATE docs SET data=json_set(data,'$.cur','INR') WHERE branch=? AND type IN ('fee','enrollment')").bind(branch).run();
}
