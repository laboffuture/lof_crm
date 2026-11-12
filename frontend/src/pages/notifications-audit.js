/* Notifications and audit log. */
/* ====== integration monitor ====== */
/* ====== notifications & audit ====== */
PAGES.notifications = () => {
  const all = visNotifs(),
    f = S.ntFilter,
    ls = all.filter((n) => f === 'all' || !n.read);
  return (
    ph(
      'Notifications',
      all.filter((n) => !n.read).length + ' unread',
      `<span class="seg"><a class="${f === 'all' ? 'on' : ''}" data-act="ntF" data-f="all" tabindex="0">All</a><a class="${f === 'unread' ? 'on' : ''}" data-act="ntF" data-f="unread" tabindex="0">Unread</a></span><button class="btn" data-act="ntAll">Mark all as read</button>`,
    ) +
    card(
      '',
      ls.length
        ? ls
            .map(
              (n) =>
                `<div class="nt ${n.read ? '' : 'un'}" tabindex="0" data-act="ntOpen" data-id="${n.id}"><span class="sv ${n.sev === 'info' ? '' : n.sev}"></span><div style="flex:1;min-width:0"><div>${esc(n.text)}</div><div class="muted xs">${fDT(n.at)} · ${rel(n.at)}${n.read ? '' : ' · ' + bdg('Unread', 'info')}</div></div><span class="muted xs">Open ›</span></div>`,
            )
            .join('')
        : emptyBox('No notifications', 'You are all caught up.'),
      { np: 1 },
    ) +
    (can('configuration', 'V')
      ? `<p class="muted xs">Notification rules are configurable under Notification Settings.</p>`
      : '')
  );
};
Object.assign(ACT, {
  ntF(d) {
    S.ntFilter = d.f;
    render();
  },
  ntAll() {
    visNotifs().forEach((n) => (n.read = true));
    render();
    toast('All notifications marked as read', 'ok');
  },
  ntOpen(d) {
    const n = S.notifs.find((x) => x.id === d.id);
    n.read = true;
    const r = Object.assign({}, n.route);
    const p = r.page;
    delete r.page;
    if (p === 'lead' && !inScope(leadById(r.id).branch)) {
      render();
      return;
    }
    go(p, r);
  },
});
function auditTable() {
  const q = (S.auQ || '').toLowerCase();
  const rows = S.audit.filter(
    (a) => !q || [a.by, a.act, a.ref, a.det].some((x) => String(x).toLowerCase().includes(q)),
  );
  return (
    `<div class="tb"><input type="search" id="auq" data-input="auq" placeholder="Search user, action, reference" value="${esc(S.auQ || '')}" aria-label="Search audit log" style="min-width:min(100%,300px)"><span class="muted xs">Configuration changes, approvals, integration errors and sign-ins. Entries are append-only.</span></div>` +
    table(
      'aud',
      [
        { h: 'When', f: (a) => fDT(a.at), s: (a) => a.at },
        { h: 'User', f: (a) => esc(a.by) },
        { h: 'Action', f: (a) => esc(a.act) },
        { h: 'Reference', f: (a) => `<span class="mono">${esc(a.ref)}</span>` },
        { h: 'Detail', f: (a) => esc(a.det) },
      ],
      rows,
      { ps: 12 },
    )
  );
}
INP.auq = (el) => {
  S.auQ = el.value;
  render();
};
PAGES.audit = () => ph('Audit Logs', 'Who did what, and when') + card('', auditTable(), { np: 1 });
