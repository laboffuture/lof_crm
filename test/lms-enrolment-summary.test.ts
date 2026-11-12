import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { lmsEnrolPayload } from '../src/domain/terms';

// Render the actual wizard with the shipped helpers and demo masters, without a browser or database.
function preview() {
  const ctx = createContext({
    document: { addEventListener() {} },
    localStorage: { getItem: () => null },
    addEventListener() {},
    setTimeout,
    clearTimeout,
    console,
    LOF_API: null,
  });
  ctx.window = ctx;
  const manifest = JSON.parse(readFileSync(new URL('../frontend/manifest.json', import.meta.url), 'utf8'));
  for (const file of manifest.app.filter((f: string) => !['config.js', 'boot.js'].includes(f))) {
    runInContext(readFileSync(new URL('../frontend/src/' + file, import.meta.url), 'utf8'), ctx);
  }
  const state = runInContext('S = seed(); TODAY = "2026-11-12"; S', ctx);
  const student = state.students[0];
  const programme = state.programs.find((p: any) => p.id === 'ROB');
  const fee = state.fees.find((f: any) => f.prog === 'ROB' && f.branch === 'KRM' && f.active);
  const order = { id: 'PREVIEW', stu: student.id, prog: 'ROB', pkg: fee.pkg, branch: 'KRM', date: '2026-11-12' };
  state.cfg.lms.packages = {};
  state.cfg.lms.confirmed = true;
  state.wiz = {
    mode: 'existing',
    step: 3,
    opp: null,
    stu: student.id,
    d: { prog: order.prog, pkg: order.pkg, branch: order.branch },
    fee,
    disc: null,
    term: 'PT1',
    calc: { prog: order.prog, br: order.branch },
  };
  const render = () => runInContext('PAGES.wizard({})', ctx) as string;
  const summary = () => render().split('<dt>LMS</dt><dd>')[1].split('</dd>')[0];
  const map = (mapping: any) => {
    state.cfg.lms.packages.ROB = { [order.pkg]: mapping };
  };
  const checkPayload = () => {
    const expected = lmsEnrolPayload(order, student, programme, state.cfg.lms);
    const actual = ctx.lmsPayload(order);
    expect(JSON.parse(JSON.stringify(actual))).toEqual(expected);
    return expected;
  };
  return { ctx, state, order, render, summary, map, checkPayload };
}

