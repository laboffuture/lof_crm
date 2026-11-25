/* WhatsApp template and e-mail subject mapping. */
// Templates: map CRM templates to WhatsApp-approved templates and e-mail subjects
var _tpl = MODALS.tpl;
MODALS.tpl = function (m) {
  var x = _tpl(m);
  var t = m.id
    ? S.cfg.comms.find(function (y) {
        return y.id === m.id;
      })
    : {};
  x.body = x.body.replace(
    /(<div class="f full" data-f="body">)/,
    F('WhatsApp approved template name', 'waTemplate', {
      v: t.waTemplate || '',
      help: 'Needed for business-initiated WhatsApp messages. Body placeholders are sent as template parameters, in order.',
    }) +
      F('Template language', 'waLang', { v: t.waLang || 'en' }) +
      F('E-mail subject', 'subject', { v: t.subject || '' }) +
      '$1',
  );
  return x;
};
var _subTpl = SUB.tpl;
SUB.tpl = function (d, f) {
  var before = S.cfg.comms.length;
  _subTpl(d, f);
  if (S.modal) return;
  var t = d.oid
    ? S.cfg.comms.find(function (y) {
        return y.id === d.oid;
      })
    : S.cfg.comms.length > before
      ? S.cfg.comms[S.cfg.comms.length - 1]
      : null;
  if (t) {
    t.waTemplate = d.waTemplate || '';
    t.waLang = d.waLang || 'en';
    t.subject = d.subject || '';
  }
};
