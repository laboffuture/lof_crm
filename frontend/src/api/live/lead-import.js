// ---------------- Bulk lead import (Leads → Import leads)
// Excel (.xlsx) or CSV, one lead per row. The file is read here (no library: .xlsx is a zip of XML), every row is
// checked on the server first, and only then created – with the normal routing, duplicate check and first-call task.
var IMP_COLS = [
  ['student', 'Student name *', ['studentname', 'student', 'childname', 'child', 'name', 'studentfullname']],
  [
    'parent',
    'Parent name *',
    [
      'parentname',
      'parent',
      'guardianname',
      'guardian',
      'fathername',
      'mothername',
      'parentguardian',
      'parentguardianname',
    ],
  ],
  [
    'phone',
    'Mobile *',
    [
      'mobile',
      'phone',
      'mobilenumber',
      'phonenumber',
      'contact',
      'contactnumber',
      'parentmobile',
      'mobileno',
      'phoneno',
      'whatsappnumber',
      'parentphone',
    ],
  ],
  ['email', 'E-mail', ['email', 'emailaddress', 'parentemail', 'mail', 'emailid']],
  ['branch', 'Branch', ['branch', 'centre', 'center', 'location']],
  ['prog', 'Programme', ['programme', 'program', 'course', 'interestedprogramme', 'interestedin']],
  ['cat', 'Category', ['category', 'leadcategory']],
  ['dob', 'Date of birth', ['dateofbirth', 'dob', 'birthdate', 'birthday']],
  ['age', 'Age', ['age']],
  ['school', 'School', ['school', 'schoolname']],
  ['grade', 'Grade', ['grade', 'class', 'year', 'standard']],
  ['curr', 'Curriculum', ['curriculum', 'board', 'syllabus']],
  ['src', 'Source', ['source', 'leadsource']],
  ['camp', 'Campaign', ['campaign', 'event']],
  ['cslr', 'Counsellor', ['counsellor', 'counselor', 'assignedto', 'owner']],
  ['notes', 'Notes', ['notes', 'remarks', 'comments', 'note']],
  ['wa', 'WhatsApp consent', ['whatsappconsent', 'waconsent', 'whatsappoptin']],
  ['em', 'E-mail consent', ['emailconsent', 'emailoptin']],
];
var hdrKey = function (h) {
  return String(h == null ? '' : h)
    .toLowerCase()
    .replace(/[^a-z]/g, '');
};
function xmlEsc(v) {
  return String(v).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
function saveBlob(blob, name) {
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

// --- .xlsx reader (first sheet)
function readXlsx(buf) {
  var dv = new DataView(buf),
    u8 = new Uint8Array(buf),
    td = new TextDecoder();
  var eocd = buf.byteLength - 22;
  while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) return Promise.reject(new Error('This is not an Excel .xlsx file – save it as .xlsx or CSV'));
  var n = dv.getUint16(eocd + 10, true),
    p = dv.getUint32(eocd + 16, true),
    files = {};
  for (var i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    var nl = dv.getUint16(p + 28, true),
      el = dv.getUint16(p + 30, true),
      cl = dv.getUint16(p + 32, true);
    files[td.decode(u8.subarray(p + 46, p + 46 + nl))] = {
      method: dv.getUint16(p + 10, true),
      size: dv.getUint32(p + 20, true),
      at: dv.getUint32(p + 42, true),
    };
    p += 46 + nl + el + cl;
  }
  function text(name) {
    var f = files[name];
    if (!f) return Promise.resolve(null);
    var start = f.at + 30 + dv.getUint16(f.at + 26, true) + dv.getUint16(f.at + 28, true),
      data = u8.slice(start, start + f.size);
    if (f.method === 0) return Promise.resolve(td.decode(data));
    if (f.method !== 8 || typeof DecompressionStream === 'undefined')
      return Promise.reject(new Error('This browser cannot read the file – save it as CSV and upload that'));
    return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  }
  var parse = function (s) {
    return new DOMParser().parseFromString(s, 'application/xml');
  };
  var all = function (node, tag) {
    return Array.prototype.slice.call(node.getElementsByTagNameNS('*', tag));
  };
  return Promise.all([text('xl/workbook.xml'), text('xl/_rels/workbook.xml.rels'), text('xl/sharedStrings.xml')]).then(
    function (x) {
      if (!x[0]) throw new Error('This is not an Excel .xlsx file – save it as .xlsx or CSV');
      var sheet = all(parse(x[0]), 'sheet')[0];
      var rid =
        sheet &&
        (sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ||
          sheet.getAttribute('r:id'));
      var rel =
        x[1] &&
        all(parse(x[1]), 'Relationship').filter(function (r) {
          return r.getAttribute('Id') === rid;
        })[0];
      var target = rel ? rel.getAttribute('Target').replace(/^\/?(xl\/)?/, '') : 'worksheets/sheet1.xml';
      var shared = x[2]
        ? all(parse(x[2]), 'si').map(function (si) {
            return all(si, 't')
              .map(function (t) {
                return t.textContent;
              })
              .join('');
          })
        : [];
      return text('xl/' + target).then(function (s) {
        if (!s) throw new Error('The first sheet of the workbook is empty');
        var out = [];
        all(parse(s), 'row').forEach(function (r) {
          var rn = +r.getAttribute('r') || out.length + 1,
            cells = [];
          all(r, 'c').forEach(function (c, k) {
            var ref = c.getAttribute('r') || '',
              col = 0,
              m = ref.match(/^[A-Z]+/);
            if (m) {
              for (var j = 0; j < m[0].length; j++) col = col * 26 + (m[0].charCodeAt(j) - 64);
            } else col = k + 1;
            var t = c.getAttribute('t'),
              v = all(c, 'v')[0],
              val = '';
            if (t === 's') val = shared[+(v ? v.textContent : -1)] || '';
            else if (t === 'inlineStr')
              val = all(c, 't')
                .map(function (x2) {
                  return x2.textContent;
                })
                .join('');
            else if (t === 'b') val = v && v.textContent === '1' ? 'Yes' : 'No';
            else val = v ? v.textContent : '';
            cells[col - 1] = val;
          });
          out.push({ n: rn, cells: cells });
        });
        return out;
      });
    },
  );
}
// --- CSV reader (comma, semicolon or tab; quoted fields)
function readCsv(s) {
  s = s.replace(/^﻿/, '');
  var first = s.split(/\r?\n/)[0] || '',
    d = [',', ';', '\t'].sort(function (a, b) {
      return first.split(b).length - first.split(a).length;
    })[0];
  var rows = [],
    row = [],
    f = '',
    q = false;
  for (var i = 0; i < s.length; i++) {
    var ch = s[i];
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          f += '"';
          i++;
        } else q = false;
      } else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === d) {
      row.push(f);
      f = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(f);
      rows.push(row);
      row = [];
      f = '';
    } else f += ch;
  }
  if (f || row.length) {
    row.push(f);
    rows.push(row);
  }
  return rows.map(function (cells, k) {
    return { n: k + 1, cells: cells };
  });
}
/** Sheet rows → lead rows (by header names), with Excel date numbers turned into dates. */
function sheetToLeads(rows) {
  rows = rows.filter(function (r) {
    return r.cells.some(function (c) {
      return String(c == null ? '' : c).trim();
    });
  });
  if (!rows.length) throw new Error('The sheet is empty');
  var head = rows[0].cells.map(hdrKey),
    map = {},
    unknown = [];
  head.forEach(function (h, i) {
    if (!h) return;
    var col = IMP_COLS.filter(function (c) {
      return c[2].indexOf(h) >= 0;
    })[0];
    if (col && map[col[0]] === undefined) map[col[0]] = i;
    else unknown.push(rows[0].cells[i]);
  });
  var missing = ['student', 'parent', 'phone'].filter(function (k) {
    return map[k] === undefined;
  });
  if (missing.length)
    throw new Error(
      'The first row must have the column names. Missing: ' +
        missing
          .map(function (k) {
            return IMP_COLS.filter(function (c) {
              return c[0] === k;
            })[0][1].replace(' *', '');
          })
          .join(', ') +
        ' – download the template to see them',
    );
  var leads = rows.slice(1).map(function (r) {
    var o = { row: r.n };
    Object.keys(map).forEach(function (k) {
      var v = r.cells[map[k]];
      o[k] = v == null ? '' : String(v).trim();
    });
    if (/^\d{4,6}(\.\d+)?$/.test(o.dob || ''))
      o.dob = new Date(Date.UTC(1899, 11, 30) + Math.floor(+o.dob) * 864e5).toISOString().slice(0, 10);
    return o;
  });
  return { leads: leads, unknown: unknown };
}

