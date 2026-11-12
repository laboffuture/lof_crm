/* req(): JSON requests with the CSRF header; error handling. */
function req(method, path, body) {
  return fetch(API + path, {
    method: method,
    headers: { 'content-type': 'application/json', 'x-lof-csrf': '1' },
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(function (r) {
    return r.text().then(function (t) {
      var j = null;
      try {
        j = t ? JSON.parse(t) : null;
      } catch (e) {}
      if (r.status === 401 && path.indexOf('/auth/') < 0) {
        signOut('Your session has ended – please sign in again.');
        throw new Error('Signed out');
      }
      if (
        r.status === 403 &&
        j &&
        j.details &&
        (j.details.code === 'password_change' || j.details.code === 'mfa_setup')
      ) {
        stageScreen(j.details.code);
        throw new Error('Signed out');
      }
      if (!r.ok) {
        var err = new Error((j && j.error) || 'HTTP ' + r.status);
        err.status = r.status;
        err.body = j;
        throw err;
      }
      return j;
    });
  });
}
/** Synchronous call – only for claiming record numbers inside the screens' synchronous handlers. */
function xhr(method, path, body) {
  var x = new XMLHttpRequest();
  x.open(method, API + path, false);
  x.setRequestHeader('content-type', 'application/json');
  x.setRequestHeader('x-lof-csrf', '1');
  x.send(body ? JSON.stringify(body) : null);
  if (x.status >= 400) throw new Error('Numbering service unavailable (' + x.status + ')');
  return JSON.parse(x.responseText);
}
