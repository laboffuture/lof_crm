/* Delegated click/submit/change/input/keyboard handlers. */
/* ====== events ====== */
document.addEventListener('click', (e) => {
  if (!S) return;
  if (S.menu && !e.target.closest('.pm')) {
    S.menu = null;
    render();
  }
  if (S.searchOpen && !e.target.closest('.search')) {
    S.searchOpen = false;
    render();
  }
  if (e.target.closest('input,select,textarea,label.sw,label.chk')) return;
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled || el.classList.contains('disabled')) return;
  const f = ACT[el.dataset.act];
  if (f) {
    f(el.dataset, el, e);
  }
});
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('a[data-act],.tabs a,.seg a,.chip')) {
    e.preventDefault();
    e.target.click();
  }
  if (e.key === 'Escape' && S && S.modal && S.modal.t !== 'wizBusy') closeModal();
});
document.addEventListener('change', (e) => {
  const k = e.target.dataset && e.target.dataset.change;
  if (k && CHG[k]) CHG[k](e.target, e);
});
document.addEventListener('input', (e) => {
  const k = e.target.dataset && e.target.dataset.input;
  if (k && INP[k]) INP[k](e.target, e);
});
document.addEventListener('submit', (e) => {
  const f = e.target;
  if (f.dataset.submit) {
    e.preventDefault();
    const h = SUB[f.dataset.submit];
    if (h) h(fd(f), f, e);
  }
});
document.addEventListener('dragstart', (e) => {
  const el = e.target.closest('[data-drag]');
  if (el) {
    e.dataTransfer.setData('text/plain', el.dataset.drag);
    e.dataTransfer.effectAllowed = 'move';
  }
});
document.addEventListener('dragover', (e) => {
  const c = e.target.closest('[data-drop]');
  if (c) {
    e.preventDefault();
    c.classList.add('over');
  }
});
document.addEventListener('dragleave', (e) => {
  const c = e.target.closest('[data-drop]');
  if (c && !c.contains(e.relatedTarget)) c.classList.remove('over');
});
document.addEventListener('drop', (e) => {
  const c = e.target.closest('[data-drop]');
  if (c) {
    e.preventDefault();
    c.classList.remove('over');
    const id = e.dataTransfer.getData('text/plain');
    if (id && ACT[c.dataset.drop]) ACT[c.dataset.drop]({ id, to: c.dataset.to });
  }
});
INP.gsearch = (el) => {
  S.search = el.value;
  S.searchOpen = true;
  render();
};
const PAGES = {};