// --- .xlsx template (stored zip, no compression)
function crc32(u8) {
  var t =
    crc32.t ||
    (crc32.t = (function () {
      var t2 = new Uint32Array(256);
      for (var n2 = 0; n2 < 256; n2++) {
        var c = n2;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t2[n2] = c >>> 0;
      }
      return t2;
    })());
  var c2 = 0xffffffff;
  for (var i = 0; i < u8.length; i++) c2 = t[(c2 ^ u8[i]) & 255] ^ (c2 >>> 8);
  return (c2 ^ 0xffffffff) >>> 0;
}
function zipStore(files) {
  var enc = new TextEncoder(),
    parts = [],
    cd = [],
    off = 0;
  files.forEach(function (f) {
    var nm = enc.encode(f.name),
      d = enc.encode(f.text),
      crc = crc32(d);
    var lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true);
    lh.setUint16(12, 0x21, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, d.length, true);
    lh.setUint32(22, d.length, true);
    lh.setUint16(26, nm.length, true);
    parts.push(new Uint8Array(lh.buffer), nm, d);
    var ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(14, 0x21, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, d.length, true);
    ch.setUint32(24, d.length, true);
    ch.setUint16(28, nm.length, true);
    ch.setUint32(42, off, true);
    cd.push(new Uint8Array(ch.buffer), nm);
    off += 30 + nm.length + d.length;
  });
  var size = cd.reduce(function (a, b) {
      return a + b.length;
    }, 0),
    e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, size, true);
  e.setUint32(16, off, true);
  return new Blob(parts.concat(cd, [new Uint8Array(e.buffer)]), {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
function sheetXml(rows, widths) {
  var L = function (i) {
    var s = '';
    i++;
    while (i) {
      var m = (i - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      i = Math.floor((i - 1) / 26);
    }
    return s;
  };
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>' +
    widths
      .map(function (w, i) {
        return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
      })
      .join('') +
    '</cols><sheetData>' +
    rows
      .map(function (r, ri) {
        return (
          '<row r="' +
          (ri + 1) +
          '">' +
          r
            .map(function (v, ci) {
              return v === '' || v == null
                ? ''
                : '<c r="' +
                    L(ci) +
                    (ri + 1) +
                    '" t="inlineStr"><is><t xml:space="preserve">' +
                    xmlEsc(v) +
                    '</t></is></c>';
            })
            .join('') +
          '</row>'
        );
      })
      .join('') +
    '</sheetData></worksheet>'
  );
}
/** Workbook parts for the template (also used by the test of the reader). */
window.lofLeadTemplate = function () {
  var brs = optBranches(),
    progs = (S.programs || []).filter(function (p) {
      return p.active !== false;
    });
  var srcs = ((S.cfg && S.cfg.sources) || [])
    .filter(function (s) {
      return s.en;
    })
    .map(function (s) {
      return s.n;
    });
  var cs = (S.staff || []).filter(function (s) {
    return (
      s.role === 'Counsellor' &&
      s.status !== 'Inactive' &&
      brs.some(function (b) {
        return b[0] === s.branch;
      })
    );
  });
  var cats = ['Hot', 'Warm', 'Cold'],
    yn = ['Yes', 'No'];
  var lists = [['Branch', 'Programme', 'Category', 'Source', 'Counsellor (branch)', 'Consent']];
  for (var i = 0; i < Math.max(brs.length, progs.length, cats.length, srcs.length, cs.length, 2); i++) {
    lists.push([
      brs[i] ? brs[i][1] : '',
      progs[i] ? progs[i].name : '',
      cats[i] || '',
      srcs[i] || '',
      cs[i] ? cs[i].name + ' (' + branchName(cs[i].branch) + ')' : '',
      yn[i] || '',
    ]);
  }
  var notes = [
    ['How to fill in the Leads sheet'],
    ['One lead per row. Keep the first row (column names) as it is.'],
    ['Required: Student name, Parent name, Mobile (with country code, e.g. +971 50 123 4567).'],
    ['Branch, Programme, Source and Category can be left empty – the values chosen in the import window are used.'],
    ['Date of birth as 31/05/2014. Consent columns: Yes or No (empty = Yes).'],
    [
      'Counsellor is optional – leads without one are assigned by the routing rules. Write the name only, e.g. Priya Nair.',
    ],
    ['Valid names are on the "Valid values" sheet. At most 500 rows per file.'],
  ];
  var M = 'http://schemas.openxmlformats.org/',
    ws = M + 'officeDocument/2006/relationships/worksheet',
    sh = 'application/vnd.openxmlformats-officedocument.spreadsheetml.';
  return zipStore([
    {
      name: '[Content_Types].xml',
      text:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="' +
        M +
        'package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="' +
        sh +
        'sheet.main+xml"/>' +
        [1, 2, 3]
          .map(function (k) {
            return '<Override PartName="/xl/worksheets/sheet' + k + '.xml" ContentType="' + sh + 'worksheet+xml"/>';
          })
          .join('') +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      text:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' +
        M +
        'package/2006/relationships"><Relationship Id="rId1" Type="' +
        M +
        'officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    },
    {
      name: 'xl/workbook.xml',
      text:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="' +
        M +
        'spreadsheetml/2006/main" xmlns:r="' +
        M +
        'officeDocument/2006/relationships"><sheets><sheet name="Leads" sheetId="1" r:id="rId1"/><sheet name="Valid values" sheetId="2" r:id="rId2"/><sheet name="How to fill" sheetId="3" r:id="rId3"/></sheets></workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      text:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' +
        M +
        'package/2006/relationships">' +
        [1, 2, 3]
          .map(function (k) {
            return '<Relationship Id="rId' + k + '" Type="' + ws + '" Target="worksheets/sheet' + k + '.xml"/>';
          })
          .join('') +
        '</Relationships>',
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      text: sheetXml(
        [
          IMP_COLS.map(function (c) {
            return c[1];
          }),
        ],
        IMP_COLS.map(function (c) {
          return Math.max(14, c[1].length + 4);
        }),
      ),
    },
    { name: 'xl/worksheets/sheet2.xml', text: sheetXml(lists, [22, 28, 12, 14, 34, 10]) },
    { name: 'xl/worksheets/sheet3.xml', text: sheetXml(notes, [110]) },
  ]);
};
window.lofReadSheet = function (buf, isCsv) {
  return (isCsv ? Promise.resolve(readCsv(new TextDecoder().decode(buf))) : readXlsx(buf)).then(sheetToLeads);
};
ACT.impTemplate = function () {
  saveBlob(window.lofLeadTemplate(), 'lead-import-template.xlsx');
};

// --- the import window: choose file → check every row → import
function impState() {
  if (!S.imp) {
    var brs = optBranches();
    S.imp = {
      opts: {
        branch: brs.length === 1 ? brs[0][0] : '',
        prog: '',
        src: 'Manual',
        cat: 'Warm',
        send: false,
        dups: false,
      },
    };
  }
  return S.imp;
}
ACT.openLeadImport = function () {
  S.imp = null;
  impState();
  openModal('leadImport', { step: 'pick' });
};
MODALS.leadImport = function (m) {
  var st = impState(),
    o = st.opts;
  var sel = function (k, label, v, opts, blank) {
    return (
      '<div class="f"><label for="imp_' +
      k +
      '">' +
      label +
      '</label><select id="imp_' +
      k +
      '" data-change="impOpt" data-k="' +
      k +
      '">' +
      (blank ? '<option value="">' + esc(blank) + '</option>' : '') +
      opts
        .map(function (x) {
          return '<option value="' + esc(x[0]) + '"' + (x[0] === v ? ' selected' : '') + '>' + esc(x[1]) + '</option>';
        })
        .join('') +
      '</select></div>'
    );
  };
  if (m.step === 'check' || m.step === 'done') {
    var res = st.res || { results: [], summary: {} },
      s = res.summary,
      done = m.step === 'done';
    // problem rows first, so a few errors are not buried under hundreds of ready rows
    var ord = { error: 0, duplicate: 1, ready: 2, created: 3 };
    var show = (
      done
        ? res.results.filter(function (r) {
            return r.status !== 'created';
          })
        : res.results.slice()
    ).sort(function (a, b) {
      return ord[a.status] - ord[b.status] || a.row - b.row;
    });
    var badge = function (r) {
      var k = {
        ready: ['Ready', 'ok'],
        created: ['Created', 'ok'],
        duplicate: [o.dups && !done ? 'Duplicate – will import' : 'Duplicate – skipped', 'warn'],
        error: ['Error', 'crit'],
      }[r.status] || [r.status, ''];
      return bdg(k[0], k[1]) + ' <span class="muted xs">' + esc(r.message) + '</span>';
    };
    var tbl = show.length
      ? '<div style="max-height:52vh;overflow:auto;border:1px solid var(--line);border-radius:8px"><table class="tbl"><thead><tr><th>Row</th><th>Student</th><th>Parent</th><th>Mobile</th><th>Branch</th><th>Programme</th><th>Check</th></tr></thead><tbody>' +
        show
          .map(function (r) {
            return (
              '<tr><td class="mono">' +
              r.row +
              '</td><td>' +
              esc(r.student) +
              '</td><td>' +
              esc(r.parent) +
              '</td><td class="mono xs">' +
              esc(r.phone) +
              '</td><td>' +
              esc(r.branch) +
              '</td><td>' +
              esc(r.prog) +
              '</td><td>' +
              badge(r) +
              '</td></tr>'
            );
          })
          .join('') +
        '</tbody></table></div>'
      : '';
    var head = done
      ? '<div class="banner" style="background:var(--ok-bg);color:var(--ok);display:block;margin-bottom:12px"><b>' +
        s.created +
        ' lead' +
        (s.created === 1 ? '' : 's') +
        ' created</b> from ' +
        esc(st.file) +
        '.' +
        (show.length
          ? ' The rows below were not imported – fix them in the sheet and import just those rows again.'
          : '') +
        '</div>'
      : '<p class="sm" style="margin-top:0"><b>' +
        esc(st.file) +
        '</b>: ' +
        s.total +
        ' row' +
        (s.total === 1 ? '' : 's') +
        ' – <b>' +
        s.ready +
        ' ready</b>' +
        (s.duplicates
          ? ', ' + s.duplicates + ' already in the CRM (' + (o.dups ? 'imported anyway' : 'skipped') + ')'
          : '') +
        (s.errors ? ', <b style="color:var(--crit)">' + s.errors + ' with errors</b> (skipped)' : '') +
        '. Nothing has been created yet.</p>' +
        (st.unknown && st.unknown.length
          ? '<p class="muted xs">Columns not used: ' + esc(st.unknown.join(', ')) + '</p>'
          : '');
    return {
      title: done ? 'Import finished' : 'Check the leads before importing',
      size: 'lg',
      body: head + tbl,
      foot: done
        ? (show.length
            ? '<button class="btn" data-act="impErrCsv">' + ic('download') + ' Rows not imported (CSV)</button>'
            : '') + '<button class="btn primary" data-act="impClose">Close</button>'
        : '<button class="btn" data-act="impBack">Back</button><button class="btn primary" data-act="impGo"' +
          (s.ready ? '' : ' disabled') +
          '>Import ' +
          s.ready +
          ' lead' +
          (s.ready === 1 ? '' : 's') +
          '</button>',
    };
  }
  var srcs = ((S.cfg && S.cfg.sources) || [])
    .filter(function (x) {
      return x.en;
    })
    .map(function (x) {
      return [x.n, x.n];
    });
  var progs = (S.programs || [])
    .filter(function (p) {
      return p.active !== false;
    })
    .map(function (p) {
      return [p.id, p.name];
    });
  return {
    title: 'Import leads from Excel',
    size: 'lg',
    body:
      '<p class="sm" style="margin-top:0">Upload an Excel (<b>.xlsx</b>) or <b>CSV</b> file with one lead per row – up to 500 at a time. <b>Student name</b>, <b>Parent name</b> and <b>Mobile</b> are required. Every row is checked first; nothing is created until you confirm.</p>' +
      '<p><button class="btn" data-act="impTemplate">' +
      ic('download') +
      ' Download Excel template</button></p>' +
      '<div class="sec">When a row leaves these empty, use</div><div class="fgrid">' +
      sel('branch', 'Branch', o.branch, optBranches(), 'Must be in the sheet') +
      sel('prog', 'Programme', o.prog, progs, 'Must be in the sheet') +
      sel('src', 'Source', o.src, srcs) +
      sel('cat', 'Category', o.cat, [
        ['Hot', 'Hot'],
        ['Warm', 'Warm'],
        ['Cold', 'Cold'],
      ]) +
      '</div>' +
      '<div class="f" style="margin-top:10px"><label style="display:flex;gap:8px;align-items:center;font-weight:400"><input type="checkbox" data-change="impOpt" data-k="send"' +
      (o.send ? ' checked' : '') +
      '> Send the automatic welcome WhatsApp / e-mail to these parents</label>' +
      '<label style="display:flex;gap:8px;align-items:center;font-weight:400;margin-top:6px"><input type="checkbox" data-change="impOpt" data-k="dups"' +
      (o.dups ? ' checked' : '') +
      '> Also import rows whose mobile or e-mail is already in the CRM</label></div>' +
      '<div class="f" style="margin-top:12px"><label for="impFile">Excel or CSV file</label><input type="file" id="impFile" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" data-change="impFile"></div>' +
      (st.leads
        ? '<p class="muted xs">' +
          esc(st.file) +
          ' is loaded (' +
          st.leads.length +
          ' rows). <a href="#" data-act="impCheck">Check it again</a> with these settings, or choose another file.</p>'
        : ''),
    foot: '<button class="btn" data-act="closeModal">Close</button>',
  };
};
CHG.impOpt = function (el) {
  var o = impState().opts,
    k = el.getAttribute('data-k');
  o[k] = el.type === 'checkbox' ? el.checked : el.value;
};
CHG.impFile = function (el) {
  var f = el.files && el.files[0],
    st = impState();
  if (!f) return;
  var isCsv = /\.csv$/i.test(f.name) || f.type === 'text/csv';
  if (!isCsv && !/\.xlsx$/i.test(f.name)) {
    toast('Use an .xlsx or .csv file (older .xls files: open in Excel and save as .xlsx)', 'err');
    el.value = '';
    return;
  }
  f.arrayBuffer()
    .then(function (buf) {
      return window.lofReadSheet(buf, isCsv);
    })
    .then(function (x) {
      if (!x.leads.length) throw new Error('The sheet has column names but no leads below them');
      if (x.leads.length > 500)
        throw new Error('The sheet has ' + x.leads.length + ' rows – at most 500 per file, split it');
      st.leads = x.leads;
      st.unknown = x.unknown;
      st.file = f.name;
      ACT.impCheck();
    })
    .catch(function (e) {
      el.value = '';
      toast(e.message || 'The file could not be read', 'err');
    });
};
function impBody(dry) {
  var st = impState(),
    o = st.opts;
  return {
    rows: st.leads,
    defaults: { branch: o.branch, prog: o.prog, src: o.src, cat: o.cat },
    sendMessages: !!o.send,
    allowDuplicates: !!o.dups,
    dryRun: dry,
  };
}
ACT.impCheck = function () {
  var st = impState();
  if (!st.leads) return;
  req('POST', '/leads/import', impBody(true))
    .then(function (r) {
      st.res = r;
      openModal('leadImport', { step: 'check' });
    })
    .catch(function (e) {
      toast(e.message, 'err');
    });
};
ACT.impBack = function () {
  openModal('leadImport', { step: 'pick' });
};
ACT.impGo = function () {
  var st = impState(),
    btn = document.querySelector('[data-act="impGo"]');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Importing…';
  }
  req('POST', '/leads/import', impBody(false))
    .then(function (r) {
      st.res = r;
      return reload(true).then(function () {
        openModal('leadImport', { step: 'done' });
      });
    })
    .catch(function (e) {
      if (btn) btn.disabled = false;
      toast(e.message, 'err');
    });
};
ACT.impClose = function () {
  S.imp = null;
  closeModal();
  go('leads');
};
ACT.impErrCsv = function () {
  var st = impState(),
    q = function (v) {
      v = String(v == null ? '' : v);
      return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
  var bad = st.res.results.filter(function (r) {
      return r.status !== 'created';
    }),
    byRow = {};
  st.leads.forEach(function (l) {
    byRow[l.row] = l;
  });
  var lines = [
    IMP_COLS.map(function (c) {
      return c[1].replace(' *', '');
    }).concat(['Problem']),
  ].concat(
    bad.map(function (r) {
      var l = byRow[r.row] || {};
      return IMP_COLS.map(function (c) {
        return l[c[0]] || '';
      }).concat([r.message]);
    }),
  );
  saveBlob(
    new Blob(
      [
        '﻿' +
          lines
            .map(function (l) {
              return l.map(q).join(',');
            })
            .join('\r\n'),
      ],
      { type: 'text/csv' },
    ),
    'leads-not-imported.csv',
  );
};
var _leadsImp = PAGES.leads;
PAGES.leads = function (rt) {
  var h = _leadsImp(rt);
  return can('leads', 'C')
    ? h.replace(
        '<button class="btn primary" data-act="openNewLead">',
        '<button class="btn" data-act="openLeadImport">' +
          ic('list') +
          ' Import leads</button><button class="btn primary" data-act="openNewLead">',
      )
    : h;
};
