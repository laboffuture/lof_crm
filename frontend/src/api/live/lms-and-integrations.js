/* LMS monitor and integration settings. */
// LMS monitor + integration settings
ACT.testInteg = function (d) {
  var map = {
    web: ['website'],
    meta: ['meta'],
    wa: ['whatsapp'],
    tel: ['exotel'],
    lms: ['lms'],
    pay: ['telr', 'razorpay'],
    erp: ['erpnext'],
    cal: ['gcal'],
  };
  (map[d.k] || [d.k]).forEach(testIntegration);
};
function testIntegration(k) {
  req('POST', '/testing/integrations/' + k + '/test')
    .then(function (r) {
      if (k === 'lms') {
        S.lmsTestOk = !!r.ok && r.mode === 'live';
        safeRender();
      }
      toast(
        INTEG_LABEL[k] +
          ': ' +
          (r.ok ? 'connection OK' : 'failed – ' + r.error) +
          ' (' +
          r.mode +
          ')' +
          (r.note ? ' · ' + r.note : ''),
        r.ok ? (r.mode === 'live' ? 'ok' : 'warn') : 'err',
      );
    })
    .catch(function (e) {
      toast(e.message, 'err');
    });
}
CHG.outage = function (el) {
  req('POST', '/testing/flags', { moodleFail: el.checked })
    .then(function () {
      S.sim.moodleOutage = el.checked;
      toast(el.checked ? 'Mock LMS calls will fail until switched off' : 'Mock LMS outage off', 'warn');
      render();
    })
    .catch(function (e) {
      toast(e.message, 'err');
    });
};
var _integ = PAGES.integration;
PAGES.integration = function (rt) {
  var h = _integ(rt);
  return h
    .replace(
      /<div class="banner">[\s\S]*?<\/div>/,
      modeOf('lms') === 'live'
        ? ''
        : '<div class="banner">' +
            ic('alert') +
            'The LMS is in mock mode – switch it on under Settings → LMS Integration and set LMS_URL / LMS_TOKEN on the server to go live.</div>',
    )
    .replace(/Not connected – simulated/g, modeOf('lms') === 'live' ? 'Connected' : 'Mock mode');
};
// Website origins + Meta defaults are configurable alongside the existing integration fields
try {
  var web = INTEG.find(function (g) {
    return g[0] === 'web';
  });
  web[2].push(['origins', 'Allowed website origins (comma separated)']);
  var meta = INTEG.find(function (g) {
    return g[0] === 'meta';
  });
  meta[2].push(
    ['defaultBranch', 'Default branch for Meta leads (e.g. KRM)'],
    ['defaultProg', 'Default programme (e.g. COD)'],
  );
} catch (e) {}
var _cfgInteg = CFG.integrations;
CFG.integrations = function () {
  return _cfgInteg().replace(
    /<div class="banner">[\s\S]*?<\/div>/,
    '<div class="banner">' +
      ic('shield') +
      '<span>Credentials (tokens, keys, secrets) are stored as server secrets and never shown here. An integration runs <b>live</b> when it is enabled below and its secrets are set; otherwise it runs in mock mode. Check readiness in Settings → Testing console.</span></div>',
  );
};
