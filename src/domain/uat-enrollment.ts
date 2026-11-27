import type { Env } from '../types';
import { HttpError } from '../types';
import { Repo, nowIso } from '../lib/db';
import { indexFor } from '../lib/indexing';
import { modeFor } from '../integrations/base';
import { lmsMissing, validLmsDate } from './terms';
import { checkLmsCreditOverlap, LMS_CONTRACT, studentEmailKey, validateLmsCodes } from './lms-orders';
import { UAT_BRANCH, UAT_FLOW, isUatEnrollment, uatEnvironment } from './uat-policy';

export const UAT_PACKAGES = [
  { id: 'foundation-credit1', name: 'Falcon Foundation + Credit 1', credits: ['F2', 'FC1'], validUntil: '2027-03-31' },
  { id: 'credits3-4', name: 'Falcon Credits 3 and 4', credits: ['FC3', 'FC4'], validUntil: '2027-06-30' },
  { id: 'foundation', name: 'Falcon Foundation', credits: ['F2'], validUntil: '2027-03-31' },
  {
    id: 'foundation-credits1-2',
    name: 'Falcon Foundation + Credits 1 and 2',
    credits: ['F2', 'FC1', 'FC2'],
    validUntil: '2027-09-30',
  },
  { id: 'credit1', name: 'Falcon Credit 1', credits: ['FC1'], validUntil: '2027-03-31' },
  { id: 'credit2', name: 'Falcon Credit 2 — additional purchase', credits: ['FC2'], validUntil: '2027-06-30' },
];
const PROGRAM = 'TST-FALCON';
const text = (v: unknown, max = 160) =>
  String(v ?? '')
    .trim()
    .slice(0, max);

export async function assertUatReady(env: Env, repo: Repo) {
  if (!uatEnvironment(env))
    throw new HttpError(
      409,
      'Full-flow UAT requires a non-production CRM, Easebuzz test mode and the exact supplied UAT LMS endpoint.',
    );
  const cfg = await repo.setting<any>('cfg');
  if (
    modeFor(env, cfg, 'easebuzz') !== 'live' ||
    modeFor(env, cfg, 'lms') !== 'live'
  )
    throw new HttpError(
      409,
      'Enable Easebuzz and LMS, configure their server credentials, and use INTEGRATION_MODE=auto.',
    );
}

