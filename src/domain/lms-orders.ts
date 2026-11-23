import { Repo, nowIso } from '../lib/db';
import { modeFor } from '../integrations/base';
import { catalogue, diagnosticEndpoint, LmsError, type LmsCtx, type Purchase } from '../integrations/lms';
import type { Env } from '../types';
import { lmsEnrolPayload, lmsMissing } from './terms';

export const LMS_CONTRACT = '2026-11-v1.1';

export const studentEmailKey = (email: unknown) => String(email ?? '').trim().toLowerCase();

const UAT_TRACKS = [
  { code: 'FT', credits: ['F2', 'FC1', 'FC2', 'FC3', 'FC4'] },
  { code: 'RT', credits: ['C1', 'C2'] },
];

export function lmsPayloadProblems(payload: Purchase, e: any, student: any): string[] {
  const problems = lmsMissing(payload);
  if (payload.student_id !== student.id) problems.push('student_id must match the registered student');
  if (payload.reference !== e.id) problems.push('reference must match the enrolment');
  return problems;
}

export async function validateLmsCodes(ctx: LmsCtx, payload: Purchase, checkCatalogue = true) {
  if (ctx.mode !== 'live') return;
  const endpoint = diagnosticEndpoint(ctx.env);
  if (!endpoint) throw new LmsError('Configure a valid LMS endpoint before taking payment.', false, 'localvalidation');
  const uat = new URL(endpoint).origin === 'https://uat.learning.laboffuture.com';
  if (uat && (payload.branch !== 'AW' || payload.skillslabs.length))
    throw new LmsError('The UAT LMS supports branch AW and Track packages only. Check the branch and package mapping.', false, 'localvalidation');
  if (!payload.items.length || (!uat && !checkCatalogue)) return;
  let tracks = UAT_TRACKS;
  if (!uat) {
    const result = await catalogue(ctx);
    tracks = (Array.isArray(result) ? result : result.tracks).map((track: any) => ({
      code: track?.code,
      credits: Array.isArray(track?.credits) ? track.credits.map((credit: any) => credit?.code) : [],
    }));
  }
  for (const { track, credits } of payload.items) {
    const available = tracks.find((item) => item.code === track);
    const invalid = credits.filter((credit) => !available?.credits.includes(credit));
    if (invalid.length)
      throw new LmsError(`LMS catalogue has no Credit ${invalid.join(', ')} on Track ${track}. Correct the package mapping.`, false, 'localvalidation');
  }
}

/** CRM orders reserve Credits even while payment or LMS processing is pending. */
export async function checkLmsCreditOverlap(repo: Repo, payload: Purchase, studentEmail = payload.student_email) {
  if (!payload.items.length) return;
  const hits = await repo.db.prepare(`
    SELECT DISTINCT held.track, held.credit
    FROM v_lms_order_credits held
    JOIN json_each(?) item ON held.track=json_extract(item.value, '$.track')
    JOIN json_each(json_extract(item.value, '$.credits')) credit ON credit.value=held.credit
    WHERE held.order_id<>? AND (held.student_id=? OR (held.student_email<>'' AND held.student_email=?))
    ORDER BY held.track, held.credit
  `).bind(JSON.stringify(payload.items), payload.reference, payload.student_id, studentEmailKey(studentEmail))
    .all<{ track: string; credit: string }>();
  if (hits.results.length) {
    const codes = hits.results.map(({ track, credit }) => `${track}/${credit}`);
    throw new LmsError(`Credits already purchased or reserved for this student: ${codes.join(', ')}. Select a package with different Credits.`, false, 'duplicatecredit');
  }
}

/** Validate LMS orders before taking payment. Return the package entitlements to save on new orders. */
export async function prepareLmsOrder(
  env: Env, repo: Repo, cfg: any, e: any, student: any, program: any, checkCatalogue = true,
): Promise<Pick<Purchase, 'items' | 'skillslabs'> | undefined> {
  const mapping = cfg.lms?.packages?.[e.prog]?.[e.pkg];
  if (!e.lmsAccess && !e.uatFlow && !mapping && (!cfg.integ?.lms?.on || (repo.isTest && env.INTEGRATION_MODE === 'mock'))) return;
  if (!student) throw new LmsError('Select a registered student before taking payment.');
  if (!e.lmsAccess && (!cfg.lms?.confirmed || !mapping))
    throw new LmsError('Confirm the exact package and branch codes in LMS Integration before taking payment.');
  const payload = lmsEnrolPayload(e, student, program, cfg.lms);
  const missing = lmsPayloadProblems(payload, e, student);
  if (missing.length) throw new LmsError('Complete the LMS purchase details before taking payment: ' + missing.join(', '));
  await checkLmsCreditOverlap(repo, payload);
  const isTest = repo.isTest || !!e.test;
  await validateLmsCodes({ env, mode: modeFor(env, cfg, 'lms', isTest), isTest }, payload, checkCatalogue || !e.lmsAccess);
  return { items: payload.items, skillslabs: payload.skillslabs };
}

/** Only orders created by the new workflow are eligible; historical records are never backfilled. */
export async function activatePaidLms(repo: Repo, e: any): Promise<string[]> {
  if (e.lmsContract !== LMS_CONTRACT || e.status === 'Withdrawn' || e.payStatus !== 'Paid') return [];
  const calls = await repo.many<any>('moodle_sync', 'ref1=?', [e.id]);
  const ids: string[] = [];
  for (const m of calls) {
    if (m.op === 'cancel' || m.status !== 'Awaiting Payment') continue;
    const at = nowIso();
    const claim = await repo.db
      .prepare(
        "UPDATE docs SET status='Pending', data=json_insert(json_set(data,'$.status','Pending','$.last',?),'$.hist[#]',json(?)) WHERE type='moodle_sync' AND id=? AND status='Awaiting Payment'",
      )
      .bind(at, JSON.stringify({ at, s: 'Pending', msg: 'Order fully paid; purchase queued for LMS' }), m.id)
      .run();
    if (claim.meta.changes) ids.push(m.id);
  }
  return ids;
}
