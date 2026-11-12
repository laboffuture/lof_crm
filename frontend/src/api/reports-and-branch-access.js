// ==================================================================
// PDF EXPORTS & MULTI-FORMAT REPORTING MODULE
// Enables downloadable PDF reports, Excel, CSV, JSON, and print views
// across all 22 CRM reports and payment records.
// ==================================================================
// ==================================================================
// BRANCH ACCESS CONTROL HELPERS
// Restricts branch selection in dropdowns/filters exclusively to
// System Admins and Management. Standard users can only view data
// for their assigned branches.
// ==================================================================
function isBranchPrivileged() {
  var u = typeof me === 'function' ? me() : null;
  if (!u) return true;
  return u.role === 'System Administrator' || u.role === 'Management';
}

function userAssignedBranch() {
  var u = typeof me === 'function' ? me() : null;
  return u ? u.branch : null;
}

function userAssignedBranches() {
  var u = typeof me === 'function' ? me() : null;
  if (!u) return [];
  if (isBranchPrivileged()) {
    return (typeof S !== 'undefined' && S && S.branches ? S.branches : []).map(function (b) {
      return b.id;
    });
  }
  if (typeof S !== 'undefined' && S && S.scope && Array.isArray(S.scope[u.id])) {
    return S.scope[u.id];
  }
  return u.branch ? [u.branch] : [];
}

function userAssignedBranchNames() {
  var brs = userAssignedBranches();
  if (!brs.length) return '';
  return brs
    .map(function (id) {
      return typeof branchName === 'function' ? branchName(id) : id;
    })
    .join(', ');
}

function branchLockedBadge() {
  var names = userAssignedBranchNames();
  return (
    '<span class="badge info" style="font-weight:600;padding:5px 11px;background:var(--accent-soft);color:var(--accent);border:1px solid var(--accent);border-radius:6px;display:inline-flex;align-items:center;gap:6px">' +
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>' +
    'Location: ' +
    (typeof esc === 'function' ? esc(names) : names) +
    ' (Assigned)</span>'
  );
}

function isReceptionStaff() {
  var u = typeof me === 'function' ? me() : null;
  return !!(u && u.role === 'Reception');
}

function receptionBranch() {
  return isReceptionStaff() ? userAssignedBranch() : null;
}

