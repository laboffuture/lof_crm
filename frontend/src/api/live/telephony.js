/* Exotel click-to-call and incoming-call pop-up. */
// Telephony: real click-to-call + real screen-pop
var _callLog = MODALS.callLog;
MODALS.callLog = function (m) {
  var x = _callLog(m);
  var live = modeOf('exotel') === 'live';
  x.body = x.body.replace(
    /<div class="banner">[\s\S]*?<\/div>/,
    '<div class="banner" style="justify-content:space-between">' +
      ic('phone') +
      '<span style="flex:1">' +
      (live
        ? 'Click-to-call rings your mobile first, then connects the parent. The call is logged automatically – add the outcome here.'
        : 'Exotel is in mock mode – dialling is logged but no call is placed.') +
      '</span><button type="button" class="btn sm primary" data-act="dialExotel" data-id="' +
      esc(m.id) +
      '">' +
      ic('phone') +
      ' Dial via Exotel</button></div>',
  );
  return x;
};
ACT.dialExotel = function (d) {
  req('POST', '/leads/' + encodeURIComponent(d.id) + '/click-to-call')
    .then(function (r) {
      toast(
        r.mode === 'live' ? 'Calling your phone now – answer to connect the parent' : 'Click-to-call sent (mock mode)',
        'ok',
      );
      setTimeout(function () {
        reload(false);
      }, 4000);
    })
    .catch(function (e) {
      toast(e.message, 'err');
    });
};
var _answer = ACT.answerCall;
ACT.answerCall = function () {
  if (S.callPopReal) {
    var id = S.callPop;
    S.callPop = null;
    S.callPopReal = false;
    go('lead', { id: id });
    return;
  }
  _answer();
};
var _callPop = window.callPopHtml;
window.callPopHtml = function () {
  var h = _callPop();
  return S.callPopReal
    ? h
        .replace('<span class="sim">Simulated</span>', '<span class="badge ok">Exotel</span>')
        .replace('Answer &amp; open lead', 'Open lead')
        .replace('Answer & open lead', 'Open lead')
    : h;
};
