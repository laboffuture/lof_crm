/* Message templates, consent and integration settings. */
/* comms */
CFG.comms = () => {
  const cr = S.cfg.consentReq;
  return (
    card(
      'Templates',
      table(
        'ct',
        [
          { h: 'Template', f: (t) => `<b>${esc(t.n)}</b><div class="muted xs">${esc(t.ev)}</div>` },
          { h: 'Channel', f: (t) => esc(t.ch) },
          { h: 'Branch', f: (t) => esc(t.branch) },
          { h: 'Message', f: (t) => `<span class="sm">${esc(t.body)}</span>` },
          { h: 'Automated', f: (t) => bdg(t.auto ? 'On' : 'Off', t.auto ? 'ok' : '') },
          { h: '', f: (t) => `<button class="btn sm" data-act="mTpl" data-id="${t.id}">Edit</button>` },
        ],
        S.cfg.comms,
        { all: 1 },
      ),
      { np: 1, act: `<button class="btn sm primary" data-act="mTpl">${ic('plus')} Add template</button>` },
    ) +
    `<p class="muted xs">Placeholders: {parent_name} {student_name} {programme} {branch} {counsellor} {student_id}. WhatsApp and email providers are not connected; sending is simulated.</p><div style="height:14px"></div>` +
    card(
      'Consent rules',
      cfgForm(
        'consent',
        `${swRow('Require WhatsApp consent before automated WhatsApp', 'wa', cr.wa)}${swRow('Require email consent before automated email', 'em', cr.em)}`,
      ),
    )
  );
};
SUB.cfg_consent = (d) => {
  S.cfg.consentReq = { wa: !!d.wa, em: !!d.em };
  cfgSave('Consent rules', 'WhatsApp ' + !!d.wa + ', email ' + !!d.em);
};
ACT.mTpl = (d) => openModal('tpl', { id: d.id });
MODALS.tpl = (m) => {
  const t = m.id
    ? S.cfg.comms.find((x) => x.id === m.id)
    : { n: '', ch: 'WhatsApp', ev: 'Manual', body: '', auto: false, branch: 'All' };
  return {
    title: m.id ? 'Edit template' : 'Add template',
    size: 'lg',
    form: 'tpl',
    body: `<input type="hidden" name="oid" value="${m.id || ''}"><div class="fgrid">${F('Template name', 'n', { v: t.n, req: 1 })}${F('Channel', 'ch', { v: t.ch, opts: ['WhatsApp', 'Email'] })}${F('Event', 'ev', { v: t.ev, opts: ['New lead', 'Enrolment completed', 'Payment received', 'Manual'] })}${F('Branch', 'branch', { v: t.branch, opts: ['All'].concat(S.branches.map((b) => b.name)) })}${F('Message', 'body', { t: 'textarea', rows: 5, v: t.body, req: 1, full: 1, help: 'Use {parent_name}, {student_name}, {programme}, {branch}, {counsellor}, {student_id}' })}${CK('Send automatically for this event', 'auto', t.auto, { full: 1 })}</div>`,
  };
};
SUB.tpl = (d, f) => {
  if (!need(f, d, ['n', 'body'])) return;
  const bad = (d.body.match(/\{[^}]*\}/g) || []).filter(
    (p) => !['{parent_name}', '{student_name}', '{programme}', '{branch}', '{counsellor}', '{student_id}'].includes(p),
  );
  if (bad.length) {
    setErr(f, 'body', 'Unknown placeholder: ' + bad[0]);
    return;
  }
  const o = { n: d.n, ch: d.ch, ev: d.ev, branch: d.branch, body: d.body, auto: !!d.auto };
  if (d.oid)
    Object.assign(
      S.cfg.comms.find((t) => t.id === d.oid),
      o,
    );
  else S.cfg.comms.push(Object.assign({ id: 'T' + (S.cfg.comms.length + 1) }, o));
  closeModal();
  cfgSave('Template ' + d.n, d.ch + ' · ' + d.ev);
};
/* integrations */
const INTEG = [
  ['web', 'Website lead capture', [['note', 'Note']], 'Captures website enquiries when enabled.'],
  [
    'meta',
    'Meta lead integration (Facebook / Instagram)',
    [['note', 'Note']],
    'Captures Meta lead-form submissions when enabled.',
  ],
  [
    'wa',
    'WhatsApp',
    [
      ['provider', 'Provider'],
      ['note', 'Note'],
    ],
    'Used for automated confirmation and availability requests.',
  ],
  [
    'tel',
    'Telephony',
    [
      ['provider', 'Provider', 'Exotel,Twilio'],
      ['note', 'Note'],
    ],
    'Click-to-call, incoming-call pop-up and call logs.',
  ],
  [
    'moodle',
    'LMS API',
    [
      ['url', 'API endpoint'],
      ['token', 'Token (placeholder)'],
      ['retryMax', 'Retry limit'],
      ['retryMin', 'Retry interval (min)'],
      ['notify', 'Failure alerts to'],
    ],
    'Student and enrolment sync.',
  ],
  [
    'pay',
    'Payment gateway',
    [
      ['provider', 'Provider', 'Not selected,To be confirmed'],
      ['mode', 'Mode', 'Test,Production'],
      ['webhook', 'Webhook URL'],
    ],
    'Gateway setup is separate from recording payments.',
  ],
  [
    'erp',
    'ERPNext Accounts',
    [
      ['url', 'ERPNext URL'],
      ['note', 'Note'],
    ],
    'Finance linkage subject to availability.',
  ],
  [
    'cal',
    'Calendar synchronisation',
    [
      ['provider', 'Provider', 'Google Calendar,Outlook'],
      ['note', 'Note'],
    ],
    'Placeholder – not implemented.',
  ],
];
CFG.integrations = () =>
  `<div class="banner">${ic('alert')}No external service is connected in this prototype. “Enabled” records the configuration intent; “Test connection” returns a simulated result.</div><div class="grid g2">${INTEG.map(
    (g) => {
      const c = S.cfg.integ[g[0]];
      return card(
        g[1],
        cfgForm(
          'integ_' + g[0],
          `<p class="muted sm" style="margin:0 0 10px">${g[3]} Status: ${bdg(['web', 'meta'].includes(g[0]) ? (c.on ? 'Enabled – simulated' : 'Disabled') : 'Not connected', 'warn')}</p>${swRow('Enabled', 'on', c.on)}<div class="fgrid" style="margin-top:10px">${g[2].map((f) => F(f[1], f[0], { v: c[f[0]], opts: f[2] ? f[2].split(',') : null, t: ['retryMax', 'retryMin'].includes(f[0]) ? 'number' : 'text' })).join('')}</div>`,
          { ok: 'Save' },
        ) +
          `<div style="margin-top:8px"><button class="btn sm" type="button" data-act="testInteg" data-k="${g[0]}">Test connection (simulated)</button></div>`,
      );
    },
  ).join('')}</div>` +
  card(
    'API retry & error handling',
    cfgForm(
      'retry',
      `<div class="fgrid">${F('Maximum retries', 'max', { t: 'number', min: 0, v: S.cfg.integ.retry.max })}${F('Retry interval (minutes)', 'intervalMin', { t: 'number', min: 1, v: S.cfg.integ.retry.intervalMin })}</div>`,
    ),
    { cls: 'x' },
  );
INTEG.forEach(
  (g) =>
    (SUB['cfg_integ_' + g[0]] = (d, f) => {
      const c = S.cfg.integ[g[0]];
      c.on = !!d.on;
      g[2].forEach((x) => {
        c[x[0]] = ['retryMax', 'retryMin'].includes(x[0]) ? +d[x[0]] : d[x[0]];
      });
      if (g[0] === 'moodle' && (!(c.retryMax >= 0) || !(c.retryMin >= 1))) {
        toast('Retry limit must be ≥ 0 and interval ≥ 1 minute', 'err');
        return;
      }
      cfgSave(g[1], 'enabled ' + c.on);
    }),
);
SUB.cfg_retry = (d) => {
  S.cfg.integ.retry = { max: +d.max, intervalMin: +d.intervalMin };
  cfgSave('API retry settings', d.max + ' retries / ' + d.intervalMin + ' min');
};
