/* Fixes to prototype behaviour found in QA. */
// Editing a branch / programme: the disabled Short ID field is not submitted, so carry it over
var _subBranch = SUB.branch;
SUB.branch = function (d, f) {
  if (d.oid && !d.id) d.id = d.oid;
  return _subBranch(d, f);
};
var _subProg = SUB.prog;
SUB.prog = function (d, f) {
  if (d.oid && !d.id) d.id = d.oid;
  return _subProg(d, f);
};
// Lost leads can be reopened too (prototype offered it only for Not Interested)
var _leadPage = PAGES.lead;
PAGES.lead = function (rt) {
  var h = _leadPage(rt),
    l = leadById(rt.id);
  if (l && l.status === 'Lost' && can('leads', 'E') && h.indexOf('data-act="reopen"') < 0)
    h = h.replace(
      /(<button class="btn" data-act="mEditLead"[^>]*>Edit<\/button>)/,
      '$1<button class="btn" data-act="reopen" data-id="' + esc(l.id) + '">Reopen</button>',
    );
  return h;
};
var _reopen = ACT.reopen;
ACT.reopen = function (d) {
  var l = leadById(d.id);
  if (l && l.status === 'Lost') {
    l.lostReason = '';
    l.status = 'Closed';
  }
  _reopen(d);
};
// Bulk assign: only open leads are assigned, so say how many actually were
SUB.bulkAssign = function (d, f) {
  if (!need(f, d, ['to', 'reason'])) return;
  var ids = Object.keys(S_sel),
    n = 0;
  ids.forEach(function (id) {
    var l = leadById(id);
    if (l && l.status === 'Open') {
      reassign(l, d.to, d.reason, 'Manual (bulk)');
      n++;
    }
  });
  S_sel = {};
  closeModal();
  toast(
    n
      ? n +
          ' lead(s) assigned to ' +
          staffName(d.to) +
          (n < ids.length ? ' – ' + (ids.length - n) + ' closed or converted lead(s) skipped' : '')
      : 'Nothing assigned – only open leads can be assigned',
    n ? 'ok' : 'warn',
  );
};

// Integrations are real now: remove the prototype's "simulated / not connected" wording everywhere
var liveText = function (k, live, mock) {
  return modeOf(k) === 'live' ? live : mock;
};
function deSim(h) {
  return h
    .replace(/<span class="sim">Simulated<\/span>/g, '')
    .replace(/\s?\((?:simulated|Simulated)[^)<]*\)/g, '')
    .replace(/Send \(simulated\)/g, 'Send')
    .replace(/Enabled – simulated/g, 'Enabled')
    .replace(/ · integration <span class="badge warn">not connected – simulated<\/span>/g, '')
    .replace(
      /WhatsApp Business is not connected – messages are recorded as simulated\./g,
      liveText(
        'whatsapp',
        'Messages are sent through WhatsApp Business.',
        'WhatsApp is in mock mode – messages are logged but not delivered.',
      ),
    )
    .replace(
      /Telephony \(([^)]*)\) is not connected\. Entries marked Simulated were created in this prototype; seeded calls are sample data\./g,
      liveText(
        'exotel',
        'Calls are logged automatically from Exotel; add the outcome on the lead.',
        'Exotel is in mock mode – log calls manually.',
      ),
    )
    .replace(
      /Payment gateway is not connected\. The payment is recorded manually and marked simulated\./g,
      'Record the payment taken at the counter. For online payment, finish the enrolment and use Payments → Send payment link.',
    )
    .replace(
      /WhatsApp and email providers are not connected; sending is simulated\./g,
      'Messages are sent by WhatsApp Business and e-mail when those integrations are live (Settings → Testing console).',
    )
    .replace(/Status: <span class="badge warn">[^<]*<\/span>/g, '')
    .replace(/Outcomes that record a call are logged as simulated\./g, 'The outcome is saved on the lead’s call log.')
    .replace(
      /Simulates the parent answering the WhatsApp availability request \(WhatsApp is not connected\)\./g,
      'Record the time the parent asked for.',
    )
    .replace(
      /Calendar sync \(Google\/Outlook\) is a configurable placeholder and is not connected\. /g,
      liveText('gcal', 'Scheduled calls are added to the team’s Google Calendar. ', ''),
    )
    .replace(
      /Downloads are disabled inside the prototype viewer, so the export is shown here\./g,
      'Copy the export below into a spreadsheet.',
    );
}
var _shell = window.shell;
window.shell = function () {
  return deSim(_shell());
};
var _toast = window.toast;
window.toast = function (msg, kind) {
  return _toast(
    String(msg)
      .replace(/\s?\((?:simulated|Simulated)[^)]*\)/g, '')
      .replace(/ \(simulated telephony\)/g, ''),
    kind,
  );
};
var _addAudit = window.addAudit;
window.addAudit = function (act, ref, det, by) {
  return _addAudit(
    String(act).replace(/\s?\(simulated\)/g, ''),
    ref,
    String(det || '').replace(/\s?\((?:simulated|Simulated)[^)]*\)/g, ''),
    by,
  );
};
// LMS monitor: list the other integrations with their real mode
var _integPage = PAGES.integration;
PAGES.integration = function (rt) {
  var h = _integPage(rt);
  var rows = Object.keys(INTEG_LABEL)
    .filter(function (k) {
      return k !== 'lms';
    })
    .map(function (k) {
      return (
        '<tr><td>' +
        INTEG_LABEL[k] +
        '</td><td>' +
        (modeOf(k) === 'live' ? bdg('Live', 'ok') : bdg('Mock', 'warn')) +
        '</td><td class="muted sm">Details: Settings → Testing console</td></tr>'
      );
    })
    .join('');
  return h.replace(/(<h3>Other integrations<\/h3>[\s\S]*?<tbody>)[\s\S]*?(<\/tbody>)/, '$1' + rows + '$2');
};
