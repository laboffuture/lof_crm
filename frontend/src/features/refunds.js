/* Refund rules, suggestion and withdrawal. */
/* ---------- refund rules ---------- */
const daysSince = (day) =>
  Math.max(0, Math.floor((Date.parse(TODAY + 'T12:00:00Z') - Date.parse(day + 'T12:00:00Z')) / 864e5));
function refundCalc(e, days, sessions) {
  const R = S.cfg.refund;
  const rule = R.rules.find((r) => days <= r.days && sessions <= r.sessions) || null;
  const pct = rule ? rule.pct : 0;
  const net = r2(e.fee - e.disc),
    base = r2((net * pct) / 100),
    tax = R.tax === 'refund' ? r2((base * e.taxPct) / 100) : 0,
    reg = R.regFee === 'refund' && pct > 0 ? r2(e.reg * (1 + e.taxPct / 100)) : 0,
    admin = pct > 0 ? +(R.adminFee[e.cur] || 0) : 0;
  const gross = r2(base + tax + reg - admin);
  return {
    rule,
    pct,
    net,
    base,
    tax,
    reg,
    admin,
    gross,
    suggested: r2(Math.max(0, Math.min(e.paid, gross))),
    paid: e.paid,
  };
}
function refundBox(e, c) {
  return dl([
    ['Rule applied', c.rule ? esc(c.rule.label) + ' – ' + c.pct + '%' : 'No rule matches – 0%'],
    ['Programme fee after discount', money(c.net, e.cur)],
    ['Refundable share', money(c.base, e.cur)],
    ['Tax on refundable share', money(c.tax, e.cur)],
    ['Registration fee', c.reg ? money(c.reg, e.cur) : 'Retained'],
    ['Admin fee', c.admin ? '− ' + money(c.admin, e.cur) : '—'],
    ['Paid so far', money(c.paid, e.cur)],
    ['Suggested refund', `<b>${money(c.suggested, e.cur)}</b>`],
  ]);
}
CFG.refund = () => {
  const R = S.cfg.refund;
  const rows = R.rules
    .map(
      (r, i) =>
        `<tr><td>${i + 1}</td><td><input name="l${i}" value="${esc(r.label)}" aria-label="Rule ${i + 1} name" style="width:100%;min-width:140px"></td><td>≤ <input name="d${i}" type="number" min="0" value="${r.days}" aria-label="Rule ${i + 1} days" style="width:70px"></td><td>≤ <input name="s${i}" type="number" min="0" value="${r.sessions}" aria-label="Rule ${i + 1} sessions" style="width:70px"></td><td><input name="p${i}" type="number" min="0" max="100" value="${r.pct}" aria-label="Rule ${i + 1} refund %" style="width:70px"> %</td><td><button class="btn sm ghost" type="button" data-act="rfDel" data-i="${i}" aria-label="Delete rule ${i + 1}">${ic('x')}</button></td></tr>`,
    )
    .join('');
  return (
    `<div class="banner">${ic('alert')}<span>${R.confirmed ? 'Refund rules confirmed by management.' : 'These refund values are <b>placeholders</b> and need business confirmation before go-live.'}</span></div>` +
    card(
      'Refund rules',
      cfgForm(
        'refund',
        `<p class="muted sm" style="margin:0 0 10px">Rules are checked in order; the first rule where both the days since enrolment and the sessions attended are within its limits applies. If none matches, the suggested refund is 0.</p><div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Rule</th><th>Days since enrolment</th><th>Sessions attended</th><th>Refund of programme fee</th><th></th></tr></thead><tbody>${rows}</tbody></table></div><div class="row" style="margin:8px 0 14px"><button class="btn sm" type="button" data-act="rfAdd">${ic('plus')} Add rule</button></div><div class="fgrid">${F(
          'Registration fee',
          'regFee',
          {
            v: R.regFee,
            opts: [
              ['retain', 'Retained (not refunded)'],
              ['refund', 'Refunded when any refund applies'],
            ],
          },
        )}${F('Tax on the refundable share', 'tax', {
          v: R.tax,
          opts: [
            ['refund', 'Refunded with the share'],
            ['retain', 'Retained'],
          ],
        })}${F('Admin fee (AED)', 'aAED', { t: 'number', min: 0, v: R.adminFee.AED })}${F('Admin fee (INR)', 'aINR', { t: 'number', min: 0, v: R.adminFee.INR })}${F('Approver for refunds above the suggestion', 'approver', { v: R.approver, opts: ROLES.filter((r) => r !== 'Counsellor') })}${F(
          'Status',
          'confirmed',
          {
            v: R.confirmed ? '1' : '0',
            opts: [
              ['0', 'Placeholder – needs confirmation'],
              ['1', 'Confirmed by management'],
            ],
          },
        )}</div>`,
        { ok: 'Save refund rules' },
      ),
    ) +
    '<div style="height:14px"></div>' +
    card(
      'Refund calculator',
      `<div class="fgrid" id="rfcForm">${F('Programme fee after discount', 'cfee', { t: 'number', min: 0, v: 2000, inp: 'rfCalc' })}${F('Tax %', 'ctax', { t: 'number', min: 0, v: 5, inp: 'rfCalc' })}${F('Registration fee', 'creg', { t: 'number', min: 0, v: 100, inp: 'rfCalc' })}${F('Paid so far', 'cpaid', { t: 'number', min: 0, v: 2205, inp: 'rfCalc' })}${F('Currency', 'ccur', { v: 'AED', opts: ['AED', 'INR'], chg: 'rfCalc' })}${F('Days since enrolment', 'cdays', { t: 'number', min: 0, v: 20, inp: 'rfCalc' })}${F('Sessions attended', 'cses', { t: 'number', min: 0, v: 4, inp: 'rfCalc' })}</div><div id="rfcOut" style="margin-top:12px">${rfCalcOut()}</div>`,
    )
  );
};
function rfCalcOut() {
  const g = (n) => {
    const el = document.querySelector('#rfcForm [name=' + n + ']');
    return el ? el.value : null;
  };
  const v = (n, dflt) => {
    const x = g(n);
    return x == null || x === '' ? dflt : +x;
  };
  const cur = g('ccur') || 'AED';
  const e = { fee: v('cfee', 2000), disc: 0, taxPct: v('ctax', 5), reg: v('creg', 100), paid: v('cpaid', 2205), cur };
  return refundBox(e, refundCalc(e, v('cdays', 20), v('cses', 4)));
}
INP.rfCalc = () => {
  const o = document.getElementById('rfcOut');
  if (o) o.innerHTML = rfCalcOut();
};
CHG.rfCalc = INP.rfCalc;
const rfRead = (d) => {
  const R = S.cfg.refund,
    rules = [];
  for (let i = 0; d['l' + i] != null; i++)
    rules.push({ label: String(d['l' + i]).trim(), days: +d['d' + i], sessions: +d['s' + i], pct: +d['p' + i] });
  return rules;
};
ACT.rfAdd = () => {
  const f = document.querySelector('form[data-submit="cfg_refund"]');
  if (f) S.cfg.refund.rules = rfRead(fd(f));
  S.cfg.refund.rules.push({ label: 'New rule', days: 120, sessions: 24, pct: 0 });
  render();
};
ACT.rfDel = (d) => {
  const f = document.querySelector('form[data-submit="cfg_refund"]');
  if (f) S.cfg.refund.rules = rfRead(fd(f));
  S.cfg.refund.rules.splice(+d.i, 1);
  render();
};
SUB.cfg_refund = (d, f) => {
  const rules = rfRead(d);
  for (const r of rules) {
    if (!r.label || !(r.days >= 0) || !(r.sessions >= 0) || !(r.pct >= 0 && r.pct <= 100)) {
      toast('Each rule needs a name, days and sessions ≥ 0 and a refund of 0–100%', 'err');
      return;
    }
  }
  for (let i = 1; i < rules.length; i++)
    if (rules[i].days < rules[i - 1].days && rules[i].sessions < rules[i - 1].sessions) {
      toast(
        'Rule ' +
          (i + 1) +
          ' is fully covered by rule ' +
          i +
          ' and would never apply – order rules from earliest to latest',
        'err',
      );
      return;
    }
  if (!(+d.aAED >= 0) || !(+d.aINR >= 0)) {
    toast('Admin fees must be 0 or more', 'err');
    return;
  }
  Object.assign(S.cfg.refund, {
    rules,
    regFee: d.regFee,
    tax: d.tax,
    adminFee: { AED: +d.aAED, INR: +d.aINR },
    approver: d.approver,
    confirmed: d.confirmed === '1',
  });
  cfgSave('Refund rules', rules.map((r) => r.label + ' ' + r.pct + '%').join('; '));
};

