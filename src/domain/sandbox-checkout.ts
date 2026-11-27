import type { Env } from '../types';
import { Repo, nowIso } from '../lib/db';
import { toHex } from '../lib/crypto';
import { LMS_CONTRACT, prepareLmsOrder } from './lms-orders';
import { lmsEnrolPayload } from './terms';
import { UAT_FLOW, uatCheckoutBranches, uatEnvironment } from './uat-policy';
import { r2 } from './core';

const orderPrefix = 'TST-ENR-SANDBOX-';

/** Build the external sandbox identity in memory. The CRM student always belongs to the original order. */
export function sandboxIdentity(order: any) {
  const key = order.id.slice(orderPrefix.length);
  return {
    id: 'TST-STU-SANDBOX-' + key,
    first: 'Sandbox',
    last: 'Learner',
    email: 'sandbox.student.' + key + '@example.com',
    mobile: '+12025550131',
    dob: '2014-05-14',
    fam: 'TST-FAM-SANDBOX-' + key,
    parents: [{ name: 'Sandbox Parent', email: 'sandbox.parent.' + key + '@example.com', mobile: '+12025550132' }],
  };
}

/** Only the test balance and LMS call need separate records. */
export async function sandboxOrder(env: Env, repo: Repo, cfg: any, original: any) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(original.id));
  const key = toHex(digest).slice(0, 24);
  const id = orderPrefix + key;
  const getExisting = async () => {
    const existing = await repo.get<any>('enrollment', id);
    if (existing && (existing.test !== true || existing.sandboxSource !== original.id))
      throw new Error('The sandbox enrolment does not match the selected order');
    return existing;
  };
  const existing = await getExisting();
  if (existing) return existing;

  const at = nowIso();
  const order: any = {
    id, stu: original.stu, branch: original.branch, prog: original.prog, pkg: original.pkg,
    date: original.date, status: 'Active', cur: original.cur, fee: original.fee, reg: original.reg,
    disc: original.disc, tax: original.tax, taxPct: original.taxPct, total: r2(original.total - original.paid),
    paid: 0, payStatus: 'Unpaid', term: original.term, sched: original.sched,
    sessions: original.sessions, credits: original.credits, lmsValidUntil: original.lmsValidUntil,
    newStu: original.newStu, opp: null, test: true, sandboxSource: original.id,
  };
  const entries: D1PreparedStatement[] = [];
  const branch = uatEnvironment(env) ? await repo.get('branch', original.branch) : null;
  // A sandbox copy can reach only the allowlisted UAT LMS, using synthetic student details.
  if (branch && uatCheckoutBranches(env, cfg, [branch]).includes(original.branch) &&
      (original.lmsAccess || cfg.lms?.packages?.[original.prog]?.[original.pkg])) {
    const [program, fee] = await Promise.all([
      repo.get('program', original.prog),
      original.feeId ? repo.get<{ courseId?: string }>('fee', original.feeId) : null,
    ]);
    const identity = sandboxIdentity(order);
    order.uatFlow = UAT_FLOW;
    order.lmsContract = LMS_CONTRACT;
    order.lmsAccess = original.lmsAccess;
    order.lmsAccess = await prepareLmsOrder(env, repo, cfg, order, identity, program);
    order.ms = 'TST-MS-SANDBOX-' + key;
    const payload = lmsEnrolPayload(order, identity, program, cfg.lms, { programmeCode: program?.code, courseId: fee?.courseId });
    entries.push(await repo.createStmt('moodle_sync', {
      id: order.ms, enr: id, stu: original.stu, op: 'enrol', status: 'Awaiting Payment', test: true,
      payload, cid: payload.items[0]?.track, credits: payload.items.flatMap((item) => item.credits),
      course: original.pkg, attempts: 0, last: at,
      hist: [{ at, s: 'Awaiting Payment', msg: 'Waiting for verified Easebuzz sandbox payment' }],
    }, order.branch));
  }
  entries.push(await repo.createStmt('enrollment', order));
  try {
    await repo.db.batch(entries);
    return order;
  } catch (error) {
    const concurrent = await getExisting();
    if (!concurrent) throw error;
    return concurrent;
  }
}
