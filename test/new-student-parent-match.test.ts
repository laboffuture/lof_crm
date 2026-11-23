import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function registration() {
  const parent = { name: 'Existing Parent', mobile: '+919800000012', email: 'parent@example.com' };
  const saved = {
    id: 'STUDENT-1',
    first: 'Asha',
    last: 'Sharma',
    dob: '2014-05-20',
    email: 'asha@example.com',
    branch: 'KRM',
    parents: [parent],
  };
  const values = {
    first: 'Mira',
    last: 'Sharma',
    dob: '2015-06-21',
    semail: 'mira@example.com',
    pname: parent.name,
    pmob: parent.mobile,
    pemail: parent.email,
  };
  const box = { innerHTML: '' };
  const render = vi.fn(),
    toast = vi.fn();
  const ctx = createContext({
    S: { students: [saved], leads: [], wiz: { mode: 'new', step: 1, d: {} } },
    ACT: {},
    CHG: {},
    SUB: {},
    INP: {},
    PAGES: {},
    need: () => true,
    age: () => 12,
    setErr: vi.fn(),
    render,
    toast,
    fd: (form: any) => ({ ...form.values }),
    $: () => box,
    esc: (s: string) => String(s),
    branchName: (id: string) => id,
    sgo: () => '',
  });
  const rules = readFileSync('frontend/src/domain/business-rules.js', 'utf8');
  runInContext(rules.slice(0, rules.indexOf('function msgFrom')), ctx);
  runInContext(readFileSync('frontend/src/pages/enrolment-wizard.js', 'utf8'), ctx);
  const form = () => {
    const f = { values, querySelector: (_selector: string): any => ({ form: f }) };
    return f;
  };
  const submit = () => ctx.SUB.wizStep1({ ...values }, form());
  return { ctx, saved, values, box, render, toast, submit, form };
}

describe('New student registration with parent matches', () => {
  it('continues a different child on the first click even when the parent phone and email match', () => {
    const r = registration();
    r.submit();
    expect(r.ctx.S.wiz.step).toBe(2);
    expect(r.ctx.S.wiz.mode).toBe('new');
    expect(r.ctx.S.wiz.stu).toBeUndefined();
    expect(r.box.innerHTML).toContain('Parent contact already on file');
    expect(r.box.innerHTML).toContain('continue registering a different child');
    expect(r.box.innerHTML).not.toContain('Possible existing student');
    expect(r.toast).not.toHaveBeenCalled();
    expect(r.ctx.S.students).toHaveLength(1); // Nothing is created until the final confirmation.
  });

  it('does not show a parent warning for an unrelated family', () => {
    const r = registration();
    r.values.pmob = '+919800000099';
    r.values.pemail = 'another.parent@example.com';
    r.submit();
    expect(r.ctx.S.wiz.step).toBe(2);
    expect(r.box.innerHTML).toBe('');
    expect(r.toast).not.toHaveBeenCalled();
  });

  it.each(['email', 'name and DOB'])(
    'reviews a possible existing child matched by %s, preserving the draft',
    (match) => {
      const r = registration();
      if (match === 'email') r.values.semail = ' ASHA@EXAMPLE.COM ';
      else Object.assign(r.values, { first: '  ASHA ', last: 'SHARMA', dob: r.saved.dob });
      r.submit();
      expect(r.ctx.S.wiz.step).toBe(1);
      expect(r.ctx.S.wiz.d.first).toBe(r.values.first);
      expect(r.box.innerHTML).toContain('Possible existing student');
      expect(r.box.innerHTML).toContain('STUDENT-1');
      expect(r.toast).toHaveBeenCalledOnce();
      // A fresh form after a redraw retains the prior acknowledgement in wizard state.
      r.submit();
      expect(r.ctx.S.wiz.step).toBe(2);
      expect(r.toast).toHaveBeenCalledOnce();
    },
  );

  it('checks child identity independently of the parent contacts', () => {
    const r = registration();
    r.values.pmob = '+919800000099';
    r.values.pemail = 'another.parent@example.com';
    r.values.semail = r.saved.email;
    r.submit();
    expect(r.ctx.S.wiz.step).toBe(1);
    expect(r.box.innerHTML).toContain('Possible existing student');
  });

  it('does not treat a matching surname alone as the same child', () => {
    const r = registration();
    r.values.dob = r.saved.dob;
    r.submit();
    expect(r.ctx.S.wiz.step).toBe(2);
    expect(r.toast).not.toHaveBeenCalled();
  });

  it('lets staff explicitly reuse the saved student rather than creating another profile', () => {
    const r = registration();
    r.ctx.S.route = {};
    r.ctx.ACT.wizUse({ id: r.saved.id });
    expect(r.ctx.S.wiz.mode).toBe('existing');
    expect(r.ctx.S.wiz.stu).toBe(r.saved.id);
    expect(r.ctx.S.students).toHaveLength(1);
  });
});
