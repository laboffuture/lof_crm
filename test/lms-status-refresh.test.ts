import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const call = <T extends object = Record<string, never>>(status = 'Pending', extra = {} as T) => ({
  id: 'MS-PAYMENT',
  enr: 'EN-TEST',
  stu: 'STUDENT-TEST',
  status,
  attempts: 0,
  err: '',
  ...extra,
});

function browser(server = {}, role = 'System Administrator') {
  const req = vi.fn();
  const render = vi.fn();
  const toast = vi.fn();
  const state = () => ({
    user: 'ADMIN',
    route: { page: 'integration' },
    modal: null,
    leads: [],
    ms: [call('Awaiting Payment')],
    pay: [],
    enr: [{ id: 'EN-TEST', paid: 0 }],
    students: [],
    staff: [{ id: 'ADMIN', role }],
  });
  const debugConsole = { group: vi.fn(), log: vi.fn(), groupEnd: vi.fn() };
  const ctx = createContext({
    S: state(),
    S_sel: {},
    seed: state,
    COLL: { leads: 1, ms: 1, pay: 1, enr: 1, students: 1, staff: 1 },
    SETTINGS: [],
    SERVER: server,
    console: debugConsole,
    LS: { get: () => null },
    ACT: {},
    SUB: {},
    MODALS: {},
    PAGES: {},
    document: { addEventListener: vi.fn(), activeElement: null },
    req,
    applyRemaps: vi.fn(),
    render,
    toast,
    timers: [],
    TODAY: '2026-11-12',
    loginScreen: vi.fn(),
    makeSeq: (seq: unknown) => seq,
    setTimeout,
    clearTimeout,
    clearInterval,
    addEventListener: vi.fn(),
  });
  ctx.window = ctx;
  for (const file of ['sync.js', 'load.js', 'sign-in.js', 'live/simulators.js']) {
    runInContext(readFileSync(new URL('../frontend/src/api/' + file, import.meta.url), 'utf8'), ctx);
  }
  ctx.takeSnap();
  // Keep the save indicator out of these tests; exercise the real sync merge and renderer guard.
  ctx.setSaving = vi.fn();
  ctx.loginScreen = vi.fn();
  const merge = (doc: ReturnType<typeof call> & Record<string, unknown>) => ctx.mergeDocs([{ coll: 'ms', doc }]);
  const bootstrap = (doc: ReturnType<typeof call>, keepUi = true) =>
    ctx.applyBootstrap({ server, me: { id: 'ADMIN' }, data: { ...state(), ms: [doc] }, seq: {} }, keepUi);
  return { ctx, req, render, toast, merge, bootstrap, debugConsole };
}

