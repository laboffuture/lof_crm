import { afterEach, expect, it, vi } from 'vitest';
import { calcFee, dayKey } from '../../src/domain/core';
import { UAT_FLOW, UAT_LMS_URL } from '../../src/domain/uat-policy';
import { easebuzzResponseHash } from '../../src/integrations/easebuzz';
import { Repo } from '../../src/lib/db';
import { doc, setup, stubFetch, USERS } from '../helpers/app';

afterEach(() => vi.unstubAllGlobals());

it.each([
  { name: 'default LOF endpoint', endpoint: UAT_LMS_URL, allowlisted: undefined, lmsBranch: 'AW' },
  { name: 'configured UAT endpoint', endpoint: 'https://alternate.lms.test/crm_api.php', allowlisted: 'https://alternate.lms.test/crm_api.php', lmsBranch: 'TEST-CENTRE' },
])('settles the selected CRM enrolment once using database mappings at the $name', async ({ endpoint, allowlisted, lmsBranch }) => {
  const t = await setup({
    INTEGRATION_MODE: 'auto', EASEBUZZ_ENV: 'test', LMS_URL: endpoint, LMS_UAT_URL: allowlisted,
    EASEBUZZ_KEY: 'fixture-key', EASEBUZZ_SALT: 'fixture-salt',
  });
  const repo = new Repo(t.env.DB);
  const branch = { ...await doc(t, 'branch', 'BLR'), id: 'MUM-01', name: 'Mumbai Test Centre', cur: 'INR' };
  await repo.put('branch', branch);
  const today = dayKey(new Date());
  const fee = {
    id: 'FEE-UAT-REGRESSION', branch: branch.id, prog: branch.programs[0], pkg: 'Test checkout package', cur: 'INR',
    amt: 100, tax: 0, extra: { amt: 0 }, from: today, active: true,
  };
  await repo.put('fee', fee);
  await t.setCfg((cfg) => {
    cfg.integ.pay.on = true;
    cfg.integ.lms.on = true;
    cfg.lms.confirmed = true;
    cfg.lms.packages = { [fee.prog]: { [fee.pkg]: { track: 'TEST-TRACK', credits: ['TEST-CREDIT'] } } };
  });
  const student = {
    id: 'LOF-26-000801', first: 'UAT', last: 'Learner', dob: '2014-02-02', branch: branch.id, status: 'Active',
    email: 'uat.student@example.com', fam: 'FAM-26-0801',
    parents: [{ name: 'UAT Parent', email: 'uat.parent@example.com', mobile: '+919876543210' }],
  };
  await repo.create('student', student);
  const enrollment = {
    id: 'EN-26-0801', stu: student.id, branch: branch.id, prog: fee.prog, pkg: fee.pkg, date: today,
    term: 'PT1', total: calcFee(fee, null, false, branch).total, sandboxCheckout: true,
  };
  const changes = [{ coll: 'enr', id: enrollment.id, op: 'upsert', doc: enrollment }];
  const token = await t.login(USERS.admin);
  const register = () => t.call('PUT', '/api/v1/sync', { token, body: { changes } });
  expect((await register()).status).toBe(409);
  await t.setCfg((cfg) => { cfg.lms.branchMap[branch.id] = lmsBranch; });
  t.env.EASEBUZZ_ENV = 'prod';
  expect((await register()).status).toBe(409);
  expect(await doc(t, 'enrollment', enrollment.id)).toBeNull();
  t.env.EASEBUZZ_ENV = 'test';
  Object.assign(changes[0], { doc: { ...enrollment, sandboxCheckout: undefined } });
  const bootstrap = await t.call('GET', '/api/v1/bootstrap', { token });
  expect(bootstrap.body.server.payments.uatCheckoutBranches).toContain(branch.id);

  const lmsRequests: any[] = [];
  const lmsUrl = new RegExp('^' + endpoint.replaceAll('.', '\\.') + '$');
  const { calls } = stubFetch([
    [/^https:\/\/testpay\.easebuzz\.in\/payment\/initiateLink$/, () => ({ json: { status: 1, data: 'fixture-checkout' } })],
    [/^https:\/\/testdashboard\.easebuzz\.in\/transaction\/v2\/retrieve$/, ({ body }) => ({ json: {
      status: true, msg: [{ txnid: new URLSearchParams(body).get('txnid'), status: 'success',
        amount: enrollment.total.toFixed(2), currency: 'INR', easepayid: 'fixture-payment', mode: 'UPI' }],
    } })],
    [lmsUrl, ({ body }) => {
      const request = JSON.parse(body);
      if (request.wsfunction === 'local_lofplatform_erp_catalogue') {
        return { json: { tracks: [{ code: 'TEST-TRACK', credits: [{ code: 'TEST-CREDIT' }] }] } };
      }
      lmsRequests.push(request);
      return { json: { accepted: true, inboxid: 123, warnings: [] } };
    }],
  ]);
  const registered = await register();
  expect(registered.status, registered.text).toBe(200);
  const order = await doc(t, 'enrollment', enrollment.id);
  expect(order).toMatchObject({ stu: student.id, paid: 0, payStatus: 'Unpaid', test: true, uatFlow: UAT_FLOW, uatCheckout: true });
  expect(order).not.toHaveProperty('sandboxSource');
  expect(order).not.toHaveProperty('sandboxCheckout');
  expect(await doc(t, 'moodle_sync', order.ms)).toMatchObject({ status: 'Awaiting Payment', test: true });
  const startCheckout = () => t.call('POST', '/api/v1/payments/links', { token, body: { enrollmentId: enrollment.id } });
  const link = await startCheckout();
  expect(link.status, link.text).toBe(201);
  expect(link.body).toMatchObject({ enrollmentId: enrollment.id, sandbox: true });
  expect((await startCheckout()).body.id).toBe(link.body.id);
  expect(lmsRequests).toHaveLength(0);
  expect(await repo.count('enrollment', 'ref1=?', [student.id])).toBe(1);

  const fields = { txnid: link.body.id, key: t.env.EASEBUZZ_KEY!, status: 'success', amount: enrollment.total.toFixed(2) };
  const hash = await easebuzzResponseHash(fields, t.env.EASEBUZZ_SALT!);
  const callback = () => t.call('POST', '/webhooks/easebuzz', {
    raw: new URLSearchParams({ ...fields, hash }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  expect((await callback()).status).toBe(200);
  expect((await callback()).status).toBe(200);
  expect(await doc(t, 'enrollment', enrollment.id)).toMatchObject({ paid: enrollment.total, payStatus: 'Paid' });
  expect(await repo.many('payment', 'ref1=?', [enrollment.id])).toEqual([expect.objectContaining({
    enr: enrollment.id, stu: student.id, test: true, rc: expect.stringMatching(/^RC-TEST-/),
    gateway: expect.objectContaining({ provider: 'easebuzz-test' }),
  })]);
  expect(lmsRequests).toEqual([expect.objectContaining({
    reference: enrollment.id, student_id: student.id, branch: lmsBranch,
    items: [expect.objectContaining({ track: 'TEST-TRACK', credits: ['TEST-CREDIT'] })],
  })]);
  expect(await doc(t, 'moodle_sync', order.ms)).toMatchObject({ status: 'Success', deliveryMode: 'live', response: { inboxid: 123 } });
  expect(await doc(t, 'student', student.id)).toEqual(student);
  expect(calls.filter(({ url }) => url !== endpoint && !/easebuzz\.in/.test(url))).toEqual([]);
});
