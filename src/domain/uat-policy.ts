import type { Env } from '../types';
import awFees from '../../config/aw-provisional-fees.json';
import { modeFor } from '../integrations/base';

export const UAT_LMS_URL = 'https://uat.learning.laboffuture.com/local/lofplatform/crm_api.php';
export const LOF_UAT_BRANCH_CODE = 'AW';
export const UAT_FLOW = 'AW-EASEBUZZ-UAT-v1';
export const UAT_BRANCH = 'TST-AW';
export const UAT_FEE_ID = 'TST-FEE-AW-ROB-001';

export function isAwProvisionalFee(fee: any, cfg: any): boolean {
  const pkg = awFees.packages.find((p) => (fee?.uatRootFeeId || fee?.id) === 'TST-AW-FEE-' + p.id);
  const mapping = cfg?.lms?.packages?.['TST-FALCON']?.[fee?.pkg];
  return (
    !!pkg &&
    fee?.uatFeeStructure === awFees.structure &&
    fee.test === true &&
    fee.active === true &&
    fee.branch === UAT_BRANCH &&
    fee.prog === 'TST-FALCON' &&
    fee.pkg === pkg.name &&
    fee.cur === 'INR' &&
    Number.isFinite(fee.amt) &&
    fee.amt > 0 &&
    fee.tax >= 0 &&
    fee.extra?.amt >= 0 &&
    fee.validUntil === pkg.validUntil &&
    mapping?.track === 'FT' &&
    JSON.stringify(mapping.credits) === JSON.stringify(pkg.credits)
  );
}

/** The explicitly installed local test fee may be used through the normal registration wizard. */
export function isUatTestFee(env: Env, fee: any, cfg: any): boolean {
  if (uatEnvironment(env) && cfg?.lms?.branchMap?.[UAT_BRANCH] === LOF_UAT_BRANCH_CODE && isAwProvisionalFee(fee, cfg)) return true;
  return (
    uatEnvironment(env) &&
    fee?.id === UAT_FEE_ID &&
    fee.test === true &&
    fee.active === true &&
    fee.branch === UAT_BRANCH &&
    fee.prog === 'ROB' &&
    fee.pkg === 'Term (24 sessions)' &&
    fee.cur === 'INR' &&
    fee.amt === 1 &&
    fee.tax === 0 &&
    fee.extra?.amt === 0 &&
    cfg?.lms?.branchMap?.[UAT_BRANCH] === LOF_UAT_BRANCH_CODE
  );
}

/** This exception can only deliver marked sandbox orders to the supplied UAT LMS. */
export function uatEnvironment(env: Env): boolean {
  const endpoint = env.LMS_UAT_URL?.trim() || UAT_LMS_URL;
  const url = URL.canParse(endpoint) ? new URL(endpoint) : null;
  return (
    ['development', 'staging', 'test'].includes(env.APP_ENV) &&
    env.EASEBUZZ_ENV === 'test' &&
    url?.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash &&
    env.LMS_URL?.trim() === endpoint
  );
}

export function isLofUatEndpoint(endpoint: string): boolean {
  return new URL(endpoint).origin === new URL(UAT_LMS_URL).origin;
}

export function uatCheckoutBranches(env: Env, cfg: any, branches: { id: string; status: string; cur: string }[]): string[] {
  if (!uatEnvironment(env) || modeFor(env, cfg, 'easebuzz') !== 'live' || modeFor(env, cfg, 'lms') !== 'live') return [];
  const lofUat = isLofUatEndpoint(env.LMS_URL!);
  return branches.filter(({ id, status, cur }) => {
    const mappedCode = cfg.lms?.branchMap?.[id];
    return status === 'Operating' && cur === 'INR' && typeof mappedCode === 'string' && !!mappedCode.trim() &&
      (!lofUat || mappedCode === LOF_UAT_BRANCH_CODE);
  }).map(({ id }) => id);
}

export function isUatEnrollment(env: Env, e: any): boolean {
  return (
    uatEnvironment(env) && e?.test === true && e.uatFlow === UAT_FLOW && e.cur === 'INR' &&
    (e.uatCheckout === true || e.branch === UAT_BRANCH || (typeof e.sandboxSource === 'string' && !!e.sandboxSource))
  );
}
