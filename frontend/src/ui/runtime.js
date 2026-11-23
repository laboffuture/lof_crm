/* Action registries (ACT/SUB/CHG/INP), navigation, toasts, modals and form helpers. */
/* ====== runtime ====== */
const ACT = {},
  SUB = {},
  CHG = {},
  INP = {};
function go(page, p) {
  S.route = Object.assign({ page }, p || {});
  S.menu = null;
  S.searchOpen = false;
  S.search = '';
  S.shell = false;
  if (page !== 'lead') S.tab = 'overview';
  if (page !== 'student') S.stuTab = 'overview';
  render();
  const m = $('#main');
  if (m) m.scrollTop = 0;
}
function toast(msg, kind) {
  const c = $('#toasts');
  if (!c) return;
  const d = document.createElement('div');
  d.className = 'toast ' + (kind || '');
  d.textContent = msg;
  c.appendChild(d);
  setTimeout(() => d.remove(), kind === 'err' ? 5200 : 3600);
}
function openModal(t, p) {
  S.modal = Object.assign({ t }, p || {});
  S.menu = null;
  render();
  const f = $('.modal input:not([type=hidden]):not([disabled]),.modal select');
  if (f && !(p && p.noFocus))
    try {
      f.focus();
    } catch (e) {}
}
function closeModal() {
  S.modal = null;
  render();
}
function F(label, name, o) {
  o = o || {};
  const t = o.t || 'text',
    v = o.v == null ? '' : o.v,
    id = o.id || 'f_' + name;
  let inp;
  const at =
    (o.dis ? ' disabled' : '') + (o.chg ? ` data-change="${o.chg}"` : '') + (o.inp ? ` data-input="${o.inp}"` : '');
  if (o.opts)
    inp = `<select id="${id}" name="${name}"${at}>${o.blank != null ? `<option value="">${esc(o.blank)}</option>` : ''}${o.opts
      .map((x) => {
        const a = Array.isArray(x) ? x : [x, x];
        return `<option value="${esc(a[0])}"${String(a[0]) === String(v) ? ' selected' : ''}>${esc(a[1])}</option>`;
      })
      .join('')}</select>`;
  else if (t === 'textarea')
    inp = `<textarea id="${id}" name="${name}" rows="${o.rows || 3}" placeholder="${esc(o.ph || '')}"${at}>${esc(v)}</textarea>`;
  else
    inp = `<input id="${id}" name="${name}" type="${t}" value="${esc(v)}" placeholder="${esc(o.ph || '')}"${o.min != null ? ` min="${o.min}"` : ''}${o.max != null ? ` max="${o.max}"` : ''}${o.step ? ` step="${o.step}"` : ''}${at}>`;
  return `<div class="f${o.full ? ' full' : ''}" data-f="${name}"><label for="${id}">${esc(label)}${o.req ? ' <i>*</i>' : ''}</label>${inp}${o.help ? `<div class="help">${o.help}</div>` : ''}<div class="fe"></div></div>`;
}
const CK = (label, name, on, o) => {
  o = o || {};
  return `<label class="chk${o.full ? ' f full' : ''}"><input type="checkbox" name="${name}" id="c_${name}"${on ? ' checked' : ''}${o.chg ? ` data-change="${o.chg}"` : ''}${o.dis ? ' disabled' : ''}> <span>${label}</span></label>`;
};
const SW = (name, on, chg, attrs) =>
  `<label class="sw"><input type="checkbox" name="${name}"${on ? ' checked' : ''}${chg ? ` data-change="${chg}"` : ''} ${attrs || ''}><i></i></label>`;
function setErr(form, name, msg) {
  const f = form.querySelector(`[data-f="${name}"]`);
  if (!f) return;
  f.classList.toggle('bad', !!msg);
  const e = f.querySelector('.fe');
  if (e) e.textContent = msg || '';
}
function clearErrs(form) {
  $$('[data-f]', form).forEach((f) => {
    f.classList.remove('bad');
    const e = f.querySelector('.fe');
    if (e) e.textContent = '';
  });
}
function need(form, d, names) {
  clearErrs(form);
  let ok = true,
    first = null;
  names.forEach((n) => {
    if (!String(d[n] == null ? '' : d[n]).trim()) {
      setErr(form, n, 'This field is required');
      ok = false;
      if (!first) first = n;
    }
  });
  if (first) {
    const el = form.querySelector(`[name="${first}"]`);
    if (el) el.focus();
  }
  return ok;
}
const fd = (form) => Object.fromEntries(new FormData(form).entries());
const locIso = (v) => (v ? new Date(v + ':00+04:00').toISOString() : null);
const locVal = (iso) => {
  const d = new Date(iso),
    p = (n) => String(n).padStart(2, '0');
  const s = d.toLocaleString('en-CA', { timeZone: TZ, hour12: false }).replace(', ', 'T');
  return s.slice(0, 16);
};
