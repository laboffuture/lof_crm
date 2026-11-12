/* Follow-up tasks, calendar and call log. */
/* ====== tasks, calendar, calls ====== */
PAGES.tasks = (rt) => {
  const tab = rt.tab || 'overdue',
    all = visTasks().filter((t) => leadById(t.lead));
  const pend = all.filter((t) => t.status === 'Pending');
  const sets = {
    overdue: pend.filter((t) => new Date(t.due) < NOW),
    today: pend.filter((t) => dayKey(t.due) === TODAY && new Date(t.due) >= NOW),
    upcoming: pend.filter((t) => dayKey(t.due) > TODAY),
    done: all.filter((t) => t.status === 'Done'),
  };
  const tabs = [
    ['overdue', 'Overdue (' + sets.overdue.length + ')'],
    ['today', 'Due today (' + sets.today.length + ')'],
    ['upcoming', 'Upcoming (' + sets.upcoming.length + ')'],
    ['done', 'Completed (' + sets.done.length + ')'],
  ];
  return (
    ph(
      'My Tasks & Follow-ups',
      me().role === 'Counsellor' ? 'Your calls and follow-ups' : 'Tasks across your branches',
      `<button class="btn" data-act="go" data-page="calendar">${ic('cal')} Calendar view</button>`,
    ) +
    tabsBar(tabs, tab, 'tTab') +
    card(
      '',
      table(
        'tasks' + tab,
        taskCols(),
        sets[tab].sort((a, b) => new Date(a.due) - new Date(b.due)),
        { ps: 12, et: tab === 'overdue' ? 'Nothing overdue' : 'No tasks here', ed: 'Great – you are up to date.' },
      ),
      { np: 1 },
    )
  );
};
ACT.tTab = (d) => {
  S.route.tab = d.k;
  render();
};
PAGES.calendar = () => {
  const [y, m] = S.calMonth.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)),
    dow = (first.getUTCDay() + 6) % 7,
    dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const tasks = visTasks().filter((t) => t.status !== 'Cancelled');
  const cells = [];
  for (let i = 0; i < dow; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  const dayT = (k) => tasks.filter((t) => dayKey(t.due) === k);
  const sel = dayT(S.calSel).sort((a, b) => new Date(a.due) - new Date(b.due));
  return (
    ph(
      'Follow-up Calendar',
      'Scheduled calls, follow-ups and parent-requested slots',
      `<button class="btn sm" data-act="calNav" data-n="-1">‹ Prev</button><b>${new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</b><button class="btn sm" data-act="calNav" data-n="1">Next ›</button>`,
    ) +
    `<div class="grid" style="grid-template-columns:minmax(0,2fr) minmax(260px,1fr)"><div class="card"><div class="bd"><div class="cal">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((x) => `<div class="dh">${x}</div>`).join('')}${cells
      .map((k) =>
        k
          ? `<div class="d${k === TODAY ? ' today' : ''}${k === S.calSel ? ' sel' : ''}" tabindex="0" data-act="calSel" data-k="${k}"><b>${+k.slice(8)}</b>${dayT(
              k,
            )
              .slice(0, 2)
              .map(
                (t) =>
                  `<span class="ch ${t.status === 'Done' ? 'dn' : new Date(t.due) < NOW ? 'od' : ''}">${fT(t.due)} ${esc(leadById(t.lead).student.split(' ')[0])}</span>`,
              )
              .join('')}${dayT(k).length > 2 ? `<span class="muted xs">+${dayT(k).length - 2} more</span>` : ''}</div>`
          : '<div class="d out"></div>',
      )
      .join(
        '',
      )}</div></div></div>${card(fD(S.calSel + 'T12:00:00+04:00'), sel.length ? `<div class="list" style="margin:-14px">${sel.map((t) => `<div><span><b>${fT(t.due)}</b> · <a ${lgo(t.lead)}>${esc(leadById(t.lead).student)}</a><br><span class="muted xs">${esc(t.type)} · ${esc(staffName(t.cslr))}</span></span>${t.status === 'Pending' ? (new Date(t.due) < NOW ? bdg('Overdue', 'crit') : bdg('Scheduled', 'info')) : bdg('Done', 'ok')}</div>`).join('')}</div>` : emptyBox('No tasks on this day', 'Schedule a follow-up from a lead.'))}</div>`
  );
};
Object.assign(ACT, {
  calNav(d) {
    let [y, m] = S.calMonth.split('-').map(Number);
    m += +d.n;
    if (m < 1) {
      m = 12;
      y--;
    }
    if (m > 12) {
      m = 1;
      y++;
    }
    S.calMonth = y + '-' + String(m).padStart(2, '0');
    render();
  },
  calSel(d) {
    S.calSel = d.k;
    render();
  },
});
PAGES.calls = (rt) => {
  const f = S.callF || '';
  const cs = S.calls.filter((c) => {
    const l = leadById(c.lead);
    return l && inScope(l.branch) && (!f || c.dir === f);
  });
  return (
    ph(
      'Call Logs',
      'Incoming and outgoing calls recorded against leads',
      `<select data-change="callF" aria-label="Direction"><option value="">All directions</option><option${f === 'Incoming' ? ' selected' : ''}>Incoming</option><option${f === 'Outgoing' ? ' selected' : ''}>Outgoing</option></select>`,
    ) +
    `<div class="banner">${ic('phone')}Telephony (${esc(S.cfg.integ.tel.provider)}) is not connected. Entries marked Simulated were created in this prototype; seeded calls are sample data.</div>` +
    card(
      '',
      table(
        'calls',
        [
          { h: 'Date / time', f: (c) => fDT(c.at), s: (c) => c.at },
          { h: 'Direction', f: (c) => esc(c.dir), s: (c) => c.dir },
          {
            h: 'Lead',
            f: (c) => {
              const l = leadById(c.lead);
              return `<a ${lgo(l.id)}>${esc(l.student)}</a>`;
            },
          },
          { h: 'Caller → Called', f: (c) => `<span class="mono">${esc(c.from)} → ${esc(c.to)}</span>` },
          { h: 'Duration', f: (c) => c.dur + ' min' },
          { h: 'Status', f: (c) => esc(c.status) },
          { h: 'Outcome', f: (c) => esc(c.outcome) },
          { h: 'First call', f: (c) => (c.first ? bdg('Yes', 'info') : '—') },
          { h: 'Recording / notes', f: (c) => esc(c.rec || c.notes) + (c.sim ? ' ' + SIMTAG : '') },
        ],
        cs,
        { ps: 12, row: (c) => lgo(c.lead) },
      ),
      { np: 1 },
    )
  );
};
CHG.callF = (el) => {
  S.callF = el.value;
  render();
};

CHG.lview = (el) => {
  S.tbl.leads = { page: 1, sort: null, dir: 1 };
  go('leads', { preset: el.value });
};
