/* Report catalogue and report builder. */
/* ====== reports ====== */
const RDEF = [
  ['r1', 'Daily Collection Report'],
  ['r2', 'Counsellor-wise Conversion Report'],
  ['r3', 'Source-wise Lead Report'],
  ['r4', 'Lead Funnel / Temperature Report'],
  ['r5', 'Target vs Achievement'],
  ['r6', 'Lost Lead Reason Analysis'],
  ['r7', 'Unassigned Lead Report'],
  ['r8', 'First Call SLA Report'],
  ['r9', 'First Call SLA Breach Report'],
  ['r10', 'Overdue Follow-up Report'],
  ['r11', 'Counsellor Workload Report'],
  ['r12', 'Branch Transfer Report'],
  ['r13', 'No Response Attempt Report'],
  ['r14', 'Opportunity Conversion Report'],
  ['r15', 'Program-wise Enrollment Report'],
  ['r16', 'Branch-wise Enrollment Report'],
  ['r17', 'LMS Sync Status Report'],
  ['r18', 'LMS Integration Failure Report'],
  ['r19', 'Discount Approval Report'],
  ['r20', 'Daily Lead Activity Report'],
];
const RF = () => S.rep.f;
const RL = () => {
  const F = RF();
  return leadScope().filter(
    (l) =>
      (!F.branch || l.branch === F.branch) &&
      (!F.prog || l.prog === F.prog) &&
      (!F.src || l.src === F.src) &&
      (!F.cslr || l.cslr === F.cslr) &&
      (!F.status || l.status === F.status) &&
      inRange(l.enq, F.range || 'all'),
  );
};
const RB = () => S.branches.filter((b) => inScope(b.id) && (!RF().branch || b.id === RF().branch));
const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '0%');
const RCs = () =>
  S.staff.filter(
    (s) =>
      s.role === 'Counsellor' &&
      inScope(s.branch) &&
      (!RF().cslr || s.id === RF().cslr) &&
      (!RF().branch || s.branch === RF().branch),
  );
const RP = () =>
  S.pay.filter(
    (p) => inScope(p.branch) && (!RF().branch || p.branch === RF().branch) && inRange(p.at, RF().range || 'all'),
  );
const RE = () =>
  S.enr.filter(
    (e) =>
      inScope(e.branch) &&
      (!RF().branch || e.branch === RF().branch) &&
      (!RF().prog || e.prog === RF().prog) &&
      inRange(e.date + 'T12:00:00+04:00', RF().range || 'all'),
  );