/** The price is a sandbox fixture, never a client fee or a modification to business pricing. */
export async function createUatEnrollment(env: Env, repo: Repo, input: any) {
  await assertUatReady(env, repo);
  if (!/^[a-f0-9]{32}$/.test(input.requestId || '')) throw new HttpError(400, 'A valid test request ID is required.');
  const pkg = UAT_PACKAGES.find((p) => p.id === input.packageId);
  if (!pkg) throw new HttpError(400, 'Select a supplied UAT package.');
  const validUntil = text(input.validUntil, 10);
  if (!validLmsDate(validUntil) || validUntil < nowIso().slice(0, 10))
    throw new HttpError(400, 'Choose a valid future access end date.');
  if (!['new', 'existing'].includes(input.mode)) throw new HttpError(400, 'Choose new or existing student.');
  const fields = input.student || {};
  const normalized = {
    mode: input.mode,
    studentId: text(input.studentId, 64),
    packageId: pkg.id,
    validUntil,
    student:
      input.mode === 'new'
        ? Object.fromEntries(
            ['first', 'last', 'email', 'mobile', 'dob', 'parentName', 'parentEmail', 'parentPhone'].map((k) => [
              k,
              text(fields[k]),
            ]),
          )
        : null,
  };
  const fingerprint = JSON.stringify(normalized);
  const enrollmentId = 'TST-UAT-EN-' + input.requestId;
  const prior = await repo.get<any>('enrollment', enrollmentId);
  if (prior) {
    if (!isUatEnrollment(env, prior) || prior.uatRequest !== fingerprint)
      throw new HttpError(409, 'This test request ID was already used for different details.');
    return { enrollmentId: prior.id, studentId: prior.stu, repeated: true };
  }
  let student: any;
  if (input.mode === 'existing') {
    student = await repo.get<any>('student', normalized.studentId);
    if (!student?.test || student.uatFlow !== UAT_FLOW || student.branch !== UAT_BRANCH)
      throw new HttpError(400, 'Select a student created by this full-flow UAT screen.');
  } else {
    const d: any = normalized.student;
    if (!d.parentName || !d.parentEmail || !d.parentPhone)
      throw new HttpError(400, 'Parent name, email and phone are required for this UAT flow.');
    const existing = await repo.many<any>('student', "lower(trim(json_extract(data,'$.email')))=?", [studentEmailKey(d.email)]);
    if (existing.length)
      throw new HttpError(
        409,
        'This student email already exists. Select the existing UAT student or use a fresh email.',
      );
    student = {
      id: repo.testId('student'),
      first: d.first,
      last: d.last,
      email: d.email,
      mobile: d.mobile,
      dob: d.dob,
      fam: repo.testId('family'),
      branch: UAT_BRANCH,
      reg: nowIso().slice(0, 10),
      status: 'Active',
      parents: [{ name: d.parentName, email: d.parentEmail, mobile: d.parentPhone, rel: 'Legal Guardian', job: '' }],
      gender: 'Other',
      nat: '',
      school: '',
      grade: '',
      curr: '',
      address: '',
      moodle: null,
      interests: [],
      docs: [],
      comm: [],
      photoConsent: 'Not provided',
      testimonials: [],
      test: true,
      uatFlow: UAT_FLOW,
    };
  }
  const parent = student.parents[0];
  const payload = {
    reference: enrollmentId,
    student_id: student.id,
    student_first_name: student.first,
    student_last_name: student.last,
    student_email: student.email,
    student_phone: student.mobile,
    student_dob: student.dob,
    branch: 'AW',
    valid_until: validUntil,
    parent_id: student.fam,
    parent_name: parent.name,
    parent_email: parent.email,
    parent_phone: parent.mobile,
    items: [{ track: 'FT', credits: [...pkg.credits], product_name: pkg.name }],
    skillslabs: [],
  };
  const missing = lmsMissing(payload);
  if (missing.length) throw new HttpError(400, 'Correct the student details: ' + missing.join(', '));
  try {
    await checkLmsCreditOverlap(repo, payload);
    await validateLmsCodes({ env, mode: 'live', isTest: true }, payload);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    throw new HttpError(409, error.message);
  }
  const branch = await repo.get<any>('branch', UAT_BRANCH);
  if (branch && (!branch.test || branch.cur !== 'INR'))
    throw new HttpError(409, 'The reserved UAT branch conflicts with a business branch.');
  if (!branch)
    await repo.put('branch', {
      id: UAT_BRANCH,
      name: 'Andheri West',
      code: 'AW',
      city: 'Mumbai',
      country: 'India',
      cur: 'INR',
      status: 'Operating',
      programs: [],
      test: true,
    });
  if (!(await repo.get('program', PROGRAM)))
    await repo.put('program', {
      id: PROGRAM,
      name: 'Falcon',
      code: 'FT',
      cat: 'STEM',
      desc: 'Client UAT packages; sandbox fee only',
      active: true,
      credits: 5,
      options: [],
      courses: [],
      branches: [],
      test: true,
    });
  const syncId = repo.testId('ms');
  const date = nowIso().slice(0, 10);
  const order = {
    id: enrollmentId,
    stu: student.id,
    branch: UAT_BRANCH,
    prog: PROGRAM,
    pkg: pkg.name,
    date,
    status: 'Active',
    cur: 'INR',
    fee: 1,
    reg: 0,
    disc: 0,
    tax: 0,
    total: 1,
    taxPct: 0,
    discInfo: null,
    paid: 0,
    payStatus: 'Unpaid',
    term: 'PT1',
    sched: [{ n: 1, pct: 100, amt: 1, due: date }],
    opp: null,
    newStu: input.mode === 'new',
    sessions: 0,
    credits: pkg.credits.length,
    course: { name: pkg.name, moodleId: 0 },
    ms: syncId,
    test: true,
    uatFlow: UAT_FLOW,
    uatRequest: fingerprint,
    lmsContract: LMS_CONTRACT,
    lmsAccess: { items: payload.items, skillslabs: payload.skillslabs },
  };
  const sync = {
    id: syncId,
    enr: order.id,
    stu: student.id,
    op: 'enrol',
    status: 'Awaiting Payment',
    contract: LMS_CONTRACT,
    payload,
    course: pkg.name,
    cid: 'FT',
    credits: pkg.credits,
    mode: 'enrol',
    attempts: 0,
    last: nowIso(),
    err: '',
    hist: [
      {
        at: nowIso(),
        s: 'Awaiting Payment',
        msg: 'Waiting for verified INR 1 Easebuzz sandbox payment; no client pricing supplied.',
      },
    ],
    test: true,
  };
  const entries = [
    ...(input.mode === 'new' ? [{ type: 'student', doc: student }] : []),
    { type: 'enrollment', doc: order },
    { type: 'moodle_sync', doc: sync },
  ];
  const stmts = entries.map(({ type, doc }) => {
    const idx = indexFor(type, doc, () => UAT_BRANCH);
    return repo.db
      .prepare(
        'INSERT INTO docs (type,id,branch,status,owner,ref1,ref2,at,data,is_test,updated_by) VALUES (?,?,?,?,?,?,?,?,?,1,?)',
      )
      .bind(
        type,
        doc.id,
        idx.branch,
        idx.status,
        idx.owner,
        idx.ref1,
        idx.ref2,
        idx.at,
        JSON.stringify(doc),
        repo.actor,
      );
  });
  try {
    await repo.db.batch(stmts);
  } catch (err) {
    const duplicate = await repo.get<any>('enrollment', enrollmentId);
    if (!duplicate && /duplicate LMS credit|duplicate student email/.test(String(err))) {
      throw new HttpError(409, 'The student email or one of the requested Credits is already in use. Review the student and package.');
    }
    if (!duplicate || duplicate.uatRequest !== fingerprint) throw err;
    return { enrollmentId, studentId: duplicate.stu, repeated: true };
  }
  return { enrollmentId, studentId: student.id, repeated: false };
}

