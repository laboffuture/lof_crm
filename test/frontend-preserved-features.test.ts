import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

function combinedFrontend() {
  const element = { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], dataset: {}, style: {}, setAttribute() {}, removeAttribute() {}, focus() {} };
  const context = createContext({
    document: { ...element, getElementById: () => element, documentElement: element, head: element, body: { ...element, contains: () => true }, activeElement: null },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener() {}, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    console, URLSearchParams, Blob, Date, Intl,
  });
  context.window = context;
  context.LOF_API = null;
  const manifest = JSON.parse(readFileSync('frontend/manifest.json', 'utf8'));
  const source = (file: string) => readFileSync('frontend/src/' + file, 'utf8');
  for (const file of manifest.app.filter((f: string) => !['config.js', 'boot.js'].includes(f))) runInContext(source(file), context);
  context.LOF_API = { base: '/api/v1' };
  const api = manifest.api.filter((f: string) => f !== 'api/start.js').map(source).join('\n');
  runInContext('(function(){\n' + api + '\nglobalThis.testApi={applyBootstrap,loginScreen,etMeta};\n})()', context);
  const state = runInContext("S=seed(); S.user='S14'; S", context);
  return { context, state, eval: (code: string) => runInContext(code, context) };
}

describe('repository features in the modular frontend', () => {
  it('loads the complete adapter and keeps repository extension screens and actions', () => {
    const c = combinedFrontend();
    const tabs = c.eval('CTABS.map(t=>t[0])');
    for (const tab of ['emailTpls', 'mailOut', 'mailIn', 'mailAuto']) expect(tabs).toContain(tab);
    expect(c.eval('typeof ACT.repPdf')).toBe('function');
    expect(c.eval('typeof ACT.mailAutoRun')).toBe('function');
    expect(c.eval('typeof testApi.loginScreen')).toBe('function');
    expect(c.eval('CFG.emailTpls()')).toContain('template');
    expect(c.eval('CFG.staff()')).toContain('Staff');
    expect(c.eval('CFG.branches()')).toContain('branch');
  });

  it('keeps assigned branch access together with the updated LMS wizard summary', () => {
    const c = combinedFrontend();
    c.state.user = 'S01';
    expect(c.eval("inScope('KRM')")).toBe(true);
    expect(c.eval("inScope('BLR')")).toBe(false);
    expect(c.eval('optBranches()')).not.toContain('value="BLR"');
    const fee = c.state.fees.find((f: any) => f.prog === 'ROB' && f.branch === 'KRM' && f.active);
    c.state.cfg.lms.packages = { ROB: { [fee.pkg]: { track: 'RT', credits: ['C1'] } } };
    c.state.cfg.lms.confirmed = true;
    c.state.wiz = { mode: 'existing', step: 3, stu: c.state.students[0].id, d: { prog: 'ROB', pkg: fee.pkg, branch: 'KRM' }, fee, term: 'PT1', disc: null, calc: { prog: 'ROB', br: 'KRM' } };
    expect(c.eval('PAGES.wizard({})')).toContain('>RT<');
    expect(c.eval('PAGES.wizard({})')).toContain('1 Credit');
  });
});