const REP = {
  r1: () => {
    const days = {};
    RP().forEach((p) => {
      const k = dayKey(p.at);
      (days[k] = days[k] || { n: 0, t: {} }).n++;
      days[k].t[p.method] = (days[k].t[p.method] || 0) + toAED(p.amt, p.cur);
    });
    const ks = Object.keys(days).sort().reverse(),
      M = S.cfg.pm;
    return {
      cols: ['Date', 'Receipts'].concat(
        M.map((m) => m + ' (AED eq.)'),
        ['Total (AED eq.)'],
      ),
      rows: ks.map((k) =>
        [k, days[k].n].concat(
          M.map((m) => Math.round(days[k].t[m] || 0)),
          [Math.round(Object.values(days[k].t).reduce((a, b) => a + b, 0))],
        ),
      ),
      chart: ks
        .slice(0, 10)
        .reverse()
        .map((k) => ({ l: k, v: Math.round(Object.values(days[k].t).reduce((a, b) => a + b, 0)) })),
    };
  },
  r2: () => {
    const ls = RL(),
      rows = RCs().map((s) => {
        const x = ls.filter((l) => l.cslr === s.id),
          cv = x.filter((l) => l.status === 'Converted').length,
          en = S.opps.filter((o) => o.stage === 'Enrolled' && x.find((l) => l.id === o.lead)).length;
        return [s.name, s.branch, x.length, x.filter((l) => l.fc).length, cv, en, pct(cv, x.length), pct(en, x.length)];
      });
    return {
      cols: [
        'Counsellor',
        'Branch',
        'Leads',
        'Contacted',
        'Converted to opportunity',
        'Enrolled',
        'Conversion %',
        'Enrolment %',
      ],
      rows,
      chart: rows.map((r) => ({ l: r[0], v: parseInt(r[6]) })),
    };
  },
  r3: () => {
    const ls = RL(),
      rows = S.cfg.sources.map((s) => {
        const x = ls.filter((l) => l.src === s.n),
          cv = x.filter((l) => l.status === 'Converted').length;
        return [
          s.n,
          x.length,
          x.filter((l) => l.cat === 'Hot').length,
          cv,
          x.filter((l) => ['Lost', 'Closed'].includes(l.status)).length,
          pct(cv, x.length),
        ];
      });
    return {
      cols: ['Source', 'Leads', 'Hot leads', 'Converted', 'Lost / closed', 'Conversion %'],
      rows,
      chart: rows.map((r) => ({ l: r[0], v: r[1] })),
    };
  },
  r4: () => {
    const ls = RL(),
      t = ls.length;
    const st = [
      ['New lead', t],
      ['Contacted', ls.filter((l) => LSTAGES.indexOf(l.stage) >= 1).length],
      ['Qualified', ls.filter((l) => LSTAGES.indexOf(l.stage) >= 2).length],
      ['Opportunity', ls.filter((l) => l.status === 'Converted').length],
    ];
    const tp = CATS.map((c) => [c, ls.filter((l) => l.cat === c).length]);
    const rows = st
      .map((r) => ['Stage', r[0], r[1], pct(r[1], t)])
      .concat(tp.map((r) => ['Temperature', r[0], r[1], pct(r[1], t)]));
    return { cols: ['Type', 'Measure', 'Leads', '% of leads'], rows, chart: st.map((r) => ({ l: r[0], v: r[1] })) };
  },
  r5: () => {
    const rows = RB()
      .filter((b) => b.tAdm)
      .map((b) => {
        const a = S.enr.filter((e) => e.branch === b.id && e.date.startsWith('2026-10')).length,
          r = S.pay
            .filter((p) => p.branch === b.id && dayKey(p.at).startsWith('2026-10'))
            .reduce((x, p) => x + p.amt, 0);
        return [b.name, b.tAdm, a, pct(a, b.tAdm), money(b.tRev, b.cur), money(r, b.cur), pct(r, b.tRev)];
      });
    return {
      cols: [
        'Branch (October 2026)',
        'Admissions target',
        'Achieved',
        '% of target',
        'Revenue target',
        'Collected',
        '% of target',
      ],
      rows,
      chart: rows.map((r) => ({ l: r[0], v: parseInt(r[3]) })),
      note: 'Chart shows % of admissions target achieved.',
    };
  },
  r6: () => {
    const m = {};
    const add = (r, k) => {
      if (!r) return;
      const x = (m[r] = m[r] || { n: 0, k: {} });
      x.n++;
      x.k[k] = (x.k[k] || 0) + 1;
    };
    RL().forEach((l) => {
      if (l.status === 'Lost') add(l.lostReason, 'Lost lead');
      if (l.status === 'Closed' && l.cat === 'Not Interested') add(l.closeReason, 'Not interested');
    });
    S.opps
      .filter((o) => o.stage === 'Lost' && inScope(o.branch) && (!RF().branch || o.branch === RF().branch))
      .forEach((o) => add(o.lost, 'Lost opportunity'));
    const rows = Object.keys(m)
      .map((r) => [
        r,
        m[r].n,
        Object.keys(m[r].k)
          .map((k) => k + ' ×' + m[r].k[k])
          .join(', '),
      ])
      .sort((a, b) => b[1] - a[1]);
    return { cols: ['Reason', 'Count', 'Breakdown'], rows, chart: rows.map((r) => ({ l: r[0], v: r[1] })) };
  },
  r7: () => ({
    cols: ['Lead', 'Prospect', 'Branch', 'Programme', 'Category', 'Enquiry', 'Waiting (h)', 'Why unassigned'],
    rows: RL()
      .filter((l) => !l.cslr && l.status === 'Open')
      .map((l) => [
        l.id,
        l.student,
        branchName(l.branch),
        PNAME(l.prog),
        l.cat,
        fDT(l.enq),
        Math.round(((NOW - new Date(l.enq)) / 36e5) * 10) / 10,
        l.events.some((e) => /workload/i.test(e.text)) || l.id === 'LD-26-1026'
          ? 'No eligible counsellor (workload limit)'
          : 'Awaiting manual assignment',
      ]),
  }),
  r8: () => {
    const ls = RL(),
      rows = RCs().map((s) => {
        const x = ls.filter((l) => l.cslr === s.id),
          k = (n) => x.filter((l) => sla(l).s === n).length,
          c = x.filter((l) => l.fc),
          avg = c.length
            ? Math.round(c.reduce((a, l) => a + (new Date(l.fc) - new Date(l.enq)) / 6e4, 0) / c.length)
            : 0;
        return [
          s.name,
          x.length,
          k('Completed') - x.filter((l) => sla(l).late).length,
          x.filter((l) => sla(l).late).length,
          k('Breached'),
          k('Due Soon'),
          k('On Track'),
          avg + ' min',
        ];
      });
    return {
      cols: [
        'Counsellor',
        'Leads',
        'Called on time',
        'Called late',
        'Breached (uncalled)',
        'Due soon',
        'On track',
        'Avg. time to first call',
      ],
      rows,
      chart: rows.map((r) => ({ l: r[0], v: r[4] })),
      note: 'Chart shows uncalled breaches per counsellor. SLA = ' + S.cfg.sla.mins + ' min.',
    };
  },
  r9: () => ({
    cols: ['Lead', 'Prospect', 'Branch', 'Counsellor', 'Enquiry', 'First call', 'Minutes over SLA', 'State'],
    rows: RL()
      .filter((l) => {
        const s = sla(l);
        return s.s === 'Breached' || s.late;
      })
      .map((l) => {
        const s = sla(l);
        return [
          l.id,
          l.student,
          branchName(l.branch),
          staffName(l.cslr),
          fDT(l.enq),
          l.fc ? fDT(l.fc) : 'Not called',
          s.late ? s.mins - S.cfg.sla.mins : s.over,
          s.late ? 'Called late' : 'Uncalled – breached',
        ];
      }),
  }),
  r10: () => ({
    cols: ['Task', 'Lead', 'Counsellor', 'Due', 'Overdue by', 'Type'],
    rows: S.tasks
      .filter(
        (t) =>
          t.status === 'Pending' &&
          new Date(t.due) < NOW &&
          leadById(t.lead) &&
          inScope(leadById(t.lead).branch) &&
          (!RF().branch || leadById(t.lead).branch === RF().branch),
      )
      .map((t) => [
        t.id,
        leadById(t.lead).student,
        staffName(t.cslr),
        fDT(t.due),
        rel(t.due).replace(' ago', ''),
        t.type,
      ]),
  }),
  r11: () => {
    const rows = RCs().map((s) => {
      const L = load(s.id);
      return [
        s.name,
        s.branch,
        s.programs.join(', '),
        s.avail,
        L.open,
        L.Hot,
        L.Warm,
        L.Cold,
        L.w,
        s.max,
        pct(L.w, s.max),
      ];
    });
    return {
      cols: [
        'Counsellor',
        'Branch',
        'Programmes',
        'Availability',
        'Open',
        'Hot',
        'Warm',
        'Cold',
        'Weighted',
        'Max',
        'Utilisation',
      ],
      rows,
      chart: rows.map((r) => ({ l: r[0], v: parseInt(r[10]) })),
    };
  },
  r12: () => ({
    cols: [
      'Request',
      'Lead',
      'Previous',
      'Requested',
      'Reason',
      'Requested by',
      'Requested',
      'Decision by',
      'Decision',
      'Status',
    ],
    rows: S.approvals
      .filter((a) => a.type === 'Branch Transfer' && inScope(a.branch))
      .map((a) => [
        a.id,
        leadById(a.payload.lead).student,
        branchName(a.payload.from),
        branchName(a.payload.to),
        a.reason,
        staffName(a.by),
        fDT(a.at),
        a.decision ? staffName(a.decision.by) : '—',
        a.decision ? fDT(a.decision.at) : '—',
        a.status,
      ]),
  }),
  r13: () => ({
    cols: ['Lead', 'Prospect', 'Counsellor', 'Original category', 'Attempts', 'Limit', 'Status'],
    rows: RL()
      .filter((l) => l.cat === 'No Response' || /No Response/.test(l.closeReason))
      .map((l) => [
        l.id,
        l.student,
        staffName(l.cslr),
        l.origCat || '—',
        l.noResp,
        S.cfg.life.noRespMax,
        l.status === 'Closed' ? 'Closed after limit' : 'Open – retrying',
      ]),
    chart: RL()
      .filter((l) => l.cat === 'No Response')
      .map((l) => ({ l: l.student, v: l.noResp })),
  }),
  r14: () => {
    const ls = RL(),
      rows = RB().map((b) => {
        const x = ls.filter((l) => l.branch === b.id),
          ids = x.map((l) => l.id),
          os = S.opps.filter((o) => ids.includes(o.lead));
        const en = os.filter((o) => o.stage === 'Enrolled').length;
        return [
          b.name,
          x.length,
          os.length,
          os.filter((o) => ['Opportunity', 'Admission Decision'].includes(o.stage)).length,
          en,
          os.filter((o) => o.stage === 'Lost').length,
          pct(os.length, x.length),
          pct(en, os.length),
        ];
      });
    return {
      cols: [
        'Branch',
        'Leads',
        'Converted to opportunity',
        'In progress',
        'Enrolled',
        'Lost',
        'Lead → opportunity',
        'Opportunity → enrolled',
      ],
      rows,
      chart: rows.map((r) => ({ l: r[0], v: r[2] })),
    };
  },
  r15: () => {
    const es = RE(),
      rows = S.programs
        .map((p) => {
          const x = es.filter((e) => e.prog === p.id);
          return [
            p.name,
            x.length,
            x.filter((e) => e.status === 'Active').length,
            Math.round(x.reduce((a, e) => a + toAED(e.paid, e.cur), 0)),
          ];
        })
        .filter((r) => r[1]);
    return {
      cols: ['Programme', 'Enrolments', 'Active', 'Collected (AED eq.)'],
      rows,
      chart: rows.map((r) => ({ l: r[0], v: r[1] })),
    };
  },
  r16: () => {
    const es = RE(),
      rows = RB().map((b) => {
        const x = es.filter((e) => e.branch === b.id);
        return [
          b.name,
          x.length,
          x.filter((e) => e.status === 'Active').length,
          x.filter((e) => e.status === 'Withdrawn').length,
          Math.round(x.reduce((a, e) => a + toAED(e.paid, e.cur), 0)),
        ];
      });
    return {
      cols: ['Branch', 'Enrolments', 'Active', 'Withdrawn', 'Collected (AED eq.)'],
      rows,
      chart: rows.map((r) => ({ l: r[0], v: r[1] })),
    };
  },
  r17: () => {
    const ms = S.ms.filter((m) => inScope(enrById(m.enr).branch));
    const st = ['Success', 'Processing', 'Pending', 'Failed', 'Retry Required'];
    return {
      cols: ['Sync', 'Student', 'Enrolment', 'LMS student ID', 'LMS course', 'Status', 'Last sync', 'Attempts'],
      rows: ms.map((m) => [
        m.id,
        stuById(m.stu).first + ' ' + stuById(m.stu).last + ' (' + m.stu + ')',
        m.enr,
        m.mid || '—',
        m.cid,
        m.status,
        fDT(m.last),
        m.attempts,
      ]),
      chart: st.map((k) => ({ l: k, v: ms.filter((m) => m.status === k).length })),
    };
  },
  r18: () => ({
    cols: ['Sync', 'Student', 'Enrolment', 'Status', 'Attempts', 'Last attempt', 'Error'],
    rows: S.ms
      .filter((m) => ['Failed', 'Retry Required'].includes(m.status) && inScope(enrById(m.enr).branch))
      .map((m) => [
        m.id,
        stuById(m.stu).first + ' ' + stuById(m.stu).last,
        m.enr,
        m.status,
        m.attempts,
        fDT(m.last),
        m.err,
      ]),
  }),
  r19: () => ({
    cols: [
      'Request',
      'Prospect',
      'Branch',
      'Programme',
      'Discount',
      'Final payable',
      'Requested by',
      'Approver',
      'Status',
      'Remarks',
    ],
    rows: S.approvals
      .filter((a) => a.type === 'Exceptional Discount' && inScope(a.branch))
      .map((a) => {
        const o = oppById(a.payload.opp);
        return [
          a.id,
          o.student,
          branchName(a.branch),
          PNAME(o.prog),
          a.payload.type === '%' ? a.payload.value + '%' : money(a.payload.value, a.payload.cur),
          money(a.payload.final, a.payload.cur),
          staffName(a.by),
          a.approverRole,
          a.status,
          a.decision ? a.decision.remarks : '',
        ];
      }),
    chart: ['Pending', 'Approved', 'Rejected'].map((k) => ({
      l: k,
      v: S.approvals.filter((a) => a.type === 'Exceptional Discount' && a.status === k && inScope(a.branch)).length,
    })),
  }),
  r20: () => {
    const days = [...Array(7)].map((_, i) => dayKey(dAt(-6 + i, 12)));
    const ls = leadScope().filter((l) => !RF().branch || l.branch === RF().branch);
    const rows = days.map((k) => [
      k,
      ls.filter((l) => dayKey(l.enq) === k).length,
      S.calls.filter((c) => dayKey(c.at) === k && ls.find((l) => l.id === c.lead)).length,
      S.comms.filter((c) => dayKey(c.at) === k && ls.find((l) => l.id === c.lead)).length,
      S.tasks.filter((t) => t.status === 'Done' && dayKey(t.due) === k && ls.find((l) => l.id === t.lead)).length,
    ]);
    return {
      cols: ['Date', 'New leads', 'Calls logged', 'Messages', 'Tasks completed'],
      rows: rows.reverse(),
      chart: rows.map((r) => ({ l: r[0].slice(5), v: r[1] })).reverse(),
    };
  },
};
PAGES.reports = (rt) => {
  if (rt.rep && S.rep.id !== rt.rep) {
    S.rep.id = rt.rep;
  }
  const id = S.rep.id,
    F = RF(),
    def = RDEF.find((r) => r[0] === id),
    res = REP[id]();
  const sb = optBranches();
  const sel = (n, arr, ph) =>
    `<select name="${n}" data-change="repF" aria-label="${ph}"><option value="">${ph}</option>${arr
      .map((a) => {
        const v = Array.isArray(a) ? a[0] : a,
          l = Array.isArray(a) ? a[1] : a;
        return `<option value="${esc(v)}"${F[n] === v ? ' selected' : ''}>${esc(l)}</option>`;
      })
      .join('')}</select>`;
  return (
    ph(
      'Reports & Analytics',
      esc(def[1]),
      `<button class="btn" data-act="repCsv">${ic('download')} Export CSV</button>`,
    ) +
    `<div class="grid" style="grid-template-columns:minmax(200px,250px) minmax(0,1fr);align-items:start"><div class="card"><div class="list" style="padding:6px">${RDEF.map((r, i) => `<div class="cl" tabindex="0" data-act="go" data-page="reports" data-rep="${r[0]}" style="border:0;border-radius:6px;cursor:pointer;padding:6px 10px;display:block;${r[0] === id ? 'background:var(--accent-soft);color:var(--accent);font-weight:500' : ''}">${i + 1}. ${esc(r[1])}</div>`).join('')}</div></div><div>${card(
      '',
      `<div class="tb" style="border:0;padding:0">${sel(
        'range',
        [
          ['7', 'Last 7 days'],
          ['30', 'Last 30 days'],
          ['month', 'This month'],
          ['all', 'All time'],
        ],
        'Date range',
      )}${sb.length > 1 ? sel('branch', sb, 'All branches') : ''}${sel('prog', optProgs(), 'All programmes')}${sel('cslr', optCslr(), 'All counsellors')}${sel('src', SRC_LIST, 'All sources')}${sel('status', ['Open', 'Converted', 'Lost', 'Closed'], 'All lead statuses')}<button class="btn sm ghost" data-act="repClear">Clear</button></div><p class="muted xs" style="margin:8px 0 0">Filters apply where relevant to the report. ${esc(res.note || '')}</p>`,
    )}<div style="height:14px"></div>${res.chart && res.chart.length ? card('Chart', bars(res.chart, { fmt: (v) => (/%/.test(def[1]) || ['r2', 'r5', 'r11', 'r21'].includes(id) ? v + '%' : v) })) : ''}${res.chart && res.chart.length ? '<div style="height:14px"></div>' : ''}${card(def[1], res.rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr>${res.cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${res.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="pager"><span>${res.rows.length} row${res.rows.length === 1 ? '' : 's'}</span></div>` : emptyBox('No data for these filters', 'Widen the date range or clear filters.'), { np: 1 })}</div></div>`
  );
};
CHG.repF = (el) => {
  S.rep.f[el.name] = el.value;
  if (!el.value) delete S.rep.f[el.name];
  render();
};
ACT.repClear = () => {
  S.rep.f = {};
  render();
};
ACT.repCsv = () => {
  const def = RDEF.find((r) => r[0] === S.rep.id),
    res = REP[S.rep.id]();
  addAudit('Report exported (CSV)', def[0], def[1]);
  openModal('csv', { name: def[1].toLowerCase().replace(/[^a-z]+/g, '-'), head: res.cols, rows: res.rows });
};
