/* Custom fields, payment methods, notification rules and audit tab. */
/* custom fields */
CFG.fields = () =>
  card(
    'Custom CRM fields',
    table(
      'cfl',
      [
        { h: 'Label', f: (x) => `<b>${esc(x.n)}</b>` },
        { h: 'Type', f: (x) => x.t },
        { h: 'Options', f: (x) => esc(x.opts || '—') },
        { h: 'Required', f: (x) => (x.req ? 'Yes' : 'No') },
        { h: 'Module', f: (x) => x.mod },
        { h: 'Visible to', f: (x) => esc(x.view) },
        { h: 'Editable by', f: (x) => esc(x.edit) },
        { h: '', f: (x) => `<button class="btn sm danger" data-act="delField" data-n="${esc(x.n)}">Remove</button>` },
      ],
      S.cfg.fields,
      { all: 1, et: 'No custom fields' },
    ),
    { np: 1, act: `<button class="btn sm primary" data-act="mField">${ic('plus')} Add field</button>` },
  ) + `<p class="muted xs">Fields marked for Leads appear in the lead form and on the lead record.</p>`;
ACT.mField = () => openModal('field', {});
ACT.delField = (d) =>
  confirmBox(
    'Remove custom field',
    'Remove <b>' + esc(d.n) + '</b>? Values already stored on leads are kept in the audit trail.',
    'delField',
    d.n,
    'Remove',
    1,
  );
CONFIRM.delField = (n) => {
  S.cfg.fields = S.cfg.fields.filter((x) => x.n !== n);
  cfgSave('Custom field ' + n, 'removed');
};
MODALS.field = () => ({
  title: 'Add custom field',
  form: 'field',
  body: `<div class="fgrid">${F('Field label', 'n', { req: 1 })}${F('Type', 't', { opts: ['Text', 'Number', 'Date', 'Dropdown', 'Yes / No'], chg: 'fldType' })}<div id="optwrap" class="f full" style="display:none">${F('Dropdown options (comma separated)', 'opts', { full: 1 })}</div>${F('Applicable module', 'mod', { opts: ['Leads', 'Opportunities', 'Students'] })}${F('Visible to', 'view', { opts: ['All roles', 'Counsellor and above', 'Admissions team only'] })}${F('Editable by', 'edit', { opts: ['Counsellor, Centre Administrator', 'Centre Administrator only', 'System Administrator only'] })}${CK('Mandatory', 'req', false, { full: 1 })}</div>`,
});
CHG.fldType = (el) => {
  $('#optwrap').style.display = el.value === 'Dropdown' ? '' : 'none';
};
SUB.field = (d, f) => {
  if (!need(f, d, ['n'])) return;
  if (S.cfg.fields.find((x) => x.n.toLowerCase() === d.n.toLowerCase())) {
    setErr(f, 'n', 'A field with this label exists');
    return;
  }
  if (d.t === 'Dropdown' && !(d.opts || '').trim()) {
    setErr(f, 'opts', 'Add at least one option');
    return;
  }
  S.cfg.fields.push({ n: d.n, t: d.t, opts: d.opts || '', req: !!d.req, mod: d.mod, view: d.view, edit: d.edit });
  closeModal();
  cfgSave('Custom field ' + d.n, d.t + ' in ' + d.mod);
};
/* payment methods */
CFG.payMethods = () =>
  card(
    'Payment methods',
    `<div class="chips" style="margin-bottom:12px">${S.cfg.pm.map((m) => `<span class="chip on">${esc(m)} ${m === 'Cash' ? '' : `<a data-act="delPM" data-m="${esc(m)}" style="margin-left:6px" tabindex="0" aria-label="Remove ${esc(m)}">×</a>`}</span>`).join('')}</div><form class="row" data-submit="cfg_pm"><input name="m" placeholder="Add method, e.g. Cheque" aria-label="New method"><button class="btn sm" type="submit">Add</button></form><p class="muted xs">Cash is always available. Non-cash methods require a payment reference.</p>`,
  );
SUB.cfg_pm = (d) => {
  const m = (d.m || '').trim();
  if (!m) {
    toast('Enter a method name', 'warn');
    return;
  }
  if (S.cfg.pm.find((x) => x.toLowerCase() === m.toLowerCase())) {
    toast('Already exists', 'warn');
    return;
  }
  S.cfg.pm.push(m);
  cfgSave('Payment method ' + m, 'added');
};
ACT.delPM = (d) => {
  S.cfg.pm = S.cfg.pm.filter((x) => x !== d.m);
  addAudit('Configuration changed', 'Payment methods', 'Removed ' + d.m);
  render();
};
/* notifications */
CFG.notifs = () =>
  card(
    'Notification rules',
    cfgForm(
      'nt',
      `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Event</th><th>Recipients</th><th>In-app</th><th>Email</th><th>WhatsApp</th></tr></thead><tbody>${S.cfg.nrules.map((r, i) => `<tr><td>${esc(r[0])}</td><td><input name="rc${i}" value="${esc(r[1])}" aria-label="Recipients for ${esc(r[0])}" style="width:100%;min-width:200px"></td><td>${SW('a' + i, r[2])}</td><td>${SW('e' + i, r[3])}</td><td>${SW('w' + i, r[4])}</td></tr>`).join('')}</tbody></table></div><p class="muted xs">Email and WhatsApp are delivered when those integrations are live (Settings → Testing console). Escalation timing is set under SLA & Follow-ups.</p>`,
    ),
  );
SUB.cfg_nt = (d) => {
  S.cfg.nrules.forEach((r, i) => {
    r[1] = d['rc' + i] || r[1];
    r[2] = d['a' + i] ? 1 : 0;
    r[3] = d['e' + i] ? 1 : 0;
    r[4] = d['w' + i] ? 1 : 0;
  });
  cfgSave('Notification rules', 'updated');
};
CFG.audit = () => card('Audit & system logs', auditTable(), { np: 1 });