describe('enrolment LMS summary', () => {
  it('shows the purchased package instead of all Credits in the legacy programme mapping', () => {
    const p = preview();
    const legacyTrack = p.state.cfg.lms.programmes.ROB.track;
    p.map({ track: 'RT', credits: ['C1'] });
    expect(p.summary()).toContain('RT');
    expect(p.summary()).toContain('1 Credit');
    expect(p.summary()).toContain('C1');
    expect(p.summary()).not.toContain(legacyTrack);
    expect(p.checkPayload().items[0].credits).toEqual(['C1']);
  });

  it('uses the currently selected fee package, including when switching back to another package', () => {
    const p = preview();
    p.map({ track: 'RT', credits: ['C1'] });
    p.state.cfg.lms.packages.ROB['Other package'] = { track: 'FT', credits: ['FC1', 'FC2'] };
    p.state.wiz.fee = { ...p.state.wiz.fee, pkg: 'Other package' };
    expect(p.summary()).toContain('FT');
    expect(p.summary()).toContain('2 Credits');
    expect(p.summary()).not.toContain('>RT<');
    p.state.wiz.fee = { ...p.state.wiz.fee, pkg: p.order.pkg };
    expect(p.summary()).toContain('>RT<');
    expect(p.summary()).not.toContain('>FT<');
  });

  it('keeps older programme mappings readable and identifies the missing package setup', () => {
    const p = preview();
    delete p.state.cfg.lms.packages;
    const text = p.summary();
    expect(text).toContain('Legacy programme mapping');
    expect(text).toContain('before live delivery');
    expect(text).toContain(p.state.cfg.lms.programmes.ROB.track);
    expect(p.checkPayload().items).toHaveLength(1);
  });

  it('shows missing setup without crashing when no programme or package mapping exists', () => {
    const p = preview();
    delete p.state.cfg.lms.programmes;
    expect(p.summary()).toContain('LMS access is not mapped for this package');
    expect(p.render()).toContain('Complete enrolment');
    expect(p.checkPayload().items).toEqual([]);
  });

  it('does not replace an explicitly empty package mapping with programme-wide access', () => {
    const p = preview();
    p.map({});
    expect(p.summary()).toContain('LMS access is not mapped for this package');
    expect(p.summary()).not.toContain(p.state.cfg.lms.programmes.ROB.track);
    expect(p.checkPayload().items).toEqual([]);
  });

  it('shows every Track and Skills Lab line, with per-lab validity, matching the backend', () => {
    const p = preview();
    p.map({
      items: [
        { track: 'FT', credits: ['FC1', 'FC2'] },
        { track: 'RT', credits: ['C1'] },
      ],
      skillslabs: [
        { program: 'SL-TEST-A', sessions: 4, valid_until: '2027-02-28' },
        { program: 'SL-TEST-B', sessions: 1 },
      ],
    });
    const text = p.summary();
    for (const value of [
      'FT',
      'FC1, FC2',
      'RT',
      'C1',
      'SL-TEST-A',
      '4 sessions',
      '28 Feb 2027',
      'SL-TEST-B',
      '1 session',
    ])
      expect(text).toContain(value);
    expect(p.checkPayload().skillslabs).toHaveLength(2);
  });

  it('supports Skills Lab-only packages without implying any Track access', () => {
    const p = preview();
    p.map({ skillslabs: [{ program: 'SL-TEST', sessions: 2 }] });
    expect(p.summary()).toContain('SL-TEST');
    expect(p.summary()).toContain('2 sessions');
    expect(p.summary()).not.toContain('Track');
    expect(p.checkPayload().items).toEqual([]);
  });

  it('labels unconfirmed codes and works before a new student profile exists', () => {
    const p = preview();
    p.map({ track: 'RT', credits: ['C1'] });
    p.state.cfg.lms.confirmed = false;
    p.state.wiz.mode = 'new';
    p.state.wiz.stu = null;
    p.state.wiz.d.first = 'New';
    p.state.wiz.d.last = 'Student';
    expect(p.summary()).toContain('awaiting LOF confirmation');
    expect(p.summary()).toContain('>RT<');
    expect(p.render()).toContain('New Student Registration');
  });

  it('does not alter fees, payment inputs, students, existing records or settings', () => {
    const p = preview();
    const businessData = () =>
      JSON.stringify({
        cfg: p.state.cfg,
        students: p.state.students,
        enr: p.state.enr,
        ms: p.state.ms,
        pay: p.state.pay,
        fees: p.state.fees,
        programmes: p.state.programs,
      });
    const withoutSummary = (html: string) => html.replace(/<dt>LMS<\/dt><dd>[\s\S]*?<\/dd>/, '<dt>LMS</dt>');
    const originalPage = withoutSummary(p.render());
    p.map({ track: 'RT', credits: ['C1'] });
    const before = businessData();
    expect(withoutSummary(p.render())).toBe(originalPage);
    p.checkPayload();
    expect(businessData()).toBe(before);
  });

  it('retains the frozen payload of an existing purchase when current mappings change', () => {
    const p = preview();
    const frozen = p.ctx.lmsPayload(p.order);
    p.state.ms.push({ id: 'MS-FROZEN', enr: p.order.id, op: 'enrol', payload: frozen });
    p.map({ track: 'RT', credits: ['C1'] });
    expect(p.ctx.lmsPayload(p.order)).toEqual(frozen);
    expect(p.summary()).toContain('>RT<'); // this is the preview for a new enrolment
  });

  it('escapes mapping values in the summary', () => {
    const p = preview();
    p.map({
      track: '<script>test</script>',
      credits: ['<img src=x>'],
      skillslabs: [{ program: '<svg onload=test>', sessions: 2 }],
    });
    const text = p.summary();
    expect(text).not.toMatch(/<script>|<img |<svg /);
    expect(text).toContain('&lt;script&gt;');
    expect(text).toContain('&lt;img src=x&gt;');
    expect(text).toContain('&lt;svg onload=test&gt;');
  });
});
