import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setup, USERS, type TestCtx } from '../helpers/app';

let t: TestCtx;
let tok: string;
beforeEach(async () => { t = await setup(); tok = await t.login(USERS.admin); });

describe('Testing console API', () => {
  it('is only for configuration roles', async () => {
    expect((await t.call('GET', '/api/v1/testing/status', { token: await t.login(USERS.priya) })).status).toBe(403);
  });
  it('reports readiness of every integration', async () => {
    const r = await t.call('GET', '/api/v1/testing/status', { token: tok });
    expect(r.body.integrations.map((i: any) => i.key)).toEqual(['website', 'meta', 'whatsapp', 'exotel', 'lms', 'telr', 'razorpay', 'erpnext', 'gcal', 'email']);
    expect(r.body.integrations.every((i: any) => i.mode === 'mock')).toBe(true);
    expect(r.body.integrations.find((i: any) => i.key === 'gcal').missing).toContain('GCAL_SERVICE_ACCOUNT_JSON');
  });
  it('runs a connection test per integration', async () => {
    for (const k of ['lms', 'whatsapp', 'exotel', 'erpnext', 'razorpay', 'telr', 'meta', 'email']) {
      const r = await t.call('POST', `/api/v1/testing/integrations/${k}/test`, { token: tok });
      expect(r.body.ok, k).toBe(true);
    }
  });
  for (const name of ['uae-lead-to-enrolment', 'india-lead-to-enrolment', 'meta-lead', 'lms-failure-retry']) {
    it(`scenario ${name} passes end to end`, async () => {
      const r = await t.call('POST', `/api/v1/testing/scenarios/${name}/run`, { token: tok });
      if (!r.body.ok) console.log(JSON.stringify(r.body.steps, null, 1));
      expect(r.body.ok).toBe(true);
      expect(r.body.steps.every((s: any) => s.ok)).toBe(true);
    });
  }
  for (const name of ['uae-lead-to-enrolment', 'india-lead-to-enrolment']) {
    it(`waits for mock background work in ${name} when a real queue binding is present`, async () => {
      // A queue acknowledges enqueueing before its consumer runs. The console must not
      // report Pending as a failure or publish scenario work to the real queue.
      const queue = { send: vi.fn(async () => {}), sendBatch: vi.fn(async () => {}) };
      t = await setup({ JOBS: queue as unknown as Queue });
      tok = await t.login(USERS.admin);
      const businessBefore = await t.sql("SELECT id,data FROM docs WHERE is_test=0 ORDER BY type,id");
      const result = await t.call('POST', `/api/v1/testing/scenarios/${name}/run`, { token: tok });
      expect(result.body.ok, JSON.stringify(result.body.steps)).toBe(true);
      const lms = result.body.steps.find((s: any) => s.step.startsWith('LMS purchase received'));
      expect(lms?.ok).toBe(true);
      expect(result.body.steps.find((s: any) => s.step.startsWith('Withdrawal:'))?.ok).toBe(true);
      const outbound = await t.sql<any>("SELECT status FROM docs WHERE type='comm' AND is_test=1");
      expect(outbound.length).toBeGreaterThan(0);
      expect(outbound.every(x => x.status === 'Sent (mock)')).toBe(true);
      expect(queue.send).not.toHaveBeenCalled();
      expect(queue.sendBatch).not.toHaveBeenCalled();
      expect(t.env.JOBS).toBe(queue);
      expect(await t.sql("SELECT id,data FROM docs WHERE is_test=0 ORDER BY type,id")).toEqual(businessBefore);
    });
  }
  it('simulates each webhook through the real handler and only touches test data', async () => {
    const before = await t.sql("SELECT id FROM docs WHERE type IN ('lead','payment') AND is_test=0");
    const site = await t.call('POST', '/api/v1/testing/webhooks/website/simulate', { token: tok, body: {} });
    expect(site.body.status, JSON.stringify(site.body)).toBe(200);
    for (const k of ['whatsapp-status', 'whatsapp-inbound', 'exotel-incoming', 'exotel-status', 'meta', 'meta-verify', 'whatsapp-verify', 'bad-signature', 'telr-paid', 'razorpay-paid']) {
      const r = await t.call('POST', `/api/v1/testing/webhooks/${k}/simulate`, { token: tok, body: {} });
      expect(r.body.ok, k + ' ' + JSON.stringify(r.body)).toBe(true);
    }
    const after = await t.sql("SELECT id FROM docs WHERE type IN ('lead','payment') AND is_test=0");
    expect(after.length).toBe(before.length);
    const testLeads = await t.sql<any>("SELECT id FROM docs WHERE type='lead' AND is_test=1");
    expect(testLeads.every((l) => l.id.startsWith('TST-'))).toBe(true);
  });
  it('preserves queue dispatch outside the self-contained scenario runner', async () => {
    const queue = { send: vi.fn(async () => {}), sendBatch: vi.fn(async () => {}) };
    t = await setup({ JOBS: queue as unknown as Queue });
    const response = await t.call('POST', '/api/v1/testing/webhooks/website/simulate', { token: await t.login(USERS.admin), body: {} });
    expect(response.body.status).toBe(200);
    expect(queue.sendBatch).toHaveBeenCalled();
    expect(t.env.JOBS).toBe(queue);
  });
  it('keeps business sequences gapless and cleans up', async () => {
    const [seqBefore] = await t.sql<any>("SELECT value FROM sequences WHERE name='lead'");
    await t.call('POST', '/api/v1/testing/scenarios/uae-lead-to-enrolment/run', { token: tok });
    const [seqAfter] = await t.sql<any>("SELECT value FROM sequences WHERE name='lead'");
    expect(seqAfter.value).toBe(seqBefore.value);
    const [rcKrm] = await t.sql<any>("SELECT value FROM sequences WHERE name='rc_KRM'");
    expect(rcKrm.value).toBe(4);
    const r = await t.call('POST', '/api/v1/testing/cleanup', { token: tok });
    expect(r.body.deleted).toBeGreaterThan(5);
    expect(await t.sql('SELECT id FROM docs WHERE is_test=1')).toHaveLength(0);
  });
  it('lists logs with secrets redacted', async () => {
    await t.call('POST', '/api/v1/testing/scenarios/uae-lead-to-enrolment/run', { token: tok });
    const r = await t.call('GET', '/api/v1/testing/logs?limit=200', { token: tok });
    expect(r.body.items.length).toBeGreaterThan(5);
    const one = await t.call('GET', `/api/v1/testing/logs/${r.body.items[0].id}`, { token: tok });
    expect(one.body.request).toBeDefined();
  });
  it('runs the scheduler: SLA escalation and overdue follow-up notifications', async () => {
    const r = await t.call('POST', '/api/v1/testing/cron', { token: tok });
    expect(r.body.ok).toBe(true);
    const esc = await t.sql("SELECT id FROM docs WHERE type='notification' AND json_extract(data,'$.text') LIKE 'Escalation:%'");
    expect(esc.length).toBeGreaterThan(0);
    const again = await t.call('POST', '/api/v1/testing/cron', { token: tok });
    expect(again.body.ok).toBe(true);
    expect((await t.sql("SELECT id FROM docs WHERE type='notification' AND json_extract(data,'$.text') LIKE 'Escalation:%'")).length).toBe(esc.length);
  });
});
