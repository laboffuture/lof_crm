import type { Env } from '../types';
import awFees from '../../config/aw-provisional-fees.json';

export const UAT_LMS_URL = 'https://uat.learning.laboffuture.com/local/lofplatform/crm_api.php';
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
  if (uatEnvironment(env) && cfg?.lms?.branchMap?.[UAT_BRANCH] === 'AW' && isAwProvisionalFee(fee, cfg)) return true;
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
    cfg?.lms?.branchMap?.[UAT_BRANCH] === 'AW'
  );
}

/** This exception can only deliver marked sandbox orders to the supplied UAT LMS. */
export function uatEnvironment(env: Env): boolean {
  return (
    ['development', 'staging', 'test'].includes(env.APP_ENV) &&
    env.EASEBUZZ_ENV === 'test' &&
    env.LMS_URL === UAT_LMS_URL
  );
}

export function isUatEnrollment(env: Env, e: any): boolean {
  return (
    uatEnvironment(env) && e?.test === true && e.uatFlow === UAT_FLOW && e.cur === 'INR' &&
    (e.branch === UAT_BRANCH || (e.branch === 'AW' && typeof e.sandboxSource === 'string' && !!e.sandboxSource))
  );
}