MODALS.withdraw = (m) => {
  const e = enrById(m.id),
    s = stuById(e.stu),
    days = daysSince(e.date),
    c = refundCalc(e, days, 0);
  c.suggested = r2(Math.max(0, c.suggested - priorRefunds(e)));
  return {
    title: 'Withdraw – ' + s.first + ' ' + s.last,
    form: 'withdraw',
    ok: 'Withdraw student',
    danger: 1,
    body: `<input type="hidden" name="id" value="${e.id}"><div class="fgrid">${F('Reason', 'reason', { req: 1, full: 1 })}${F('Sessions attended', 'sessions', { t: 'number', min: 0, step: 1, v: 0, req: 1, inp: 'wdCalc' })}${F('Days since enrolment', 'days', { v: days + ' (enrolled ' + fD(e.date + 'T12:00:00+04:00') + ')', dis: 1 })}${F('Refund requested (' + e.cur + ')', 'amt', { t: 'number', min: 0, step: '0.01', v: c.suggested, inp: 'wdCalc', help: 'Paid so far: ' + money(e.paid, e.cur) })}</div><div id="wdSug" style="margin-top:12px">${wdSugHtml(e, days, 0, c.suggested)}</div><p class="muted sm">Enrolment and payment history stay available. The LMS is told to withdraw unused credits (cancel call). ${S.cfg.refund.confirmed ? '' : 'Refund rules are placeholders pending business confirmation.'}</p>`,
  };
};
const priorRefunds = (e) =>
  S.refunds.filter((r) => r.enr === e.id && r.status !== 'Rejected').reduce((a, r) => a + r.amt, 0);