function setupReportExports() {
  // Ensure Reception role has view permission on reports
  if (typeof S !== 'undefined' && S && S.perms && S.perms.reports) {
    S.perms.reports.Reception = 'V';
  }

  function downloadBlob(blob, filename) {
    var a = document.createElement('a');
    var url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1200);
  }

  function sanitizePdf(str) {
    return String(str == null ? '' : str)
      .replace(/₹/g, 'INR ')
      .replace(/[—–]/g, '-')
      .replace(/[•·]/g, '*')
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ');
  }

  function escapePdf(str) {
    return sanitizePdf(str).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  function isNumericCol(colName, rows, colIdx) {
    if (
      /(%|amt|amount|total|collected|target|revenue|balance|paid|price|fee|rate|count|leads|breaches|waiting|min|utilisation)/i.test(
        colName,
      )
    )
      return true;
    var numCount = 0;
    for (var r = 0; r < Math.min(rows.length, 10); r++) {
      var val = String(rows[r] && rows[r][colIdx] != null ? rows[r][colIdx] : '')
        .trim()
        .replace(/^[₹$€AEDINR\s,]+/, '')
        .replace(/%$/, '');
      if (val !== '' && !isNaN(Number(val))) numCount++;
    }
    return numCount >= 3;
  }

  // A PDF is built from one or more sections (a report each). Every section starts on a new page with its own
  // orientation; page numbers run across the whole document. buildPdfBlob(options) = a one-section document.
  function layoutPdfSection(options) {
    var cols = options.cols || [];
    var rows = options.rows || [];
    var isLandscape = options.landscape != null ? options.landscape : cols.length > 6;

    var pageWidth = isLandscape ? 841.89 : 595.28;
    var pageHeight = isLandscape ? 595.28 : 841.89;
    var margin = 36;
    var contentWidth = pageWidth - margin * 2;

    var colAlignRight = cols.map(function (c, i) {
      return isNumericCol(c, rows, i);
    });

    var minWidth = 45;
    var weights = cols.map(function (c, i) {
      var max = String(c).length;
      for (var r = 0; r < Math.min(rows.length, 40); r++) {
        var len = String(rows[r] && rows[r][i] != null ? rows[r][i] : '').length;
        if (len > max) max = len;
      }
      return Math.max(max, 5);
    });
    var totalWeight =
      weights.reduce(function (a, b) {
        return a + b;
      }, 0) || 1;
    var colWidths = weights.map(function (w) {
      return Math.max(minWidth, (w / totalWeight) * contentWidth);
    });
    var curTotal =
      colWidths.reduce(function (a, b) {
        return a + b;
      }, 0) || 1;
    var factor = contentWidth / curTotal;
    colWidths = colWidths.map(function (w) {
      return w * factor;
    });

    var rowHeight = 18;
    var headerHeight = 22;
    var firstPageTop = pageHeight - margin - 75;
    var otherPageTop = pageHeight - margin - 35;
    var bottomLimit = margin + 25;

    var firstPageCap = Math.max(1, Math.floor((firstPageTop - bottomLimit - headerHeight) / rowHeight));
    var otherPageCap = Math.max(1, Math.floor((otherPageTop - bottomLimit - headerHeight) / rowHeight));

    var pagesRows = [];
    var curIdx = 0;
    while (curIdx < rows.length || pagesRows.length === 0) {
      var limit = pagesRows.length === 0 ? firstPageCap : otherPageCap;
      pagesRows.push(rows.slice(curIdx, curIdx + limit));
      curIdx += limit;
      if (curIdx >= rows.length) break;
    }
    return {
      opt: options,
      cols: cols,
      pages: pagesRows,
      w: pageWidth,
      h: pageHeight,
      margin: margin,
      contentWidth: contentWidth,
      colWidths: colWidths,
      colAlignRight: colAlignRight,
      rowHeight: rowHeight,
      headerHeight: headerHeight,
    };
  }

  function renderPdfPage(L, pIdx, pageNo, totalPages) {
    var options = L.opt,
      cols = L.cols,
      pRows = L.pages[pIdx];
    var pageWidth = L.w,
      pageHeight = L.h,
      margin = L.margin,
      contentWidth = L.contentWidth;
    var colWidths = L.colWidths,
      colAlignRight = L.colAlignRight,
      rowHeight = L.rowHeight,
      headerHeight = L.headerHeight;
    var stream = [];
    var curY = pageHeight - margin;

    if (pIdx === 0) {
      // Branding Header
      stream.push('0.114 0.208 0.341 rg'); // #1d3557 deep navy
      stream.push('BT /F2 15 Tf ' + margin + ' ' + (curY - 14) + ' Td (Lab of Future CRM) Tj ET');

      // Date
      stream.push('0.45 0.50 0.55 rg');
      var dateStr = options.date || new Date().toLocaleString('en-GB');
      stream.push(
        'BT /F1 8.5 Tf ' +
          (pageWidth - margin - 180).toFixed(2) +
          ' ' +
          (curY - 12) +
          ' Td (' +
          escapePdf('Generated: ' + dateStr) +
          ') Tj ET',
      );
      curY -= 26;

      // Report Title
      stream.push('0.08 0.12 0.18 rg');
      stream.push(
        'BT /F2 13 Tf ' + margin + ' ' + (curY - 13) + ' Td (' + escapePdf(options.title || 'Report') + ') Tj ET',
      );
      curY -= 20;

      // Filter summary / Subtitle
      var filterLine = [options.filters, options.note ? 'Note: ' + options.note : ''].filter(Boolean).join('   |   ');
      if (filterLine) {
        stream.push('0.40 0.45 0.50 rg');
        stream.push(
          'BT /F1 8.5 Tf ' + margin + ' ' + (curY - 9) + ' Td (' + escapePdf(filterLine.slice(0, 150)) + ') Tj ET',
        );
        curY -= 16;
      }
      curY -= 6;
    } else {
      // Continuation Header
      stream.push('0.35 0.40 0.45 rg');
      stream.push(
        'BT /F2 9.5 Tf ' +
          margin +
          ' ' +
          (curY - 12) +
          ' Td (' +
          escapePdf((options.title || 'Report') + ' (continued)') +
          ') Tj ET',
      );
      curY -= 22;
    }

    // Table Header Background
    stream.push('0.114 0.208 0.341 rg');
    stream.push(
      margin + ' ' + (curY - headerHeight).toFixed(2) + ' ' + contentWidth.toFixed(2) + ' ' + headerHeight + ' re f',
    );

    // Column Headers Text
    stream.push('1 1 1 rg');
    var colX = margin;
    for (var c = 0; c < cols.length; c++) {
      var colW = colWidths[c];
      var title = String(cols[c] == null ? '' : cols[c]);
      var isRight = colAlignRight[c];
      var approxCharWidth = 5.2;
      var displayTitle = title.slice(0, Math.max(4, Math.floor((colW - 8) / approxCharWidth)));
      var textX = isRight ? colX + colW - 6 - displayTitle.length * approxCharWidth : colX + 6;
      var textY = curY - headerHeight + 6.5;

      stream.push(
        'BT /F2 8.5 Tf ' + textX.toFixed(2) + ' ' + textY.toFixed(2) + ' Td (' + escapePdf(displayTitle) + ') Tj ET',
      );
      colX += colW;
    }
    curY -= headerHeight;

    // Table Rows
    for (var r = 0; r < pRows.length; r++) {
      var row = pRows[r];
      var isEven = r % 2 === 1;

      if (isEven) {
        stream.push('0.965 0.975 0.985 rg');
        stream.push(
          margin + ' ' + (curY - rowHeight).toFixed(2) + ' ' + contentWidth.toFixed(2) + ' ' + rowHeight + ' re f',
        );
      }

      // Row separator line
      stream.push('0.88 0.90 0.92 RG 0.5 w');
      stream.push(
        margin +
          ' ' +
          (curY - rowHeight).toFixed(2) +
          ' m ' +
          (margin + contentWidth).toFixed(2) +
          ' ' +
          (curY - rowHeight).toFixed(2) +
          ' l S',
      );

      // Cell text
      stream.push('0.12 0.15 0.20 rg');
      colX = margin;
      for (var cIdx = 0; cIdx < cols.length; cIdx++) {
        var cW = colWidths[cIdx];
        var val = sanitizePdf(row[cIdx]);
        var rightAlign = colAlignRight[cIdx];
        var charW = 4.8;
        var maxChars = Math.max(4, Math.floor((cW - 10) / charW));
        var displayVal = val.length > maxChars ? val.slice(0, maxChars - 3) + '...' : val;
        var cellY = curY - rowHeight + 5.5;
        var cTextX = rightAlign ? colX + cW - 6 - displayVal.length * charW : colX + 6;

        stream.push(
          'BT /F1 8 Tf ' + cTextX.toFixed(2) + ' ' + cellY.toFixed(2) + ' Td (' + escapePdf(displayVal) + ') Tj ET',
        );
        colX += cW;
      }

      curY -= rowHeight;
    }

    // Outer table border
    stream.push('0.80 0.83 0.87 RG 0.75 w');
    var tableH = headerHeight + pRows.length * rowHeight;
    stream.push(margin + ' ' + curY.toFixed(2) + ' ' + contentWidth.toFixed(2) + ' ' + tableH.toFixed(2) + ' re S');

    if (!pRows.length) {
      stream.push('0.45 0.50 0.55 rg');
      stream.push(
        'BT /F1 9 Tf ' +
          margin +
          ' ' +
          (curY - 18).toFixed(2) +
          ' Td (' +
          escapePdf(options.empty || 'No records for the selected filters.') +
          ') Tj ET',
      );
    }

    // Page Footer
    stream.push('0.50 0.55 0.60 rg');
    stream.push(
      'BT /F1 7.5 Tf ' +
        margin +
        ' ' +
        margin +
        ' Td (' +
        escapePdf('Lab of Future CRM   *   Confidential') +
        ') Tj ET',
    );
    stream.push(
      'BT /F1 7.5 Tf ' +
        (pageWidth - margin - 70).toFixed(2) +
        ' ' +
        margin +
        ' Td (Page ' +
        pageNo +
        ' of ' +
        totalPages +
        ') Tj ET',
    );

    return stream.join('\n');
  }

  function assemblePdf(pages) {
    var catalogId = 1,
      pagesRootId = 2,
      fontNormId = 3,
      fontBoldId = 4;
    var pageObjIds = [],
      contentObjIds = [],
      nextId = 5;
    pages.forEach(function () {
      pageObjIds.push(nextId++);
      contentObjIds.push(nextId++);
    });

    var objTable = {};
    objTable[catalogId] = '<< /Type /Catalog /Pages ' + pagesRootId + ' 0 R >>';
    objTable[pagesRootId] =
      '<< /Type /Pages /Kids [' +
      pageObjIds
        .map(function (id) {
          return id + ' 0 R';
        })
        .join(' ') +
      '] /Count ' +
      pages.length +
      ' >>';
    objTable[fontNormId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objTable[fontBoldId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    pages.forEach(function (pg, j) {
      objTable[pageObjIds[j]] =
        '<< /Type /Page /Parent ' +
        pagesRootId +
        ' 0 R /MediaBox [0 0 ' +
        pg.w.toFixed(2) +
        ' ' +
        pg.h.toFixed(2) +
        '] /Contents ' +
        contentObjIds[j] +
        ' 0 R /Resources << /Font << /F1 ' +
        fontNormId +
        ' 0 R /F2 ' +
        fontBoldId +
        ' 0 R >> >> >>';
      objTable[contentObjIds[j]] = '<< /Length ' + pg.stream.length + ' >>\nstream\n' + pg.stream + '\nendstream';
    });

    var pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    var offsets = [];
    var maxObj = 4 + pages.length * 2;
    for (var k = 1; k <= maxObj; k++) {
      offsets[k] = pdf.length;
      pdf += k + ' 0 obj\n' + objTable[k] + '\nendobj\n';
    }
    var xrefOffset = pdf.length;
    pdf += 'xref\r\n0 ' + (maxObj + 1) + '\r\n';
    pdf += '0000000000 65535 f \r\n';
    for (var m = 1; m <= maxObj; m++) pdf += String(offsets[m]).padStart(10, '0') + ' 00000 n \r\n';
    pdf +=
      'trailer\r\n<< /Size ' +
      (maxObj + 1) +
      ' /Root ' +
      catalogId +
      ' 0 R >>\r\nstartxref\r\n' +
      xrefOffset +
      '\r\n%%EOF\r\n';

    var bytes = new Uint8Array(pdf.length);
    for (var n = 0; n < pdf.length; n++) bytes[n] = pdf.charCodeAt(n) & 0xff;
    return new Blob([bytes], { type: 'application/pdf' });
  }

  function buildPdfDoc(sections) {
    var layouts = sections.map(layoutPdfSection);
    var total = layouts.reduce(function (a, L) {
      return a + L.pages.length;
    }, 0);
    var out = [],
      pageNo = 0;
    layouts.forEach(function (L) {
      L.pages.forEach(function (_, i) {
        pageNo++;
        out.push({ w: L.w, h: L.h, stream: renderPdfPage(L, i, pageNo, total) });
      });
    });
    return assemblePdf(out);
  }

  function buildPdfBlob(options) {
    return buildPdfDoc([options]);
  }

  function generateReportCsvBlob(cols, rows) {
    var escCsv = function (v) {
      v = String(v == null ? '' : v);
      return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    var csvLines = [cols.map(escCsv).join(',')];
    for (var i = 0; i < rows.length; i++) {
      csvLines.push(rows[i].map(escCsv).join(','));
    }
    return new Blob(['\uFEFF' + csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  }

  function generateReportXlsBlob(title, cols, rows) {
    var escXml = function (s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c];
      });
    };
    var html =
      '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">' +
      '<head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>' +
      '<x:Name>' +
      escXml(title.slice(0, 31)) +
      '</x:Name>' +
      '<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->' +
      '<style>' +
      'th { background-color: #1d3557; color: #ffffff; font-weight: bold; border: 1px solid #cccccc; padding: 6px 10px; font-family: Arial, sans-serif; }' +
      'td { border: 1px solid #e2e8f0; padding: 5px 8px; font-family: Arial, sans-serif; font-size: 13px; }' +
      '.even { background-color: #f8fafc; }' +
      '</style></head><body>' +
      '<h2>' +
      escXml(title) +
      '</h2>' +
      '<p style="color:#64748b;font-size:12px">Generated: ' +
      escXml(new Date().toLocaleString('en-GB')) +
      ' | Lab of Future CRM</p>' +
      '<table><thead><tr>' +
      cols
        .map(function (c) {
          return '<th>' + escXml(c) + '</th>';
        })
        .join('') +
      '</tr></thead><tbody>' +
      rows
        .map(function (r, rIdx) {
          return (
            '<tr' +
            (rIdx % 2 === 1 ? ' class="even"' : '') +
            '>' +
            r
              .map(function (c) {
                return '<td>' + escXml(c) + '</td>';
              })
              .join('') +
            '</tr>'
          );
        })
        .join('') +
      '</tbody></table></body></html>';
    return new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  }

  function generateReportJsonBlob(title, cols, rows, filters, note) {
    var data = {
      report: title,
      generated_at: new Date().toISOString(),
      system: 'Lab of Future CRM',
      filters: filters || null,
      note: note || null,
      total_records: rows.length,
      columns: cols,
      records: rows.map(function (r) {
        var obj = {};
        cols.forEach(function (c, i) {
          obj[c] = r[i];
        });
        return obj;
      }),
    };
    return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  }

  function openPrintReport(report) {
    var title = report.title || 'Report';
    var cols = report.cols || [];
    var rows = report.rows || [];
    var filters = report.filters || '';
    var note = report.note || '';
    var chart = report.chart || [];
    var dateStr =
      report.date ||
      new Date().toLocaleString('en-GB', {
        timeZone: 'Asia/Dubai',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

    var escH = function (s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    };

    var chartHtml = '';
    if (chart && chart.length) {
      var maxVal =
        Math.max.apply(
          null,
          chart.map(function (x) {
            return x.v || 0;
          }),
        ) || 1;
      chartHtml =
        '<div class="chart-box"><h3>Visual Summary</h3><div class="chart-bars">' +
        chart
          .map(function (it) {
            var pct = Math.max(2, Math.round(((it.v || 0) / maxVal) * 100));
            return (
              '<div class="c-row"><div class="c-lbl">' +
              escH(it.l) +
              '</div>' +
              '<div class="c-track"><div class="c-fill" style="width:' +
              pct +
              '%"></div></div>' +
              '<div class="c-val">' +
              escH(it.v) +
              '</div></div>'
            );
          })
          .join('') +
        '</div></div>';
    }

    var html =
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<title>' +
      escH(title) +
      ' - Lab of Future CRM</title>' +
      '<style>' +
      '@page { size: ' +
      (cols.length > 6 ? 'landscape' : 'portrait') +
      '; margin: 12mm; }' +
      'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #1e293b; margin: 0; background: #f8fafc; font-size: 13px; line-height: 1.4; }' +
      '.wrap { max-width: 1080px; margin: 20px auto; background: #fff; padding: 28px 32px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }' +
      '.bar { display: flex; align-items: center; justify-content: space-between; padding-bottom: 16px; margin-bottom: 20px; border-bottom: 2px solid #e2e8f0; }' +
      '.brand { font-size: 18px; font-weight: 700; color: #1d3557; letter-spacing: -0.3px; }' +
      '.meta { font-size: 12px; color: #64748b; }' +
      '.title-section { margin-bottom: 18px; }' +
      'h1 { font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 6px; }' +
      '.filters-tag { display: inline-block; background: #f1f5f9; color: #334155; font-size: 12px; padding: 4px 10px; border-radius: 4px; margin-top: 4px; }' +
      '.chart-box { margin: 18px 0; padding: 14px 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; }' +
      '.chart-box h3 { margin: 0 0 10px; font-size: 13px; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; }' +
      '.c-row { display: flex; align-items: center; margin: 6px 0; font-size: 12px; }' +
      '.c-lbl { width: 150px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }' +
      '.c-track { flex: 1; height: 14px; background: #e2e8f0; border-radius: 3px; margin: 0 10px; overflow: hidden; }' +
      '.c-fill { height: 100%; background: #3b82f6; border-radius: 3px; }' +
      '.c-val { width: 60px; text-align: right; font-weight: 600; color: #1e293b; }' +
      'table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 12px; }' +
      'th { background: #1d3557; color: #fff; text-align: left; padding: 8px 10px; font-weight: 600; border: 1px solid #1d3557; }' +
      'td { padding: 6px 10px; border-bottom: 1px solid #e2e8f0; }' +
      'tr:nth-child(even) td { background: #f8fafc; }' +
      '.foot { margin-top: 24px; padding-top: 12px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 11px; color: #94a3b8; }' +
      '.actions { margin-bottom: 16px; display: flex; gap: 8px; }' +
      '.btn { background: #1d3557; color: #fff; border: 0; padding: 8px 14px; border-radius: 5px; cursor: pointer; font-size: 13px; font-weight: 500; }' +
      '.btn.ghost { background: #e2e8f0; color: #1e293b; }' +
      '@media print {' +
      '  body { background: #fff; }' +
      '  .wrap { box-shadow: none; padding: 0; margin: 0; max-width: 100%; }' +
      '  .actions { display: none !important; }' +
      '  tr { page-break-inside: avoid; }' +
      '  thead { display: table-header-group; }' +
      '  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }' +
      '}' +
      '</style></head><body><div class="wrap">' +
      '<div class="actions">' +
      '<button class="btn" onclick="window.print()">Print / Save as PDF</button>' +
      '<button class="btn ghost" onclick="window.close()">Close</button>' +
      '</div>' +
      '<div class="bar">' +
      '<div class="brand">Lab of Future CRM</div>' +
      '<div class="meta">Exported: ' +
      escH(dateStr) +
      '</div>' +
      '</div>' +
      '<div class="title-section">' +
      '<h1>' +
      escH(title) +
      '</h1>' +
      (filters ? '<div class="filters-tag">' + escH(filters) + '</div>' : '') +
      (note ? '<p style="color:#64748b;font-size:12px;margin:6px 0 0">' + escH(note) + '</p>' : '') +
      '</div>' +
      chartHtml +
      '<table><thead><tr>' +
      cols
        .map(function (c) {
          return '<th>' + escH(c) + '</th>';
        })
        .join('') +
      '</tr></thead><tbody>' +
      rows
        .map(function (r) {
          return (
            '<tr>' +
            r
              .map(function (c) {
                return '<td>' + escH(c) + '</td>';
              })
              .join('') +
            '</tr>'
          );
        })
        .join('') +
      '</tbody></table>' +
      '<div class="foot">' +
      '<div>Lab of Future CRM • Confidential Report</div>' +
      '<div>Total Rows: ' +
      rows.length +
      '</div>' +
      '</div></div></body></html>';

    var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }

  // Wrap REP.r1 to strictly enforce branch location for Reception
  if (typeof REP !== 'undefined' && REP.r1) {
    var _origRepR1 = REP.r1;
    REP.r1 = function () {
      if (isReceptionStaff()) {
        var b = receptionBranch();
        var days = {};
        var pm = (S && S.cfg && S.cfg.pm) || ['Cash', 'Card', 'Bank Transfer', 'Online'];
        var rangeFilter = (typeof RF === 'function' && RF() ? RF().range : null) || 'all';
        var ps = (S && S.pay ? S.pay : []).filter(function (p) {
          return p.branch === b && (typeof inRange === 'function' ? inRange(p.at, rangeFilter) : true);
        });
        ps.forEach(function (p) {
          var k = typeof dayKey === 'function' ? dayKey(p.at) : String(p.at).slice(0, 10);
          days[k] = days[k] || { n: 0, t: {} };
          days[k].n++;
          days[k].t[p.method] =
            (days[k].t[p.method] || 0) + (typeof toAED === 'function' ? toAED(p.amt, p.cur) : p.amt);
        });
        var ks = Object.keys(days).sort().reverse();
        var cols = ['Date', 'Receipts'].concat(
          pm.map(function (m) {
            return m + ' (AED eq.)';
          }),
          ['Total (AED eq.)'],
        );
        var rows = ks.map(function (k) {
          var row = [k, String(days[k].n)];
          var sum = 0;
          pm.forEach(function (m) {
            var val = Math.round(days[k].t[m] || 0);
            sum += val;
            row.push(val.toLocaleString('en-US'));
          });
          row.push(sum.toLocaleString('en-US'));
          return row;
        });
        var chart = ks
          .slice(0, 10)
          .reverse()
          .map(function (k) {
            var sum = Object.values(days[k].t).reduce(function (a, x) {
              return a + x;
            }, 0);
            return { l: k, v: Math.round(sum) };
          });
        var bName = typeof branchName === 'function' ? branchName(b) : b;
        return {
          cols: cols,
          rows: rows,
          chart: chart,
          note: 'Restricted to ' + bName + ' (Assigned Location). All amounts in AED equivalent.',
        };
      }
      return _origRepR1.apply(this, arguments);
    };
  }

  // forId: build the context of any report (export all) without changing the report on screen
  function getActiveReportContext(forId) {
    var id = forId || (S.rep ? S.rep.id : 'r1');
    if (isReceptionStaff() && !forId) {
      if (id !== 'r1' && id !== 'r22') {
        id = 'r1';
        if (S.rep) S.rep.id = 'r1';
      }
    }

    var def = (RDEF || []).find(function (r) {
      return r[0] === id;
    }) || [id, 'Report'];
    var reportName = def[1];
    var f = (typeof RF === 'function' ? RF() : S.rep && S.rep.f) || {};

    if (!isBranchPrivileged()) {
      var userBr = userAssignedBranch();
      if (f && userBr) f.branch = userBr;
      if (id === 'r1') {
        reportName = 'Daily Collection Report – ' + (typeof branchName === 'function' ? branchName(userBr) : userBr);
      }
    }

    var res = REP && REP[id] ? REP[id]() : { cols: [], rows: [] };
    var fParts = [];
    if (f.range)
      fParts.push(
        'Range: ' +
          (f.range === '7'
            ? 'Last 7 days'
            : f.range === '30'
              ? 'Last 30 days'
              : f.range === 'month'
                ? 'This month'
                : 'All time'),
      );

    if (!isBranchPrivileged()) {
      fParts.push('Location: ' + userAssignedBranchNames() + ' (Assigned Branch)');
    } else {
      if (f.branch && typeof branchName === 'function') fParts.push('Branch: ' + branchName(f.branch));
      if (f.prog && typeof PNAME === 'function') fParts.push('Programme: ' + PNAME(f.prog));
      if (f.cslr && typeof staffName === 'function') fParts.push('Counsellor: ' + staffName(f.cslr));
      if (f.src) fParts.push('Source: ' + f.src);
      if (f.status) fParts.push('Status: ' + f.status);
    }

    var filterSummary = fParts.join('  •  ') || 'All branches & all time';
    var dateStr = new Date().toLocaleString('en-GB', {
      timeZone: 'Asia/Dubai',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    return {
      id: id,
      name: reportName,
      cols: res.cols || [],
      rows: res.rows || [],
      chart: res.chart || [],
      note: res.note || '',
      filters: filterSummary,
      date: dateStr,
    };
  }

  // Direct Action Handlers
  ACT.repPdf = function () {
    var ctx = getActiveReportContext();
    var blob = buildPdfBlob({
      title: ctx.name,
      cols: ctx.cols,
      rows: ctx.rows,
      filters: ctx.filters,
      note: ctx.note,
      date: ctx.date,
    });
    var filename = ctx.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.pdf';
    downloadBlob(blob, filename);
    if (typeof addAudit === 'function') addAudit('Report exported (PDF)', ctx.id, ctx.name);
    if (typeof toast === 'function') toast('PDF report downloaded (' + ctx.rows.length + ' rows)', 'ok');
  };

  ACT.repCsv = function () {
    var ctx = getActiveReportContext();
    var blob = generateReportCsvBlob(ctx.cols, ctx.rows);
    var filename = ctx.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.csv';
    downloadBlob(blob, filename);
    if (typeof addAudit === 'function') addAudit('Report exported (CSV)', ctx.id, ctx.name);
    if (typeof toast === 'function') toast('CSV report downloaded (' + ctx.rows.length + ' rows)', 'ok');
  };

  ACT.repPrint = function () {
    var ctx = getActiveReportContext();
    openPrintReport({
      title: ctx.name,
      cols: ctx.cols,
      rows: ctx.rows,
      filters: ctx.filters,
      note: ctx.note,
      chart: ctx.chart,
      date: ctx.date,
    });
    if (typeof addAudit === 'function') addAudit('Report printed / saved as PDF', ctx.id, ctx.name);
  };

  ACT.repXls = function () {
    var ctx = getActiveReportContext();
    var blob = generateReportXlsBlob(ctx.name, ctx.cols, ctx.rows);
    var filename = ctx.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.xls';
    downloadBlob(blob, filename);
    if (typeof addAudit === 'function') addAudit('Report exported (Excel)', ctx.id, ctx.name);
    if (typeof toast === 'function') toast('Excel report downloaded (' + ctx.rows.length + ' rows)', 'ok');
  };

  ACT.repJson = function () {
    var ctx = getActiveReportContext();
    var blob = generateReportJsonBlob(ctx.name, ctx.cols, ctx.rows, ctx.filters, ctx.note);
    var filename = ctx.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.json';
    downloadBlob(blob, filename);
    if (typeof addAudit === 'function') addAudit('Report exported (JSON)', ctx.id, ctx.name);
    if (typeof toast === 'function') toast('JSON data downloaded', 'ok');
  };

  // ---------------- all reports in one file (each user gets the reports and branches they can see)
  function exportableReportIds() {
    if (isReceptionStaff()) return ['r1', 'r22'];
    return (RDEF || [])
      .map(function (r) {
        return r[0];
      })
      .filter(function (id) {
        return REP && REP[id];
      });
  }
  function allReportContexts() {
    return exportableReportIds().map(function (id) {
      try {
        return getActiveReportContext(id);
      } catch (e) {
        return { id: id, name: id, cols: ['Error'], rows: [[String((e && e.message) || e)]], filters: '', note: '' };
      }
    });
  }
  var fileDate = function () {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
  };

  ACT.repExportAll = function () {
    var ctxs = allReportContexts();
    if (!ctxs.length) {
      if (typeof toast === 'function') toast('No reports available for your role', 'warn');
      return;
    }
    var date = ctxs[0].date || new Date().toLocaleString('en-GB');
    var sections = ctxs.map(function (c, i) {
      return { title: i + 1 + '. ' + c.name, cols: c.cols, rows: c.rows, filters: c.filters, note: c.note, date: date };
    });
    // Contents first: one line per report with its row count and the page it starts on
    var toc = {
      title: 'All reports (' + ctxs.length + ')',
      cols: ['#', 'Report', 'Rows', 'Page'],
      rows: [],
      filters: ctxs[0].filters,
      note: 'Each report starts on a new page.',
      date: date,
      landscape: false,
    };
    toc.rows = ctxs.map(function (c, i) {
      return [String(i + 1), c.name, String(c.rows.length), ''];
    });
    var page = layoutPdfSection(toc).pages.length + 1;
    toc.rows = ctxs.map(function (c, i) {
      var r = [String(i + 1), c.name, String(c.rows.length), String(page)];
      page += layoutPdfSection(sections[i]).pages.length;
      return r;
    });
    downloadBlob(buildPdfDoc([toc].concat(sections)), 'lof-crm-all-reports-' + fileDate() + '.pdf');
    if (typeof addAudit === 'function')
      addAudit('All reports exported (PDF)', 'all', ctxs.length + ' reports, ' + (page - 1) + ' pages');
    if (typeof toast === 'function')
      toast('All ' + ctxs.length + ' reports downloaded as one PDF (' + (page - 1) + ' pages)', 'ok');
  };

  // Excel 2003 XML workbook: a Contents sheet plus one sheet per report (opens in Excel and LibreOffice)
  ACT.repExportAllXls = function () {
    var ctxs = allReportContexts();
    if (!ctxs.length) {
      if (typeof toast === 'function') toast('No reports available for your role', 'warn');
      return;
    }
    var x = function (s) {
      return String(s == null ? '' : s)
        .replace(/[&<>"]/g, function (c) {
          return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        })
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    };
    var used = {};
    var sheetName = function (i, name) {
      var base = (i + 1 + ' ' + name)
          .replace(/[\[\]:*?\/\\]/g, ' ')
          .slice(0, 31)
          .trim(),
        n = base,
        k = 2;
      while (used[n.toLowerCase()]) n = base.slice(0, 28) + ' ' + k++;
      used[n.toLowerCase()] = 1;
      return n;
    };
    var cell = function (v, style) {
      var s = String(v == null ? '' : v),
        num = /^-?\d+(\.\d+)?$/.test(s.replace(/,/g, '')) && s.length < 16;
      return (
        '<Cell' +
        (style ? ' ss:StyleID="' + style + '"' : '') +
        '><Data ss:Type="' +
        (num ? 'Number' : 'String') +
        '">' +
        x(num ? s.replace(/,/g, '') : s) +
        '</Data></Cell>'
      );
    };
    var sheet = function (name, title, sub, cols, rows) {
      return (
        '<Worksheet ss:Name="' +
        x(name) +
        '"><Table>' +
        '<Row>' +
        cell(title, 'title') +
        '</Row>' +
        (sub ? '<Row>' + cell(sub, 'sub') + '</Row>' : '') +
        '<Row/>' +
        '<Row>' +
        cols
          .map(function (c) {
            return cell(c, 'head');
          })
          .join('') +
        '</Row>' +
        rows
          .map(function (r) {
            return (
              '<Row>' +
              r
                .map(function (v) {
                  return cell(v);
                })
                .join('') +
              '</Row>'
            );
          })
          .join('') +
        '</Table></Worksheet>'
      );
    };
    var names = ctxs.map(function (c, i) {
      return sheetName(i, c.name);
    });
    var xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n<?mso-application progid="Excel.Sheet"?>\n' +
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
      '<Styles><Style ss:ID="title"><Font ss:Bold="1" ss:Size="13"/></Style><Style ss:ID="sub"><Font ss:Color="#64748B"/></Style>' +
      '<Style ss:ID="head"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#1D3557" ss:Pattern="Solid"/></Style></Styles>' +
      sheet(
        'Contents',
        'Lab of Future CRM – all reports',
        'Generated ' + (ctxs[0].date || '') + '  |  ' + (ctxs[0].filters || ''),
        ['#', 'Report', 'Rows', 'Sheet'],
        ctxs.map(function (c, i) {
          return [String(i + 1), c.name, String(c.rows.length), names[i]];
        }),
      ) +
      ctxs
        .map(function (c, i) {
          return sheet(names[i], c.name, [c.filters, c.note].filter(Boolean).join('  |  '), c.cols, c.rows);
        })
        .join('') +
      '</Workbook>';
    downloadBlob(
      new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' }),
      'lof-crm-all-reports-' + fileDate() + '.xls',
    );
    if (typeof addAudit === 'function') addAudit('All reports exported (Excel)', 'all', ctxs.length + ' reports');
    if (typeof toast === 'function') toast('All ' + ctxs.length + ' reports downloaded as one Excel workbook', 'ok');
  };

  // ---------------- new single-report formats: Word document and HTML page
  function reportHtmlDoc(ctx, forWord) {
    var h = function (s) {
      return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    };
    return (
      '<html' +
      (forWord
        ? ' xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"'
        : '') +
      '>' +
      '<head><meta charset="utf-8"><title>' +
      h(ctx.name) +
      '</title>' +
      (forWord
        ? '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->'
        : '<meta name="viewport" content="width=device-width,initial-scale=1">') +
      '<style>' +
      (forWord && ctx.cols.length > 6
        ? '@page { size: 841.9pt 595.3pt; mso-page-orientation: landscape; margin: 36pt; } '
        : '@page { margin: 36pt; } ') +
      'body{font-family:Arial,Helvetica,sans-serif;color:#1e293b;font-size:11pt;margin:24px} .brand{color:#1d3557;font-weight:bold;font-size:15pt}' +
      ' .meta{color:#64748b;font-size:9pt;margin:4px 0 14px} h1{font-size:14pt;margin:14px 0 4px}' +
      ' table{border-collapse:collapse;width:100%;font-size:9pt} th{background:#1d3557;color:#fff;text-align:left;padding:5px 7px;border:1px solid #1d3557}' +
      ' td{padding:4px 7px;border:1px solid #e2e8f0} tr:nth-child(even) td{background:#f8fafc} .foot{color:#94a3b8;font-size:8pt;margin-top:14px}</style></head><body>' +
      '<div class="brand">Lab of Future CRM</div><h1>' +
      h(ctx.name) +
      '</h1>' +
      '<div class="meta">Generated ' +
      h(ctx.date) +
      (ctx.filters ? ' &nbsp;|&nbsp; ' + h(ctx.filters) : '') +
      (ctx.note ? '<br>' + h(ctx.note) : '') +
      '</div>' +
      '<table><thead><tr>' +
      ctx.cols
        .map(function (c) {
          return '<th>' + h(c) + '</th>';
        })
        .join('') +
      '</tr></thead><tbody>' +
      (ctx.rows.length
        ? ctx.rows
            .map(function (r) {
              return (
                '<tr>' +
                r
                  .map(function (v) {
                    return '<td>' + h(v) + '</td>';
                  })
                  .join('') +
                '</tr>'
              );
            })
            .join('')
        : '<tr><td colspan="' + Math.max(1, ctx.cols.length) + '">No records for the selected filters.</td></tr>') +
      '</tbody></table><div class="foot">Lab of Future CRM &middot; Confidential &middot; ' +
      ctx.rows.length +
      ' rows</div></body></html>'
    );
  }
  ACT.repDoc = function () {
    var ctx = getActiveReportContext();
    downloadBlob(
      new Blob(['﻿' + reportHtmlDoc(ctx, true)], { type: 'application/msword;charset=utf-8' }),
      ctx.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.doc',
    );
    if (typeof addAudit === 'function') addAudit('Report exported (Word)', ctx.id, ctx.name);
    if (typeof toast === 'function') toast('Word document downloaded (' + ctx.rows.length + ' rows)', 'ok');
  };
  ACT.repHtml = function () {
    var ctx = getActiveReportContext();
    downloadBlob(
      new Blob([reportHtmlDoc(ctx, false)], { type: 'text/html;charset=utf-8' }),
      ctx.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.html',
    );
    if (typeof addAudit === 'function') addAudit('Report exported (HTML)', ctx.id, ctx.name);
    if (typeof toast === 'function') toast('HTML page downloaded (' + ctx.rows.length + ' rows)', 'ok');
  };

  ACT.repExportModal = function () {
    if (typeof openModal === 'function') openModal('reportExport');
  };

  ACT.doRepPdf = function () {
    if (typeof closeModal === 'function') closeModal();
    ACT.repPdf();
  };
  ACT.doRepPrint = function () {
    if (typeof closeModal === 'function') closeModal();
    ACT.repPrint();
  };
  ACT.doRepCsv = function () {
    if (typeof closeModal === 'function') closeModal();
    ACT.repCsv();
  };
  ACT.doRepXls = function () {
    if (typeof closeModal === 'function') closeModal();
    ACT.repXls();
  };
  ACT.doRepJson = function () {
    if (typeof closeModal === 'function') closeModal();
    ACT.repJson();
  };
  ACT.doRepAllPdf = function () {
    if (typeof closeModal === 'function') closeModal();
    ACT.repExportAll();
  };
  ACT.doRepAllXls = function () {
    if (typeof closeModal === 'function') closeModal();
    ACT.repExportAllXls();
  };
  ACT.doRepDoc = function () {
    if (typeof closeModal === 'function') closeModal();
    ACT.repDoc();
  };
  ACT.doRepHtml = function () {
    if (typeof closeModal === 'function') closeModal();
    ACT.repHtml();
  };
  ACT.repCopyClipboard = function () {
    var ctx = getActiveReportContext();
    var escCsv = function (v) {
      v = String(v == null ? '' : v);
      return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    var text = [ctx.cols.map(escCsv).join(',')]
      .concat(
        ctx.rows.map(function (r) {
          return r.map(escCsv).join(',');
        }),
      )
      .join('\n');
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function () {
        if (typeof toast === 'function') toast('CSV copied to clipboard', 'ok');
        if (typeof closeModal === 'function') closeModal();
      });
    } else {
      if (typeof toast === 'function') toast('Clipboard unavailable', 'warn');
    }
  };

  MODALS.reportExport = function () {
    var ctx = getActiveReportContext();
    var rowCount = ctx.rows.length;
    var colCount = ctx.cols.length;
    var isPriv = isBranchPrivileged();

    var nAll = exportableReportIds().length;
    var allPdfCard =
      '<div class="card" style="padding:14px;border:1px solid var(--line);border-radius:8px;cursor:pointer" data-act="doRepDoc">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="font-size:22px">📝</span><b>Word Document (.doc)</b></div>' +
      '<p class="muted xs" style="margin:0 0 10px">Editable report for Microsoft Word or Google Docs – add comments before sharing.</p>' +
      '<button class="btn sm" type="button" data-act="doRepDoc">' +
      ic('download') +
      ' Download Word</button>' +
      '</div>' +
      '<div class="card" style="padding:14px;border:1px solid var(--line);border-radius:8px;cursor:pointer" data-act="doRepHtml">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="font-size:22px">🌐</span><b>Web Page (.html)</b></div>' +
      '<p class="muted xs" style="margin:0 0 10px">Self-contained page that opens in any browser – easy to e-mail or archive.</p>' +
      '<button class="btn sm" type="button" data-act="doRepHtml">' +
      ic('download') +
      ' Download HTML</button>' +
      '</div>' +
      '</div>' +
      '<div class="sec" style="margin-top:4px">All reports' +
      (isPriv ? '' : ' – ' + esc(userAssignedBranchNames())) +
      '</div>' +
      '<p class="muted xs" style="margin:2px 0 10px">Every report you can see (' +
      nAll +
      '), with the filters currently selected, in one file.</p>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:0 0 6px">' +
      '<div class="card" style="padding:14px;border:1px solid var(--line);border-radius:8px;cursor:pointer" data-act="doRepAllPdf">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="font-size:22px">📚</span><b>All reports – PDF</b></div>' +
      '<p class="muted xs" style="margin:0 0 10px">Contents page, then each of the ' +
      nAll +
      ' reports in full, each starting on a new page.</p>' +
      '<button class="btn sm primary" type="button" data-act="doRepAllPdf">' +
      ic('download') +
      ' Download all as PDF</button>' +
      '</div>' +
      '<div class="card" style="padding:14px;border:1px solid var(--line);border-radius:8px;cursor:pointer" data-act="doRepAllXls">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="font-size:22px">🗂️</span><b>All reports – Excel</b></div>' +
      '<p class="muted xs" style="margin:0 0 10px">One workbook: a Contents sheet plus one sheet per report.</p>' +
      '<button class="btn sm" type="button" data-act="doRepAllXls">' +
      ic('download') +
      ' Download all as Excel</button>' +
      '</div>';

    var body =
      '<div class="banner">' +
      ic('file') +
      '<span>Exporting <b>' +
      esc(ctx.name) +
      '</b> (' +
      rowCount +
      ' row' +
      (rowCount === 1 ? '' : 's') +
      ', ' +
      colCount +
      ' columns). Select your preferred format:</span></div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:16px 0">' +
      '<div class="card" style="padding:14px;border:1px solid var(--line);border-radius:8px;cursor:pointer" data-act="doRepPdf">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="font-size:22px">📄</span><b>PDF Document (.pdf)</b></div>' +
      '<p class="muted xs" style="margin:0 0 10px">Formatted official document with Lab of Future branding, tables, auto-pagination.</p>' +
      '<button class="btn sm primary" type="button" data-act="doRepPdf">' +
      ic('download') +
      ' Download PDF</button>' +
      '</div>' +
      '<div class="card" style="padding:14px;border:1px solid var(--line);border-radius:8px;cursor:pointer" data-act="doRepPrint">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="font-size:22px">🖨️</span><b>Print / Save as PDF</b></div>' +
      '<p class="muted xs" style="margin:0 0 10px">Interactive print-ready preview with SVG charts, browser native vector PDF save.</p>' +
      '<button class="btn sm" type="button" data-act="doRepPrint">Open Print View</button>' +
      '</div>' +
      '<div class="card" style="padding:14px;border:1px solid var(--line);border-radius:8px;cursor:pointer" data-act="doRepCsv">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="font-size:22px">📊</span><b>CSV Spreadsheet (.csv)</b></div>' +
      '<p class="muted xs" style="margin:0 0 10px">Raw tabular data with UTF-8 BOM, ideal for Microsoft Excel and Google Sheets.</p>' +
      '<button class="btn sm" type="button" data-act="doRepCsv">' +
      ic('download') +
      ' Download CSV</button>' +
      '</div>' +
      '<div class="card" style="padding:14px;border:1px solid var(--line);border-radius:8px;cursor:pointer" data-act="doRepXls">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="font-size:22px">📑</span><b>Excel Workbook (.xls)</b></div>' +
      '<p class="muted xs" style="margin:0 0 10px">Structured Excel XML spreadsheet with styled headers and column widths.</p>' +
      '<button class="btn sm" type="button" data-act="doRepXls">' +
      ic('download') +
      ' Download Excel</button>' +
      '</div>' +
      '<div class="card" style="padding:14px;border:1px solid var(--line);border-radius:8px;cursor:pointer" data-act="doRepJson">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="font-size:22px">📦</span><b>JSON Dataset (.json)</b></div>' +
      '<p class="muted xs" style="margin:0 0 10px">Structured API format containing metadata, column specs, and rows.</p>' +
      '<button class="btn sm ghost" type="button" data-act="doRepJson">' +
      ic('download') +
      ' Download JSON</button>' +
      '</div>' +
      allPdfCard +
      '</div>';

    return {
      title: 'Export Report – ' + ctx.name,
      size: 'lg',
      foot: '<button class="btn" data-act="closeModal">Close</button><button class="btn" data-act="repCopyClipboard">Copy CSV to Clipboard</button>',
      body: body,
    };
  };

  // Enhance PAGES.reports with Branch Access Control
  if (typeof PAGES !== 'undefined' && PAGES.reports) {
    var _origReportsPage = PAGES.reports;
    PAGES.reports = function (rt) {
      var isPriv = isBranchPrivileged();
      var isRec = isReceptionStaff();
      var userBr = userAssignedBranch();

      if (!isPriv) {
        if (isRec) {
          if (!S.rep.id || (S.rep.id !== 'r1' && S.rep.id !== 'r22')) {
            S.rep.id = 'r1';
          }
          if (rt && rt.rep && rt.rep !== 'r1' && rt.rep !== 'r22') {
            rt.rep = 'r1';
          }
        }
        S.rep.f = S.rep.f || {};
        if (userBr) S.rep.f.branch = userBr;
      }

      var html = _origReportsPage.apply(this, arguments);

      if (!isPriv) {
        var bName = userAssignedBranchNames();

        if (isRec) {
          // Restrict left report list to collection and instalment reports
          html = html.replace(/<div class="list" style="padding:6px">[\s\S]*?<\/div><\/div>/, function () {
            var items = [
              ['r1', 'Daily Collection Report (' + bName + ')'],
              ['r22', 'Instalment Status Report (' + bName + ')'],
            ];
            return (
              '<div class="list" style="padding:6px">' +
              '<div style="padding:4px 8px;font-size:11px;font-weight:700;color:var(--muted,#64748b);text-transform:uppercase;letter-spacing:0.5px">Branch Reports</div>' +
              items
                .map(function (it, idx) {
                  var on = S.rep.id === it[0];
                  return (
                    '<div class="cl" tabindex="0" data-act="go" data-page="reports" data-rep="' +
                    it[0] +
                    '" style="border:0;border-radius:6px;cursor:pointer;padding:8px 10px;display:block;margin-bottom:4px;' +
                    (on ? 'background:var(--accent-soft);color:var(--accent);font-weight:600' : '') +
                    '">' +
                    (idx + 1) +
                    '. ' +
                    esc(it[1]) +
                    '</div>'
                  );
                })
                .join('') +
              '</div></div>'
            );
          });

          // Add Receptionist restriction banner
          var bannerHtml =
            '<div class="banner" style="margin-bottom:12px">' +
            ic('shield') +
            '<span><b>Branch Restricted:</b> As Reception, your collection reports and exports are restricted strictly to your assigned location (<b>' +
            esc(bName) +
            '</b>).</span></div>';
          html = html.replace(/<div><div class="card">/, '<div>' + bannerHtml + '<div class="card">');
        }

        // Replace branch select with locked branch badge
        html = html.replace(/<select name="branch"[\s\S]*?<\/select>/, branchLockedBadge());

        // Update header title if on r1
        if (S.rep.id === 'r1') {
          html = html.replace(/Daily Collection Report/, 'Daily Collection Report – ' + esc(bName));
        }
      }

      return html.replace(
        /<button class="btn" data-act="repCsv">[\s\S]*?Export CSV<\/button>/,
        '<div class="row" style="gap:6px;display:inline-flex">' +
          '<button class="btn primary" data-act="repPdf" title="Download report as formatted PDF">' +
          ic('file') +
          ' Export PDF</button>' +
          '<button class="btn" data-act="repCsv" title="Download report as CSV spreadsheet">' +
          ic('download') +
          ' Export CSV</button>' +
          '<button class="btn" data-act="repExportAll" title="Download every report you can see in one PDF">' +
          ic('file') +
          ' Export All (PDF)</button>' +
          '<button class="btn ghost" data-act="repExportModal" title="More download formats (Word, Excel, HTML, JSON, Print, all reports)">' +
          ic('list') +
          ' More Formats ▾</button>' +
          '</div>',
      );
    };
  }

  // Enhance PAGES.payRecords with direct Daily Collection shortcut
  if (typeof PAGES !== 'undefined' && PAGES.payRecords) {
    var _origPayRecords = PAGES.payRecords;
    PAGES.payRecords = function () {
      var html = _origPayRecords.apply(this, arguments);
      var isRec = isReceptionStaff();
      var extraBtn = isRec
        ? '<button class="btn ghost" data-act="goDailyCol" title="Open Daily Collection Report for assigned branch">' +
          ic('chart') +
          ' Daily Collection Report</button>'
        : '';
      return html.replace(
        '<button class="btn" data-act="payCsv">Export CSV</button>',
        '<div class="row" style="gap:6px;display:inline-flex">' +
          '<button class="btn primary" data-act="payPdf" title="Download payments as PDF">' +
          ic('file') +
          ' Export PDF</button>' +
          '<button class="btn" data-act="payCsv" title="Download payments as CSV">' +
          ic('download') +
          ' Export CSV</button>' +
          extraBtn +
          '</div>',
      );
    };

    ACT.goDailyCol = function () {
      if (typeof go === 'function') go('reports', { rep: 'r1' });
    };

    ACT.payPdf = function () {
      var ps = (S.pay || []).filter(function (p) {
        return typeof inScope === 'function' ? inScope(p.branch) : true;
      });
      var rows = ps.map(function (p) {
        var s = typeof stuById === 'function' ? stuById(p.stu) : null;
        var sName = s ? s.first + ' ' + s.last : p.stu;
        var bName = typeof branchName === 'function' ? branchName(p.branch) : p.branch;
        var amtStr = typeof money === 'function' ? money(p.amt, p.cur) : p.cur + ' ' + p.amt;
        var dateStr = typeof fDT === 'function' ? fDT(p.at) : p.at;
        return [p.id, dateStr, sName, bName, p.enr, amtStr, p.method, p.ref || '—', p.rc];
      });
      var isRec = isReceptionStaff();
      var title = isRec ? 'Payment Records – ' + branchName(receptionBranch()) : 'Payment Records';
      var blob = buildPdfBlob({
        title: title,
        cols: ['Payment ID', 'Date', 'Student', 'Branch', 'Enrolment', 'Amount', 'Method', 'Reference', 'Receipt'],
        rows: rows,
        filters: isRec
          ? 'Location: ' + branchName(receptionBranch()) + ' (Assigned Branch)'
          : 'Active Branch Scope (' + rows.length + ' records)',
        date: new Date().toLocaleString('en-GB'),
      });
      downloadBlob(blob, isRec ? 'payment-records-' + receptionBranch().toLowerCase() + '.pdf' : 'payment-records.pdf');
      if (typeof addAudit === 'function')
        addAudit('Payment records exported (PDF)', 'payments', rows.length + ' records');
      if (typeof toast === 'function') toast('Payment records PDF downloaded (' + rows.length + ' rows)', 'ok');
    };
  }

  // Enhance generic MODALS.csv
  if (typeof MODALS !== 'undefined' && MODALS.csv) {
    var _origModalCsv = MODALS.csv;
    MODALS.csv = function (m) {
      var x = _origModalCsv(m);
      MODALS._lastExportData = m;
      x.foot =
        '<button class="btn" data-act="closeModal">Close</button>' +
        '<button class="btn" data-act="modalDownloadPdf">' +
        ic('file') +
        ' Download PDF</button>' +
        '<button class="btn" data-act="modalDownloadCsv">' +
        ic('download') +
        ' Download CSV</button>' +
        '<button class="btn primary" data-act="copyCsv">Copy CSV</button>';
      return x;
    };
    ACT.modalDownloadPdf = function () {
      var m = MODALS._lastExportData;
      if (!m) return;
      var blob = buildPdfBlob({
        title: (m.name || 'Export').replace(/-/g, ' ').toUpperCase(),
        cols: m.head || [],
        rows: m.rows || [],
      });
      downloadBlob(blob, (m.name || 'export') + '.pdf');
      if (typeof toast === 'function') toast('PDF downloaded', 'ok');
    };
    ACT.modalDownloadCsv = function () {
      var m = MODALS._lastExportData;
      if (!m) return;
      var blob = generateReportCsvBlob(m.head || [], m.rows || []);
      downloadBlob(blob, (m.name || 'export') + '.csv');
      if (typeof toast === 'function') toast('CSV downloaded', 'ok');
    };
  }
}

setupReportExports();

// ==================================================================
// BRANCH ACCESS CONTROL MODULE
// Restricts branch selection in dropdowns/filters exclusively to
// System Admins and Management. Standard users can only view data
// for their assigned branches.
// ==================================================================
function setupBranchAccessControl() {
  // 1. Scoping functions override
  if (typeof inScope === 'function') {
    var _origInScope = inScope;
    inScope = function (b) {
      if (isBranchPrivileged()) return _origInScope(b);
      return userAssignedBranches().includes(b);
    };
  }

  if (typeof leadScope === 'function') {
    var _origLeadScope = leadScope;
    leadScope = function () {
      if (isBranchPrivileged()) return _origLeadScope();
      var allowed = userAssignedBranches();
      return (S.leads || []).filter(function (l) {
        return allowed.includes(l.branch);
      });
    };
  }

  if (typeof optBranches === 'function') {
    var _origOptBranches = optBranches;
    optBranches = function () {
      if (isBranchPrivileged()) return _origOptBranches();
      var allowed = userAssignedBranches();
      return (S.branches || [])
        .filter(function (b) {
          return allowed.includes(b.id);
        })
        .map(function (b) {
          return [b.id, b.name];
        });
    };
  }

  // 2. Wrap PAGES.dashboard
  if (typeof PAGES !== 'undefined' && PAGES.dashboard) {
    var _origDashboard = PAGES.dashboard;
    PAGES.dashboard = function () {
      if (!isBranchPrivileged()) {
        var u = typeof me === 'function' ? me() : null;
        if (u) {
          S.dashF = S.dashF || {};
          var assigned = userAssignedBranches();
          if (assigned.length === 1) {
            S.dashF.branch = assigned[0];
          } else if (S.dashF.branch && !assigned.includes(S.dashF.branch)) {
            S.dashF.branch = assigned[0] || '';
          }
        }
      }
      var html = _origDashboard.apply(this, arguments);
      if (!isBranchPrivileged()) {
        html = html.replace(/<select name="branch" data-change="dash"[\s\S]*?<\/select>/, branchLockedBadge());
        html = html.replace(
          /all permitted branches/,
          typeof esc === 'function' ? esc(userAssignedBranchNames()) : userAssignedBranchNames(),
        );
      }
      return html;
    };
  }

  // 3. Wrap PAGES.leads
  if (typeof PAGES !== 'undefined' && PAGES.leads) {
    var _origLeads = PAGES.leads;
    PAGES.leads = function (rt) {
      if (!isBranchPrivileged()) {
        var u = typeof me === 'function' ? me() : null;
        if (u) {
          S.lf = S.lf || {};
          var assigned = userAssignedBranches();
          if (assigned.length === 1) {
            S.lf.branch = assigned[0];
          } else if (S.lf.branch && !assigned.includes(S.lf.branch)) {
            S.lf.branch = assigned[0] || '';
          }
        }
      }
      var html = _origLeads.apply(this, arguments);
      if (!isBranchPrivileged()) {
        html = html.replace(/<select name="branch" data-change="lf"[\s\S]*?<\/select>/, branchLockedBadge());
      }
      return html;
    };
  }

  // 4. Wrap PAGES.approvals
  if (typeof PAGES !== 'undefined' && PAGES.approvals) {
    var _origApprovals = PAGES.approvals;
    PAGES.approvals = function () {
      if (!isBranchPrivileged()) {
        var u = typeof me === 'function' ? me() : null;
        if (u) {
          S.apF = S.apF || {};
          var assigned = userAssignedBranches();
          if (assigned.length === 1) {
            S.apF.branch = assigned[0];
          } else if (S.apF.branch && !assigned.includes(S.apF.branch)) {
            S.apF.branch = assigned[0] || '';
          }
        }
      }
      var html = _origApprovals.apply(this, arguments);
      if (!isBranchPrivileged()) {
        html = html.replace(/<select name="branch" data-change="apF"[\s\S]*?<\/select>/, branchLockedBadge());
      }
      return html;
    };
  }

  // 5. Wrap MODALS.leadForm & SUB.leadForm
  if (typeof MODALS !== 'undefined' && MODALS.leadForm) {
    var _origLeadForm = MODALS.leadForm;
    MODALS.leadForm = function (m) {
      var res = _origLeadForm.apply(this, arguments);
      if (!isBranchPrivileged()) {
        var assigned = userAssignedBranches();
        var primaryBr = assigned[0] || userAssignedBranch();
        var bName = typeof branchName === 'function' ? branchName(primaryBr) : primaryBr;

        if (assigned.length === 1) {
          res.body = res.body.replace(
            /<select name="branch"[\s\S]*?<\/select>/,
            '<select name="branch" disabled style="background:var(--bg,#f8fafc);cursor:not-allowed"><option value="' +
              esc(primaryBr) +
              '" selected>' +
              esc(bName) +
              ' (Assigned)</option></select>' +
              '<input type="hidden" name="branch" value="' +
              esc(primaryBr) +
              '">',
          );
        } else {
          var allowedOpts = assigned
            .map(function (bid) {
              var n = typeof branchName === 'function' ? branchName(bid) : bid;
              return '<option value="' + esc(bid) + '">' + esc(n) + '</option>';
            })
            .join('');
          res.body = res.body.replace(
            /<select name="branch"[\s\S]*?<\/select>/,
            '<select name="branch" data-change="leadBranch" required>' + allowedOpts + '</select>',
          );
        }
      }
      return res;
    };

    if (typeof SUB !== 'undefined' && SUB.leadForm) {
      var _origSubLeadForm = SUB.leadForm;
      SUB.leadForm = function (d, form) {
        if (!isBranchPrivileged()) {
          var assigned = userAssignedBranches();
          if (assigned.length === 1) {
            d.branch = assigned[0];
          } else if (!assigned.includes(d.branch)) {
            d.branch = assigned[0];
          }
        }
        return _origSubLeadForm.apply(this, arguments);
      };
    }
  }

  // 6. Wrap PAGES.wizard
  if (typeof PAGES !== 'undefined' && PAGES.wizard) {
    var _origWizard = PAGES.wizard;
    PAGES.wizard = function (rt) {
      if (!isBranchPrivileged() && S.wiz && S.wiz.d) {
        var assigned = userAssignedBranches();
        if (assigned.length === 1) {
          S.wiz.d.branch = assigned[0];
        } else if (S.wiz.d.branch && !assigned.includes(S.wiz.d.branch)) {
          S.wiz.d.branch = assigned[0];
        }
      }
      var html = _origWizard.apply(this, arguments);
      if (!isBranchPrivileged()) {
        var assigned = userAssignedBranches();
        var primaryBr = assigned[0] || userAssignedBranch();
        var bName = typeof branchName === 'function' ? branchName(primaryBr) : primaryBr;

        if (assigned.length === 1) {
          html = html.replace(
            /<select name="branch" data-change="wizFee"[\s\S]*?<\/select>/,
            '<select name="branch" disabled style="background:var(--bg,#f8fafc);cursor:not-allowed"><option value="' +
              esc(primaryBr) +
              '" selected>' +
              esc(bName) +
              ' (Assigned)</option></select>' +
              '<input type="hidden" name="branch" value="' +
              esc(primaryBr) +
              '">',
          );
        }
      }
      return html;
    };
  }

  // 7. Intercept change handlers
  if (typeof CHG !== 'undefined') {
    if (CHG.dash) {
      var _origChgDash = CHG.dash;
      CHG.dash = function (el) {
        if (el.name === 'branch' && !isBranchPrivileged()) {
          var assigned = userAssignedBranches();
          S.dashF.branch =
            assigned.length === 1 ? assigned[0] : assigned.includes(el.value) ? el.value : assigned[0] || '';
          if (typeof render === 'function') render();
          return;
        }
        return _origChgDash.apply(this, arguments);
      };
    }

    if (CHG.lf) {
      var _origChgLf = CHG.lf;
      CHG.lf = function (el) {
        if (el.name === 'branch' && !isBranchPrivileged()) {
          var assigned = userAssignedBranches();
          S.lf.branch =
            assigned.length === 1 ? assigned[0] : assigned.includes(el.value) ? el.value : assigned[0] || '';
          if (typeof render === 'function') render();
          return;
        }
        return _origChgLf.apply(this, arguments);
      };
    }

    if (CHG.apF) {
      var _origChgApF = CHG.apF;
      CHG.apF = function (el) {
        if (el.name === 'branch' && !isBranchPrivileged()) {
          var assigned = userAssignedBranches();
          S.apF.branch =
            assigned.length === 1 ? assigned[0] : assigned.includes(el.value) ? el.value : assigned[0] || '';
          if (typeof render === 'function') render();
          return;
        }
        return _origChgApF.apply(this, arguments);
      };
    }

    if (CHG.repF) {
      var _origChgRepF = CHG.repF;
      CHG.repF = function (el) {
        if (el.name === 'branch' && !isBranchPrivileged()) {
          var assigned = userAssignedBranches();
          S.rep.f.branch =
            assigned.length === 1 ? assigned[0] : assigned.includes(el.value) ? el.value : assigned[0] || '';
          if (typeof render === 'function') render();
          return;
        }
        return _origChgRepF.apply(this, arguments);
      };
    }
  }

  // 8. Intercept ACT.repClear
  if (typeof ACT !== 'undefined' && ACT.repClear) {
    var _origRepClear = ACT.repClear;
    ACT.repClear = function () {
      if (!isBranchPrivileged()) {
        var assigned = userAssignedBranches();
        S.rep.f = { branch: assigned[0] || '' };
        if (typeof render === 'function') render();
        return;
      }
      return _origRepClear.apply(this, arguments);
    };
  }
}

setupBranchAccessControl();
