/* Configuration → Branches → Edit: a System Administrator may change a branch Short ID (not on the live site,
   see S.branchIdEdit). The server moves every record to the new ID first; the rest of the form is then saved
   under the new ID. Loaded after the other branch-form wrappers so it runs first. */
var _brSubShortId = SUB.branch;
SUB.branch = function (d, f) {
  var to = String(d.id || '')
    .trim()
    .toUpperCase();
  if (!d.oid || !S.branchIdEdit || !to || to === d.oid) return _brSubShortId(d, f);
  if (
    (S.branches || []).some(function (b) {
      return b.id === to;
    })
  ) {
    setErr(f, 'id', 'Short ID already exists');
    return;
  }
  req('POST', '/admin/branches/rename', { from: d.oid, to: to })
    .then(function (r) {
      if (S.modal && S.modal.t === 'branch') S.modal.id = r.to; // the open form now refers to the new ID
      return reload(true).then(function () {
        toast('Short ID changed ' + r.from + ' → ' + r.to + ' (' + r.records + ' records moved)', 'ok');
        SUB.branch(Object.assign({}, d, { oid: r.to, id: r.to }), f);
      });
    })
    .catch(function (e) {
      setErr(f, 'id', e.message);
    });
};
