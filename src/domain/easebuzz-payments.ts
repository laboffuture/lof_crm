import type { Env } from '../types';
import { HttpError } from '../types';
import { Repo } from '../lib/db';
import { easebuzzEnvironment, easebuzzRetrieve, easebuzzTransaction } from '../integrations/easebuzz';
import { settleLink } from './workflows';
import { isUatEnrollment } from './uat-policy';
import { inList } from '../lib/auth';

const sandboxViewEnabled = (env: Env) => env.APP_ENV !== 'production' && (env.EASEBUZZ_ENV || 'test') === 'test';

/** Present verified sandbox receipts against the source enrolment in the non-production CRM. */
export async function sandboxPaymentRecords(env: Env, scope: string[], enrollmentId?: string) {
  if (!sandboxViewEnabled(env) || !scope.length) return [];
  const rows = await env.DB.prepare(`
    SELECT json_set(p.data, '$.enr', original.id, '$.stu', original.ref1, '$.branch', original.branch,
      '$.sandboxEnrollmentId', checkout.id) AS data
    FROM payment_links l
    JOIN docs p ON p.type='payment' AND p.id=l.payment_id AND p.is_test=1
    JOIN docs checkout ON checkout.type='enrollment' AND checkout.id=l.enrollment_id AND checkout.is_test=1
    JOIN docs original ON original.type='enrollment' AND original.id=json_extract(checkout.data,'$.sandboxSource')
    WHERE l.provider='easebuzz-test' AND l.is_test=1 AND l.status='paid'
      AND original.is_test=0 AND original.branch IN (${inList(scope)})
      ${enrollmentId ? 'AND original.id=?' : ''}
    ORDER BY p.at, p.id
  `).bind(...scope, ...(enrollmentId ? [enrollmentId] : [])).all<{ data: string }>();
  return rows.results.map((row) => JSON.parse(row.data));
}

/** Keep the delivered reference and its source enrollment available to the LMS view. */
export async function sandboxLmsRecords(env: Env, scope: string[]) {
  if (!sandboxViewEnabled(env) || !scope.length) return [];
  const rows = await env.DB.prepare(`
    SELECT call.data, original.id AS enrollmentId, original.ref1 AS studentId
    FROM docs call
    JOIN docs checkout ON checkout.type='enrollment' AND checkout.id=call.ref1 AND checkout.is_test=1
    JOIN docs original ON original.type='enrollment' AND original.id=json_extract(checkout.data,'$.sandboxSource')
    WHERE call.type='moodle_sync' AND call.is_test=1 AND json_extract(checkout.data,'$.ms')=call.id
      AND json_extract(checkout.data,'$.payStatus')='Paid' AND call.status<>'Awaiting Payment'
      AND original.is_test=0 AND original.branch IN (${inList(scope)})
  `).bind(...scope).all<{ data: string; enrollmentId: string; studentId: string }>();
  return rows.results.map(({ data, ...source }) => ({ ...source, call: JSON.parse(data) }));
}

const minor = (value: unknown) => {
  const text = String(value ?? '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return NaN;
  return Math.round(Number(text) * 100);
};

/** Use the link's saved environment and test scope, never callback flags or query parameters. */
export async function confirmEasebuzz(env: Env, txnid: string) {
  const link = await env.DB.prepare(
    "SELECT * FROM payment_links WHERE provider_ref=? AND provider IN ('easebuzz','easebuzz-test')",
  )
    .bind(txnid)
    .first<any>();
  if (!link) throw new HttpError(404, 'Unknown Easebuzz payment');
  const sandbox = link.provider === 'easebuzz-test';
  if (sandbox !== (easebuzzEnvironment(env) === 'test'))
    throw new HttpError(409, 'Easebuzz environment differs from this payment link');
  if (sandbox && env.APP_ENV === 'production')
    throw new HttpError(409, 'Sandbox payments are restricted to test enrolments outside production');
  const e = await new Repo(env.DB, 'Payment gateway', !!link.is_test).get<any>('enrollment', link.enrollment_id);
  const beforeEnrollment = !sandbox && !e && !!link.draft && !!link.opp_id;
  if ((!e && !beforeEnrollment) || (e && !!e.test !== sandbox) || !!link.is_test !== sandbox)
    throw new HttpError(409, 'Payment enrolment does not match the saved payment mode');
  if (sandbox && e?.uatFlow && !isUatEnrollment(env, e)) throw new HttpError(409, 'This full-flow test can only deliver to the supplied UAT LMS outside production.');
  const response = await easebuzzRetrieve(env, txnid, !!link.is_test);
  const transaction = easebuzzTransaction(response, txnid);
  if (!transaction) throw new HttpError(502, 'Easebuzz has not confirmed this transaction; retry confirmation later');
  if (
    link.currency !== 'INR' ||
    (transaction.currency && transaction.currency !== 'INR') ||
    minor(transaction.amount) !== minor(link.amount)
  ) {
    throw new HttpError(409, 'Easebuzz amount or currency does not match the payment link');
  }
  if (transaction.status !== 'success') {
    return { link, sandbox, status: 'pending', paymentId: undefined as string | undefined, jobs: [] };
  }
  // Retrieve V2 returns easepayid (verified against the sandbox response).
  const paymentRef = transaction.easepayid || transaction.easebuzz_id;
  if (typeof paymentRef !== 'string' || !paymentRef)
    throw new HttpError(502, 'Easebuzz did not return a payment reference');
  const repo = new Repo(env.DB, 'Payment gateway', !!link.is_test);
  // Explicit full-flow UAT orders may reach only the allowlisted UAT LMS. Finance remains suppressed.
  const paymentEnv = sandbox
    ? { ...env, INTEGRATION_MODE: isUatEnrollment(env, e) ? env.INTEGRATION_MODE : 'mock', JOBS: undefined }
    : env;
  const methods: Record<string, string> = { UPI: 'UPI', CC: 'Card', DC: 'Card', NB: 'Bank transfer' };
  const result = await settleLink(paymentEnv, repo, link.id, {
    amount: Number(transaction.amount),
    txnRef: paymentRef,
    method: methods[transaction.mode] || 'Online',
  });
  return { link, sandbox, status: 'paid', ...result, jobs: result.jobs ?? [] };
}
