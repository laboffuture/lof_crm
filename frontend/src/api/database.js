/* Settings → Database (System Administrator). */
CTABS.push(['database', 'Database']);
var DBV = {
  tables: null,
  name: 'leads',
  q: '',
  branch: '',
  test: false,
  offset: 0,
  page: null,
  loading: false,
  error: null,
};
var DB_LIMIT = 50;
function dbQuery() {
  return (
    '?name=' +
    encodeURIComponent(DBV.name) +
    '&q=' +
    encodeURIComponent(DBV.q) +
    '&branch=' +
    encodeURIComponent(DBV.branch) +
    (DBV.test ? '&test=1' : '')
  );
}
var dbSeq = 0;
function dbLoad() {
  var my = ++dbSeq; // only the latest request may update the screen (fast table switching)
  DBV.loading = true;
  DBV.error = null;
  var t = DBV.tables
    ? Promise.resolve(null)
    : req('GET', '/admin/db/tables').then(function (r) {
        DBV.tables = r.datasets;
      });
  return t
    .then(function () {
      return req('GET', '/admin/db/rows' + dbQuery() + '&limit=' + DB_LIMIT + '&offset=' + DBV.offset);
    })
    .then(function (r) {
      if (my === dbSeq) DBV.page = r;
    })
    .catch(function (e) {
      if (my === dbSeq) DBV.error = e.message;
    })
    .then(function () {
      if (my !== dbSeq) return;
      DBV.loading = false;
      safeRender();
    });
}
function dbDownload(path, fallbackName) {
  return fetch(API + path, { credentials: 'same-origin' }).then(function (r) {
    if (!r.ok)
      return r.json().then(function (j) {
        throw new Error((j && j.error) || 'HTTP ' + r.status);
      });
    var cd = r.headers.get('content-disposition') || '',
      m = /filename="([^"]+)"/.exec(cd);
    var truncated = r.headers.get('x-lof-truncated') === '1';
    return r.blob().then(function (b) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = m ? m[1] : fallbackName;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 1000);
      return { truncated: truncated };
    });
  });
}
CFG.database = function () {
  if (me().role !== 'System Administrator')
    return card('Database', emptyBox('Restricted', 'Only a System Administrator can open the database.'));
  if (!DBV.page && !DBV.loading && !DBV.error) {
    dbLoad();
  }
  var ds =
    (DBV.tables || []).find(function (d) {
      return d.name === DBV.name;
    }) || {};
  var groups = ['Business', 'Settings', 'System']
    .map(function (g) {
      var items = (DBV.tables || []).filter(function (d) {
        return d.group === g;
      });
      return (
        '<div class="sec" style="margin-top:6px">' +
        g +
        '</div><div class="chips">' +
        items
          .map(function (d) {
            return (
              '<a class="chip' +
              (d.name === DBV.name ? ' on' : '') +
              '" data-act="dbPick" data-n="' +
              d.name +
              '" tabindex="0">' +
              esc(d.label) +
              ' <span class="muted xs">' +
              d.rows.toLocaleString('en-US') +
              '</span></a>'
            );
          })
          .join('') +
        '</div>'
      );
    })
    .join('');
  var p = DBV.page,
    body;
  if (DBV.error) body = '<div class="banner" style="background:var(--crit-bg,#fdecec)">' + esc(DBV.error) + '</div>';
  else if (!p) body = emptyBox('Loading…', '');
  else if (!p.rows.length)
    body = emptyBox('No records', DBV.q || DBV.branch ? 'Clear the search or branch filter.' : 'This table is empty.');
  else
    body =
      '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
      p.columns
        .map(function (c) {
          return '<th>' + esc(c) + '</th>';
        })
        .join('') +
      '</tr></thead><tbody>' +
      p.rows
        .map(function (r) {
          var id = r[p.columns.indexOf(p.columns[0])];
          return (
            '<tr' +
            (ds.detail ? ' class="cl" style="cursor:pointer" data-act="dbRec" data-id="' + esc(id) + '"' : '') +
            '>' +
            r
              .map(function (v) {
                var t = v == null ? '' : String(v);
                return (
                  '<td class="' +
                  (typeof v === 'number' ? 'r num' : '') +
                  '" title="' +
                  esc(t) +
                  '">' +
                  esc(t.length > 80 ? t.slice(0, 80) + '…' : t) +
                  '</td>'
                );
              })
              .join('') +
            '</tr>'
          );
        })
        .join('') +
      '</tbody></table></div><div class="pager"><span>' +
      (p.offset + 1) +
      '–' +
      (p.offset + p.rows.length) +
      ' of ' +
      p.total.toLocaleString('en-US') +
      '</span><span class="row">' +
      '<button class="btn sm" data-act="dbPage" data-d="-1"' +
      (p.offset ? '' : ' disabled') +
      '>Previous</button><button class="btn sm" data-act="dbPage" data-d="1"' +
      (p.offset + p.rows.length < p.total ? '' : ' disabled') +
      '>Next</button></span></div>';
  var brs = (S.branches || [])
    .map(function (b) {
      return (
        '<option value="' + b.id + '"' + (DBV.branch === b.id ? ' selected' : '') + '>' + esc(b.name) + '</option>'
      );
    })
    .join('');
  var filters =
    '<form data-submit="dbSearch" class="tb" style="border:0;padding:0 0 12px;flex-wrap:wrap"><input type="search" name="q" value="' +
    esc(DBV.q) +
    '" placeholder="Search ' +
    esc(ds.label || '') +
    '" aria-label="Search" style="min-width:min(100%,260px)">' +
    (ds.branch
      ? '<select name="branch" aria-label="Branch"><option value="">All branches</option>' + brs + '</select>'
      : '') +
    (ds.hasTest
      ? '<label class="chk sm"><input type="checkbox" name="test"' +
        (DBV.test ? ' checked' : '') +
        '> Include test records</label>'
      : '') +
    '<button class="btn sm primary" type="submit">Search</button><span class="row" style="margin-left:auto"><button class="btn sm" type="button" data-act="dbCsv">' +
    ic('download') +
    ' Export CSV</button><button class="btn sm" type="button" data-act="dbBackup">' +
    ic('download') +
    ' Full backup (JSON)</button><button class="btn sm ghost" type="button" data-act="dbRefresh">Refresh</button></span></form>';
  return (
    '<div class="banner">' +
    ic('shield') +
    '<span>Read-only view of the live database. Passwords, two-step secrets and session tokens are never shown. Exports and backups are recorded in the audit log.</span></div>' +
    card('Tables', groups) +
    '<div style="height:14px"></div>' +
    card(
      esc(ds.label || 'Records') +
        (ds.note ? '<div class="muted xs" style="font-weight:400">' + esc(ds.note) + '</div>' : ''),
      filters + body,
    )
  );
};
ACT.dbPick = function (d) {
  DBV.name = d.n;
  DBV.offset = 0;
  DBV.q = '';
  DBV.branch = '';
  DBV.page = null;
  dbLoad();
  render();
};
ACT.dbPage = function (d) {
  DBV.offset = Math.max(0, DBV.offset + +d.d * DB_LIMIT);
  dbLoad();
};
ACT.dbRefresh = function () {
  DBV.tables = null;
  DBV.page = null;
  dbLoad();
  render();
};
SUB.dbSearch = function (d) {
  DBV.q = d.q || '';
  DBV.branch = d.branch || '';
  DBV.test = !!d.test;
  DBV.offset = 0;
  dbLoad();
};
ACT.dbCsv = function () {
  dbDownload('/admin/db/rows.csv' + dbQuery(), 'lof-' + DBV.name + '.csv')
    .then(function (r) {
      toast(
        r && r.truncated ? 'CSV downloaded – first 50,000 rows only; narrow the search for the rest' : 'CSV downloaded',
        r && r.truncated ? 'warn' : 'ok',
      );
    })
    .catch(function (e) {
      toast(e.message, 'err');
    });
};
ACT.dbBackup = function () {
  dbDownload('/admin/db/backup', 'lof-crm-backup.json')
    .then(function () {
      toast('Backup downloaded – keep it somewhere safe', 'ok');
    })
    .catch(function (e) {
      toast(e.message, 'err');
    });
};
ACT.dbRec = function (d) {
  if (!DBV.page || DBV.page.name !== DBV.name) return;
  req('GET', '/admin/db/record?name=' + encodeURIComponent(DBV.name) + '&id=' + encodeURIComponent(d.id))
    .then(function (r) {
      openModal('dbRec', { id: d.id, r: r });
    })
    .catch(function (e) {
      toast(e.message, 'err');
    });
};
MODALS.dbRec = function (m) {
  return {
    title:
      ((
        (DBV.tables || []).find(function (x) {
          return x.name === DBV.name;
        }) || {}
      ).label || 'Record') +
      ' – ' +
      m.id,
    size: 'lg',
    foot: '<button class="btn" data-act="closeModal">Close</button>',
    body:
      (m.r.meta
        ? '<p class="muted xs">Updated ' +
          esc(m.r.meta.updated_at || '') +
          (m.r.meta.updated_by ? ' by ' + esc(m.r.meta.updated_by) : '') +
          ' · version ' +
          esc(m.r.meta.version || 1) +
          (m.r.meta.is_test ? ' · test record' : '') +
          '</p>'
        : '') +
      '<pre class="mono sm" style="white-space:pre-wrap;word-break:break-word;max-height:60vh;overflow:auto;background:var(--bg2,#f6f7f9);padding:12px;border-radius:6px">' +
      esc(JSON.stringify(m.r.record, null, 2)) +
      '</pre>',
  };
};