describe('LMS status refresh', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps request and response payloads out of the console during refresh and delivery', async () => {
    const b = browser({ env: 'development', integrations: { lms: 'live' } });
    const delivered = call('Success', {
      deliveryMode: 'live',
      payload: { reference: 'EN-TEST', student_email: 'private.student@example.com' },
      response: { accepted: true, inboxid: 5, warnings: [] },
    });
    b.bootstrap(delivered);
    b.req.mockResolvedValue(delivered);
    b.merge(call());
    await vi.advanceTimersByTimeAsync(1500);
    expect(b.ctx.S.ms[0].status).toBe('Success');
    b.merge(call('Failed', { err: 'No answer from LMS' }));
    expect(b.debugConsole.group).not.toHaveBeenCalled();
    expect(b.debugConsole.log).not.toHaveBeenCalled();
    expect(b.debugConsole.groupEnd).not.toHaveBeenCalled();
  });

  it('follows a purchase activated by a later payment and updates the saved snapshot without reloading', async () => {
    const b = browser();
    b.ctx.S.pay.push({ id: 'PAY-TEST', amt: 100 });
    b.req.mockImplementation((method: string, path: string) => {
      if (method === 'PUT' && path === '/sync') {
        return Promise.resolve({ docs: [{ coll: 'ms', doc: call() }] });
      }
      return Promise.resolve(call('Success', { deliveryMode: 'mock' }));
    });

    await b.ctx.flush();
    await vi.advanceTimersByTimeAsync(1500);

    expect(b.ctx.S.ms[0].status).toBe('Success');
    expect(b.render).toHaveBeenCalledTimes(2); // saved payment, then completed LMS job
    expect(b.toast).toHaveBeenCalledWith('LMS enrol received for EN-TEST (mock)', 'ok');
    expect(b.ctx.diff(true).changes).toHaveLength(0);
    expect(b.req.mock.calls.map(([method, path]) => [method, path])).toEqual([
      ['PUT', '/sync'],
      ['GET', '/lms/calls/MS-PAYMENT'],
    ]);
    await vi.advanceTimersByTimeAsync(10000);
    expect(b.req).toHaveBeenCalledTimes(2);
  });

  it('does not poll unpaid orders and resumes existing queued work loaded from the server', async () => {
    const b = browser();
    b.merge(call('Awaiting Payment'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(b.req).not.toHaveBeenCalled();

    b.req.mockResolvedValue(call('Success'));
    b.bootstrap(call());
    await vi.advanceTimersByTimeAsync(1500);
    expect(b.ctx.S.ms[0].status).toBe('Success');
    expect(b.render).toHaveBeenCalledOnce();
  });

  it('shares one watcher and renders Processing before Success', async () => {
    const b = browser();
    b.req.mockResolvedValueOnce(call('Processing')).mockResolvedValue(call('Success'));
    b.merge(call());
    b.merge(call());
    b.ctx.runSync('MS-PAYMENT');
    // runSync also requests a normal save; nothing has changed in the snapshot.
    await vi.advanceTimersByTimeAsync(1500);
    expect(b.req).toHaveBeenCalledOnce();
    expect(b.ctx.S.ms[0].status).toBe('Processing');
    await vi.advanceTimersByTimeAsync(2000);
    expect(b.req).toHaveBeenCalledTimes(2);
    expect(b.ctx.S.ms[0].status).toBe('Success');
    expect(b.toast).toHaveBeenCalledOnce();
  });

  it('preserves an open receipt or form while storing the completed status', async () => {
    const b = browser();
    b.ctx.S.modal = { t: 'receipt' };
    b.req.mockResolvedValue(call('Success'));
    b.merge(call());
    await vi.advanceTimersByTimeAsync(1500);
    expect(b.ctx.S.ms[0].status).toBe('Success');
    expect(b.ctx.S.modal.t).toBe('receipt');
    expect(b.render).not.toHaveBeenCalled();
    expect(b.ctx.deferredRender).toBe(true);

    b.ctx.S.modal = null;
    b.ctx.document.activeElement = { tagName: 'INPUT', id: 'payment-reference' };
    b.ctx.safeRender();
    expect(b.render).not.toHaveBeenCalled();
    b.ctx.document.activeElement = null;
    b.ctx.safeRender();
    expect(b.render).toHaveBeenCalledOnce();
  });

  it.each([
    ['Warnings', 'warn'],
    ['Failed', 'err'],
    ['Awaiting Setup', 'warn'],
  ])('renders %s and stops without retrying the purchase', async (status, tone) => {
    const b = browser();
    b.req.mockResolvedValue(call(status, { err: 'Review required' }));
    b.merge(call());
    await vi.advanceTimersByTimeAsync(15000);
    expect(b.ctx.S.ms[0].status).toBe(status);
    expect(b.req).toHaveBeenCalledOnce();
    expect(b.render).toHaveBeenCalledOnce();
    expect(b.toast).toHaveBeenCalledWith(expect.stringContaining('Review required'), tone);
  });

  it('bounds network retries and lets the normal background refresh resume long jobs', async () => {
    const b = browser();
    b.req.mockRejectedValue(new Error('Network unavailable'));
    b.merge(call());
    await vi.advanceTimersByTimeAsync(60000);
    expect(b.req).toHaveBeenCalledTimes(16);
    expect(b.ctx.S.ms[0].status).toBe('Pending');
    expect(b.toast).not.toHaveBeenCalled();

    b.req.mockResolvedValue(call('Success'));
    b.bootstrap(call());
    await vi.advanceTimersByTimeAsync(1500);
    expect(b.ctx.S.ms[0].status).toBe('Success');
  });

  it('stops on permission errors instead of continually polling', async () => {
    const b = browser();
    b.req.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));
    b.merge(call());
    await vi.advanceTimersByTimeAsync(15000);
    expect(b.req).toHaveBeenCalledOnce();
  });

  it('acknowledges a manual retry completed in the server response without a duplicate watcher', async () => {
    const b = browser();
    b.merge(call('Failed'));
    b.req.mockResolvedValue(call('Success'));
    b.ctx.runSync('MS-PAYMENT');
    await vi.advanceTimersByTimeAsync(10000);
    expect(b.ctx.S.ms[0].status).toBe('Success');
    expect(b.req).toHaveBeenCalledExactlyOnceWith('POST', '/lms/calls/MS-PAYMENT/retry');
    expect(b.toast).toHaveBeenCalledOnce();
  });

  it('discards responses from a signed-out session, including a subsequent login by the same user', async () => {
    const b = browser();
    let complete!: (value: ReturnType<typeof call>) => void;
    b.req.mockReturnValue(new Promise((resolve) => (complete = resolve)));
    b.merge(call());
    await vi.advanceTimersByTimeAsync(1500);
    b.ctx.signOut();
    b.bootstrap(call('Awaiting Payment'), false);
    complete(call('Success'));
    await vi.advanceTimersByTimeAsync(10000);
    expect(b.ctx.S.ms[0].status).toBe('Awaiting Payment');
    expect(b.render).not.toHaveBeenCalled();
    expect(b.toast).not.toHaveBeenCalled();
    expect(b.req).toHaveBeenCalledOnce();
  });

  it('ignores a stale poll after another server refresh has completed the call', async () => {
    const b = browser();
    let complete!: (value: ReturnType<typeof call>) => void;
    b.req.mockReturnValue(new Promise((resolve) => (complete = resolve)));
    b.merge(call());
    await vi.advanceTimersByTimeAsync(1500);
    b.merge(call('Success'));
    complete(call('Processing'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(b.ctx.S.ms[0].status).toBe('Success');
    expect(b.req).toHaveBeenCalledOnce();
  });
});
