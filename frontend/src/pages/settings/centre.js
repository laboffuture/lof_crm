/* Configuration centre frame, tab list, save helpers and General settings. */
const CTABS = [
  ['general', 'General'],
  ['branches', 'Branches'],
  ['staff', 'Staff & Users'],
  ['roles', 'Roles & Permissions'],
  ['programs', 'Programmes & Courses'],
  ['fees', 'Fees & Pricing'],
  ['discounts', 'Discounts'],
  ['workflows', 'Approval Workflows'],
  ['sources', 'Lead Sources & Campaigns'],
  ['routing', 'Lead Routing'],
  ['lifecycle', 'Lead Lifecycle'],
  ['sla', 'SLA & Follow-ups'],
  ['comms', 'Communication'],
  ['integrations', 'Integrations'],
  ['fields', 'Custom Fields'],
  ['payMethods', 'Payment Methods'],
  ['notifs', 'Notifications'],
  ['audit', 'Audit & System Logs'],
];
const swRow = (label, name, on, help) =>
  `<label class="row" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line2);gap:12px"><span>${label}${help ? `<br><span class="muted xs">${help}</span>` : ''}</span>${SW(name, on)}</label>`;
const cfgForm = (name, inner, o) =>
  `<form data-submit="cfg_${name}" novalidate>${inner}<div class="row" style="margin-top:16px"><button class="btn primary" type="submit">${(o && o.ok) || 'Save changes'}</button><button class="btn" type="button" data-act="cfgCancel">Cancel</button></div></form>`;
const cfgSave = (what, det) => {
  addAudit('Configuration changed', what, det);
  toast(what + ' saved', 'ok');
  render();
};
ACT.cfgCancel = () => {
  render();
  toast('Changes discarded');
};
PAGES.config = (rt) => {
  const tab = rt.tab || 'general';
  const nav = `<div class="card" style="align-self:start"><div class="list" style="padding:6px">${CTABS.map((t) => `<div class="cl" tabindex="0" data-act="go" data-page="config" data-tab="${t[0]}" style="border:0;border-radius:6px;cursor:pointer;padding:7px 10px;${tab === t[0] ? 'background:var(--accent-soft);color:var(--accent);font-weight:500' : ''}">${esc(t[1])}</div>`).join('')}</div></div>`;
  return (
    ph(
      'Configuration Centre',
      'Business rules are configurable here. Changes are audited. Items marked “needs confirmation” are not final business rules.',
    ) +
    `<div class="grid" style="grid-template-columns:minmax(190px,230px) minmax(0,1fr);align-items:start" id="cfgwrap">${nav}<div>${CFG[tab] ? CFG[tab]() : ''}</div></div>`
  );
};
const CFG = {};
CFG.general = () => {
  const g = S.cfg.general;
  return card(
    'General settings',
    cfgForm(
      'general',
      `<div class="fgrid">${F('Organisation', 'org', { v: g.org, req: 1 })}${F('Country', 'country', { v: g.country })}${F('Base currency', 'cur', { v: g.cur, opts: ['AED', 'INR', 'USD'] })}${F('Reporting currency', 'repCur', { v: g.repCur, opts: ['AED', 'INR'] })}${F('INR → AED rate (reports)', 'inr', { t: 'number', step: '0.0001', v: S.fx.INR, req: 1, help: 'Needs business confirmation' })}${F('Date format', 'dateFmt', { v: g.dateFmt, opts: ['DD MMM YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'] })}${F('Time zone', 'tz', { v: g.tz })}<div class="sec">ID & numbering</div>${F('Lead ID prefix', 'leadPrefix', { v: g.leadPrefix })}${F('Opportunity ID prefix', 'oppPrefix', { v: g.oppPrefix })}${F('Student registration ID format', 'studentFmt', { v: g.studentFmt, dis: 1, help: 'Recommended LOF-YY-000001. Generated after first successful enrolment; unique, non-editable, kept across branches and programmes.' })}</div>`,
    ),
  );
};
SUB.cfg_general = (d, f) => {
  if (!need(f, d, ['org', 'inr'])) return;
  if (!(+d.inr > 0)) {
    setErr(f, 'inr', 'Enter a rate above zero');
    return;
  }
  Object.assign(S.cfg.general, {
    org: d.org,
    country: d.country,
    cur: d.cur,
    repCur: d.repCur,
    dateFmt: d.dateFmt,
    tz: d.tz,
    leadPrefix: d.leadPrefix,
    oppPrefix: d.oppPrefix,
  });
  S.fx.INR = +d.inr;
  cfgSave('General settings', 'org, currency, numbering');
};
