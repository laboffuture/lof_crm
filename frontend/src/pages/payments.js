/* Collect payment, payment records, receipts, CSV export. */
/* ====== payments ====== */
PAGES.payCollect = () => {
  const es = S.enr.filter((e) => inScope(e.branch) && e.status !== 'Withdrawn' && e.total - e.paid > 0.005);
  const pick = S.payPick && enrById(S.payPick) && es.find((e) => e.id === S.payPick) ? enrById(S.payPick) : null;
  let right = emptyBox('Select an enrolment', 'Choose an enrolment with an outstanding balance to record a payment.');
  if (pick) {
    const s = stuById(pick.stu),
      out = r2(pick.total - pick.paid);
    const nr = (S.seq.rc[pick.branch] || 0) + 1;
    right = `${dl([
      ['Student', `<a ${sgo(s.id)}>${esc(s.first + ' ' + s.last)}</a> <span class="mono muted">${s.id}</span>`],
      ['Branch', esc(branchName(pick.branch))],
      ['Enrolment / opportunity', pick.id + (pick.opp ? ' / ' + pick.opp : '')],
      ['Programme', esc(PNAME(pick.prog)) + ' · ' + esc(pick.pkg)],
      ['Original fee', money(pick.fee + pick.reg, pick.cur)],
      [
        'Approved discount',
        pick.disc ? '− ' + money(pick.disc, pick.cur) + ' (' + esc((pick.discInfo || {}).name || '') + ')' : '—',
      ],
      ['Tax (' + pick.taxPct + '%)', money(pick.tax, pick.cur)],
      ['Final payable', `<b>${money(pick.total, pick.cur)}</b>`],
      ['Paid so far', money(pick.paid, pick.cur)],
      ['Outstanding', `<b style="color:var(--crit)">${money(out, pick.cur)}</b>`],
      ['Payment term', esc(termName(pick.term))],
    ])}<div class="sec">Instalments</div>${schedTable(instStatus(pick), pick.cur)}<form id="payf" data-submit="pay" style="margin-top:14px"><input type="hidden" name="id" value="${pick.id}"><div class="fgrid">${F('Amount (' + pick.cur + ')', 'amt', { t: 'number', min: 0.01, step: '0.01', v: out, req: 1 })}${F('Payment method', 'method', { opts: S.cfg.pm, v: 'Card' })}${F('Payment reference', 'ref', { help: 'Card/UPI/bank reference. Required for non-cash.' })}${F('Transaction date', 'date', { t: 'date', v: TODAY, max: TODAY })}${F('Receipt number', 'rc', { v: 'RC-' + pick.branch + '-26-' + String(nr).padStart(4, '0') + ' (auto)', dis: 1 })}${F('Payment status', 'st', { v: 'Recorded (simulated)', dis: 1 })}</div><div class="row" style="margin-top:12px"><button class="btn primary" type="submit">Record payment (simulated)</button></div></form>`;
  }
  const hist = pick
    ? card(
        'Payment history – ' + esc(stuById(pick.stu).first),
        table(
          'ph2',
          [
            { h: 'Date', f: (p) => fDT(p.at) },
            { h: 'Receipt', f: (p) => `<a data-act="receipt" data-id="${p.id}" class="mono">${p.rc}</a>` },
            { h: 'Amount', f: (p) => money(p.amt, p.cur), r: 1 },
            { h: 'Method', f: (p) => p.method },
            { h: 'Reference', f: (p) => esc(p.ref) },
          ],
          S.pay.filter((p) => p.stu === pick.stu),
          { all: 1 },
        ),
        { np: 1 },
      )
    : '';
  return (
    ph('Payment Collection', 'Record fees received at the front desk') +
    `<div class="banner">${ic('alert')}Payment gateway: <b>${esc(S.cfg.integ.pay.provider)}</b> – not connected. Payments are recorded manually and shown as <b>Recorded (simulated)</b>; nothing is processed.</div><div class="grid" style="grid-template-columns:minmax(260px,1fr) minmax(0,1.6fr)">${card(
      'Outstanding balances',
      es.length
        ? `<div class="list" style="margin:-14px">${es
            .map((e) => {
              const s = stuById(e.stu);
              return `<div class="cl" style="cursor:pointer;${pick && pick.id === e.id ? 'background:var(--accent-soft)' : ''}" data-act="payPick" data-id="${e.id}"><span><b>${esc(s.first + ' ' + s.last)}</b><br><span class="muted xs">${esc(PNAME(e.prog))} · ${esc(branchName(e.branch))}</span></span><span class="num">${money(e.total - e.paid, e.cur)}</span></div>`;
            })
            .join('')}</div>`
        : emptyBox('All fees collected', 'No outstanding balances in your branches.'),
    )}${card('Collect payment', right)}</div>` +
    (hist ? '<div style="height:14px"></div>' + hist : '')
  );
};
ACT.payPick = (d) => {
  S.payPick = d.id;
  render();
};
SUB.pay = (d, f) => {
  clearErrs(f);
  const e = enrById(d.id),
    out = r2(e.total - e.paid),
    amt = +d.amt;
  if (!(amt > 0)) {
    setErr(f, 'amt', 'Enter an amount greater than zero');
    return;
  }
  if (amt > out + 0.005) {
    setErr(f, 'amt', 'Amount exceeds the outstanding balance (' + money(out, e.cur) + ')');
    return;
  }
  if (d.method !== 'Cash' && !String(d.ref).trim()) {
    setErr(f, 'ref', 'Reference is required for ' + d.method);
    return;
  }
  const p = addPay(
    S,
    e,
    amt,
    d.method,
    d.method === 'Cash' ? '—' : d.ref,
    d.date && d.date !== TODAY ? d.date : nowIso(),
    me().id,
  );
  const s = stuById(e.stu);
  notify(
    'pay',
    'ok',
    'Payment received (simulated): ' + money(amt, e.cur) + ' – ' + s.first + ' ' + s.last + ', ' + d.method,
    { page: 'payRecords' },
    ['Reception', 'Centre Administrator', 'Management'],
    e.branch,
  );
  addAudit('Payment recorded (simulated)', p.id, money(amt, e.cur) + ' · ' + d.method + ' · ' + p.rc);
  render();
  openModal('receipt', { id: p.id });
  toast('Payment recorded (simulated) – receipt ' + p.rc, 'ok');
};
MODALS.receipt = (m) => {
  const p = S.pay.find((x) => x.id === m.id),
    e = enrById(p.enr),
    s = stuById(p.stu);
  return {
    title: 'Receipt preview',
    size: 'sm2',
    foot: `<button class="btn" data-act="closeModal">Close</button><button class="btn primary" data-act="genReceipt" data-id="${p.id}">Generate receipt (simulated)</button>`,
    body: `<div class="rcpt"><h4>Lab of Future</h4><div class="muted sm">${esc(branchName(p.branch))} · Official receipt <span class="sim">Simulated</span></div><hr>${dl(
      [
        ['Receipt no.', `<span class="mono">${p.rc}</span>`],
        ['Date', fDT(p.at)],
        ['Student', esc(s.first + ' ' + s.last) + ' (' + s.id + ')'],
        ['Programme', esc(PNAME(e.prog))],
        ['Method', p.method + (p.ref && p.ref !== '—' ? ' · ' + esc(p.ref) : '')],
        ['Amount paid', `<b>${money(p.amt, p.cur)}</b>`],
        ['Balance after payment', money(Math.max(0, e.total - e.paid), e.cur)],
      ],
    )}<hr><div class="muted xs">Prototype receipt – not a valid tax document. Finance linkage to ERPNext Accounts is pending integration.</div></div>`,
  };
};
ACT.genReceipt = (d) => {
  const p = S.pay.find((x) => x.id === d.id);
  addAudit('Receipt generated (simulated)', p.id, p.rc);
  toast('Receipt ' + p.rc + ' generated (simulated). PDF download is not available in the prototype.', 'ok');
};
PAGES.payRecords = () => {
  const ps = S.pay.filter((p) => inScope(p.branch)).sort((a, b) => new Date(b.at) - new Date(a.at)),
    f = S.payF || '';
  const x = ps.filter((p) => !f || p.method === f);
  const tot = x.reduce((a, p) => a + toAED(p.amt, p.cur), 0);
  return (
    ph(
      'Payment Records',
      'All recorded payments (simulated)',
      `<select data-change="payF" aria-label="Method"><option value="">All methods</option>${S.cfg.pm.map((m) => `<option${f === m ? ' selected' : ''}>${m}</option>`).join('')}</select><button class="btn" data-act="payCsv">Export CSV</button>`,
    ) +
    `<div class="sum"><div class="it"><small>Records</small><b>${x.length}</b></div><div class="it"><small>Total collected (AED equivalent)</small><b>${Math.round(tot).toLocaleString('en-US')}</b></div><div class="it muted xs">INR converted at ${S.fx.INR} (rate pending business confirmation)</div></div>` +
    card(
      '',
      table(
        'pay',
        [
          { h: 'Payment', f: (p) => `<span class="mono">${p.id}</span>`, s: (p) => p.id },
          { h: 'Date', f: (p) => fDT(p.at), s: (p) => p.at },
          {
            h: 'Student',
            f: (p) => {
              const s = stuById(p.stu);
              return `<a ${sgo(s.id)}>${esc(s.first + ' ' + s.last)}</a>`;
            },
          },
          { h: 'Branch', f: (p) => esc(branchName(p.branch)) },
          { h: 'Enrolment', f: (p) => p.enr },
          { h: 'Programme', f: (p) => esc(PNAME(enrById(p.enr).prog)) },
          { h: 'Amount', f: (p) => money(p.amt, p.cur), r: 1, s: (p) => toAED(p.amt, p.cur) },
          { h: 'Method', f: (p) => p.method },
          { h: 'Reference', f: (p) => esc(p.ref) },
          { h: 'Receipt', f: (p) => `<a data-act="receipt" data-id="${p.id}" class="mono">${p.rc}</a>` },
          { h: 'Status', f: (p) => bdg(p.status, 'info') },
        ],
        x,
        { ps: 12 },
      ),
      { np: 1 },
    )
  );
};
CHG.payF = (el) => {
  S.payF = el.value;
  render();
};
ACT.payCsv = () => {
  const ps = S.pay.filter((p) => inScope(p.branch));
  openModal('csv', {
    name: 'payment-records',
    head: ['Payment', 'Date', 'Student', 'Branch', 'Enrolment', 'Amount', 'Currency', 'Method', 'Reference', 'Receipt'],
    rows: ps.map((p) => [
      p.id,
      fDT(p.at),
      stuById(p.stu).first + ' ' + stuById(p.stu).last,
      branchName(p.branch),
      p.enr,
      p.amt,
      p.cur,
      p.method,
      p.ref,
      p.rc,
    ]),
  });
};
PAGES.receipts = () => {
  const ps = S.pay.filter((p) => inScope(p.branch)).sort((a, b) => new Date(b.at) - new Date(a.at));
  return (
    ph('Receipts', 'Receipts issued for recorded payments (simulated)') +
    card(
      '',
      table(
        'rcp',
        [
          { h: 'Receipt no.', f: (p) => `<span class="mono">${p.rc}</span>` },
          { h: 'Date', f: (p) => fDT(p.at) },
          { h: 'Student', f: (p) => esc(stuById(p.stu).first + ' ' + stuById(p.stu).last) },
          { h: 'Amount', f: (p) => money(p.amt, p.cur), r: 1 },
          { h: 'Method', f: (p) => p.method },
          { h: '', f: (p) => `<button class="btn sm" data-act="receipt" data-id="${p.id}">Preview</button>` },
        ],
        ps,
        { ps: 12 },
      ),
      { np: 1 },
    )
  );
};
MODALS.csv = (m) => {
  const esc2 = (v) => {
    v = String(v == null ? '' : v);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  const t = [m.head]
    .concat(m.rows)
    .map((r) => r.map(esc2).join(','))
    .join('\n');
  return {
    title: 'CSV export – ' + m.name,
    size: 'lg',
    foot: `<button class="btn" data-act="closeModal">Close</button><button class="btn primary" data-act="copyCsv">Copy CSV</button>`,
    body: `<p class="muted sm">Downloads are disabled inside the prototype viewer, so the export is shown here. Copy it into a spreadsheet.</p><textarea id="csvtxt" readonly rows="12" style="width:100%;font-family:var(--f-mono);font-size:12px;border:1px solid var(--line);border-radius:6px;background:var(--panel2);padding:8px">${esc(t)}</textarea>`,
  };
};
ACT.copyCsv = () => {
  const t = $('#csvtxt');
  t.select();
  navigator.clipboard
    ? navigator.clipboard.writeText(t.value).then(
        () => toast('CSV copied', 'ok'),
        () => toast('Press Ctrl/Cmd+C to copy the selected text', 'warn'),
      )
    : toast('Press Ctrl/Cmd+C to copy the selected text', 'warn');
};
