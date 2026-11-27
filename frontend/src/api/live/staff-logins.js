/* Staff sign-in administration: temporary passwords, sign out everywhere. */
// Staff sign-in administration (System Administrator): temporary password, sign out everywhere
var _staffModal = MODALS.staff;
MODALS.staff = function (m) {
  var x = _staffModal(m);
  if (m.id && me().role === 'System Administrator' && m.id !== me().id) {
    x.body +=
      '<div class="card" style="margin-top:14px"><div class="hd"><h3>Sign-in</h3></div><div class="bd" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
      '<button class="btn sm" type="button" data-act="lofResetPw" data-id="' +
      esc(m.id) +
      '">Issue temporary password</button>' +
      '<button class="btn sm" type="button" data-act="lofResetPw" data-id="' +
      esc(m.id) +
      '" data-mfa="1">Temporary password + reset two-step</button>' +
      '<button class="btn sm" type="button" data-act="lofRevoke" data-id="' +
      esc(m.id) +
      '">Sign out everywhere</button>' +
      '<span class="muted xs">The person must change the temporary password at the next sign-in. All their sessions end.</span></div></div>';
  }
  return x;
};
ACT.lofResetPw = function (d) {
  req('POST', '/auth/reset-password', { staffId: d.id, resetMfa: d.mfa === '1' })
    .then(function (r) {
      openModal('lofTemp', { name: staffName(d.id), pw: r.temporaryPassword });
    })
    .catch(function (e) {
      toast(e.message, 'err');
    });
};
ACT.lofRevoke = function (d) {
  req('POST', '/auth/revoke-sessions', { staffId: d.id })
    .then(function () {
      toast(staffName(d.id) + ' was signed out on every device', 'ok');
    })
    .catch(function (e) {
      toast(e.message, 'err');
    });
};
MODALS.lofTemp = function (m) {
  return {
    title: 'Temporary password',
    size: 'sm2',
    body:
      '<p>Give this temporary password to <b>' +
      esc(m.name) +
      '</b> in person or by phone – not by e-mail. It is shown only once.</p><p style="font:600 18px ui-monospace,monospace;user-select:all;padding:10px;border:1px solid var(--bd);border-radius:6px;text-align:center">' +
      esc(m.pw) +
      '</p>',
    foot: '<button class="btn primary" data-act="closeModal">Done</button>',
  };
};