function wdSugHtml(e, days, ses, amt) {
  const c = refundCalc(e, days, ses),
    prior = priorRefunds(e);
  if (prior > 0) c.suggested = r2(Math.max(0, c.suggested - prior));
  const ex = amt > c.suggested + 0.005;
  return card(
    'Suggested refund',
    refundBox(e, c) +
      (ex
        ? `<div class="banner" style="margin:10px 0 0;background:var(--warn-bg)">${ic('alert')}<span>The requested ${money(amt, e.cur)} is above the suggested ${money(c.suggested, e.cur)}. It will be recorded as an <b>exception</b> for ${esc(S.cfg.refund.approver)} to approve.</span></div>`
        : ''),
  );
}
INP.wdCalc = (el) => {
  const f = el.form,
    e = enrById(f.querySelector('[name=id]').value);
  const ses = +f.querySelector('[name=sessions]').value || 0,
    amt = +f.querySelector('[name=amt]').value || 0;
  const o = document.getElementById('wdSug');
  if (o) o.innerHTML = wdSugHtml(e, daysSince(e.date), ses, amt);
};
SUB.withdraw = (d, f) => {
  if (!need(f, d, ['reason', 'sessions'])) return;
  const e = enrById(d.id),
    amt = r2(+d.amt || 0),
    ses = +d.sessions;
  if (!Number.isInteger(ses) || ses < 0) {
    setErr(f, 'sessions', 'Enter the number of sessions attended');
    return;
  }
  if (amt < 0 || amt > e.paid + 0.005) {
    setErr(f, 'amt', 'Refund cannot exceed amount paid (' + money(e.paid, e.cur) + ')');
    return;
  }
  const days = daysSince(e.date),
    c = refundCalc(e, days, ses),
    prior = priorRefunds(e),
    sug = r2(Math.max(0, c.suggested - prior)),
    ex = amt > sug + 0.005,
    R = S.cfg.refund;
  e.status = 'Withdrawn';
  if (amt > 0) {
    const r = {
      id: 'RF-26-' + String(S.seq.rf++).padStart(4, '0'),
      enr: e.id,
      amt,
      reason: d.reason,
      status: 'Requested',
      at: nowIso(),
      by: me().name,
      byId: me().id,
      sessions: ses,
      days,
      suggested: sug,
      rule: c.rule ? c.rule.label + ' (' + c.pct + '%)' : 'No rule (0%)',
      exception: ex,
      approverRole: R.approver,
      note: ex ? 'Above the suggested refund – needs ' + R.approver + ' approval' : '',
    };
    S.refunds.push(r);
    if (ex)
      notify(
        'pay',
        'warn',
        'Refund exception to approve: ' +
          r.id +
          ' – ' +
          money(amt, e.cur) +
          ' requested, ' +
          money(sug, e.cur) +
          ' suggested',
        { page: 'refunds' },
        [R.approver],
        e.branch,
      );
  }
  const s = stuById(e.stu),
    m = {
      id: 'MS-' + String(S.seq.ms++).padStart(3, '0'),
      enr: e.id,
      stu: s.id,
      op: 'cancel',
      status: 'Pending',
      mid: null,
      cid: (S.cfg.lms.programmes[e.prog] || {}).track || '—',
      credits: [],
      course: PNAME(e.prog) + ' · ' + e.pkg,
      mode: 'cancel',
      last: nowIso(),
      err: '',
      attempts: 0,
      hist: [{ at: nowIso(), s: 'Pending', msg: 'Cancel call queued after withdrawal' }],
    };
  S.ms.push(m);
  addAudit(
    'Enrolment withdrawn',
    e.id,
    d.reason + (amt > 0 ? ' · refund requested ' + money(amt, e.cur) + (ex ? ' (exception)' : '') : ''),
  );
  closeModal();
  runSync(m.id);
  toast('Enrolment withdrawn – history retained' + (ex ? '; refund sent for ' + R.approver + ' approval' : ''), 'ok');
};
PAGES.refunds = () => {
  const es = S.enr.filter((e) => inScope(e.branch) && e.status === 'Withdrawn');
  const rf = S.refunds.filter((r) => inScope(enrById(r.enr).branch));
  const R = S.cfg.refund,
    u = me();
  const btn = (r, l) => `<button class="btn sm" data-act="procRefund" data-id="${r.id}">${l}</button>`;
  const actFor = (r) => {
    if (r.status !== 'Requested') return '';
    if (r.exception) {
      if (u.role !== r.approverRole) return `<span class="muted xs">Awaiting ${esc(r.approverRole)}</span>`;
      if (r.byId === u.id)
        return `<span class="muted xs">Requested by you – another ${esc(r.approverRole)} approves</span>`;
      return `<div class="row">${btn(r, 'Approve & mark processed')}<button class="btn sm ghost" data-act="rejRefund" data-id="${r.id}">Reject</button></div>`;
    }
    return can('payments', 'E')
      ? `<div class="row">${btn(r, 'Mark processed')}<button class="btn sm ghost" data-act="rejRefund" data-id="${r.id}">Reject</button></div>`
      : '';
  };
  return (
    ph('Refunds & Withdrawals', 'Withdrawn enrolments and refund requests') +
    `<div class="banner">${ic('alert')}<span>Refunds are suggested from the refund rules (Settings → Refund Rules)${R.confirmed ? '' : ', which are placeholders pending business confirmation'}. A request above the suggestion is an exception and needs ${esc(R.approver)} approval. Pay the refund through your bank or gateway, then mark it processed.</span></div>` +
    card(
      'Refund requests',
      table(
        'rf',
        [
          { h: 'Request', f: (r) => r.id },
          {
            h: 'Student',
            f: (r) => {
              const e = enrById(r.enr),
                s = stuById(e.stu);
              return `<a ${sgo(s.id)}>${esc(s.first + ' ' + s.last)}</a>`;
            },
          },
          { h: 'Enrolment', f: (r) => r.enr },
          { h: 'Requested', f: (r) => money(r.amt, enrById(r.enr).cur), r: 1 },
          { h: 'Suggested', f: (r) => (r.suggested != null ? money(r.suggested, enrById(r.enr).cur) : '—'), r: 1 },
          {
            h: 'Rule',
            f: (r) =>
              esc(r.rule || '—') +
              (r.sessions != null ? `<div class="muted xs">${r.days} days · ${r.sessions} sessions</div>` : ''),
          },
          { h: 'Reason', f: (r) => esc(r.reason) },
          { h: 'Requested by', f: (r) => fDT(r.at) + ' · ' + esc(r.by) },
          {
            h: 'Status',
            f: (r) =>
              bdg(r.status, /^Processed/.test(r.status) ? 'ok' : 'warn') +
              (r.exception ? ' ' + bdg('Exception', 'crit') : ''),
          },
          { h: '', f: actFor },
        ],
        rf,
        { all: 1, et: 'No refund requests' },
      ),
      { np: 1 },
    ) +
    '<div style="height:14px"></div>' +
    card('Withdrawn enrolments', table('wd', enrCols(0), es, { all: 1, et: 'None' }), { np: 1 })
  );
};
ACT.rejRefund = (d) => {
  const r = S.refunds.find((x) => x.id === d.id),
    u = me();
  r.status = 'Rejected';
  r.rejectedBy = u.name;
  r.rejectedAt = nowIso();
  addAudit('Refund rejected', r.id, money(r.amt, enrById(r.enr).cur));
  render();
  toast('Refund request rejected', 'ok');
};
ACT.procRefund = (d) => {
  const r = S.refunds.find((x) => x.id === d.id),
    u = me();
  if (r.exception && (u.role !== r.approverRole || r.byId === u.id)) {
    toast('Another ' + r.approverRole + ' must approve this refund exception', 'err');
    return;
  }
  r.status = 'Processed';
  r.processedBy = u.name;
  r.processedAt = nowIso();
  addAudit(r.exception ? 'Refund exception approved' : 'Refund processed', r.id, money(r.amt, enrById(r.enr).cur));
  render();
  toast('Refund marked processed', 'ok');
};