export async function uatState(env: Env, repo: Repo) {
  if (!uatEnvironment(env))
    throw new HttpError(
      409,
      'Full-flow UAT is available only with the supplied UAT LMS and Easebuzz sandbox outside production.',
    );
  const cfg = await repo.setting<any>('cfg');
  const students = await repo.many<any>('student', "is_test=1 AND json_extract(data,'$.uatFlow')=?", [UAT_FLOW]);
  const orders = await repo.many<any>(
    'enrollment',
    "is_test=1 AND json_extract(data,'$.uatFlow')=?",
    [UAT_FLOW],
    'created_at DESC, rowid DESC LIMIT 30',
  );
  return {
    ready:
        modeFor(env, cfg, 'easebuzz') === 'live' &&
      modeFor(env, cfg, 'lms') === 'live',
    branch: 'Andheri West (AW)',
    currency: 'INR',
    testAmount: 1,
    packages: UAT_PACKAGES,
    students: students.map((s) => ({ id: s.id, name: s.first + ' ' + s.last, email: s.email })),
    orders: await Promise.all(
      orders.map(async (e) => {
        const sync = await repo.get<any>('moodle_sync', e.ms);
        const payments = await repo.many<any>('payment', 'ref1=?', [e.id]);
        return {
          id: e.id,
          studentId: e.stu,
          package: e.pkg,
          payStatus: e.payStatus,
          paid: e.paid,
          total: e.total,
          validUntil: sync?.payload?.valid_until,
          syncId: e.ms,
          lmsStatus: sync?.status,
          deliveryMode: sync?.deliveryMode,
          inboxId: sync?.response?.inboxid,
          error: sync?.err,
          receipts: payments.map((p) => ({ id: p.id, number: p.rc })),
        };
      }),
    ),
  };
}
