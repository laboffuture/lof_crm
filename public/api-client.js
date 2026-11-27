/* Lab of Future CRM – connects the CRM screens to the API.
 *
 * The screens keep their workflow logic (it is the approved prototype). This adapter:
 *   • signs the user in and loads branch-scoped data from GET /api/v1/bootstrap
 *   • after every user action, sends the changed records to PUT /api/v1/sync (server validates,
 *     stamps, assigns receipt numbers and runs the real integrations), then merges the server's version
 *   • takes record numbers from server sequences so IDs never collide between users
 *   • replaces simulated actions with real ones: LMS enrol/cancel calls and retry, Exotel click-to-call, incoming-call pop-up,
 *     payment links (Telr/Razorpay), printable receipts, connection tests
 *   • adds Settings → Testing console
 */
(function () {
  'use strict';

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
      return (typeof S !== 'undefined' && S && S.branches ? S.branches : []).map(function (b) { return b.id; });
    }
    if (typeof S !== 'undefined' && S && S.scope && Array.isArray(S.scope[u.id])) {
      return S.scope[u.id];
    }
    return u.branch ? [u.branch] : [];
  }

  function userAssignedBranchNames() {
    var brs = userAssignedBranches();
    if (!brs.length) return '';
    return brs.map(function (id) {
      return typeof branchName === 'function' ? branchName(id) : id;
    }).join(', ');
  }

  function branchLockedBadge() {
    var names = userAssignedBranchNames();
    return '<span class="badge info" style="font-weight:600;padding:5px 11px;background:var(--accent-soft);color:var(--accent);border:1px solid var(--accent);border-radius:6px;display:inline-flex;align-items:center;gap:6px">' +
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>' +
      'Location: ' + (typeof esc === 'function' ? esc(names) : names) + ' (Assigned)</span>';
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
      return sanitizePdf(str)
        .replace(/\\/g, '\\\\')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)');
    }

    function isNumericCol(colName, rows, colIdx) {
      if (/(%|amt|amount|total|collected|target|revenue|balance|paid|price|fee|rate|count|leads|breaches|waiting|min|utilisation)/i.test(colName)) return true;
      var numCount = 0;
      for (var r = 0; r < Math.min(rows.length, 10); r++) {
        var val = String(rows[r] && rows[r][colIdx] != null ? rows[r][colIdx] : '').trim().replace(/^[₹$€AEDINR\s,]+/, '').replace(/%$/, '');
        if (val !== '' && !isNaN(Number(val))) numCount++;
      }
      return numCount >= 3;
    }

    function buildPdfBlob(options) {
      var cols = options.cols || [];
      var rows = options.rows || [];
      var isLandscape = options.landscape != null ? options.landscape : cols.length > 6;

      var pageWidth = isLandscape ? 841.89 : 595.28;
      var pageHeight = isLandscape ? 595.28 : 841.89;
      var margin = 36;
      var contentWidth = pageWidth - margin * 2;

      var colAlignRight = cols.map(function (c, i) { return isNumericCol(c, rows, i); });

      var minWidth = 45;
      var weights = cols.map(function (c, i) {
        var max = String(c).length;
        for (var r = 0; r < Math.min(rows.length, 40); r++) {
          var len = String(rows[r] && rows[r][i] != null ? rows[r][i] : '').length;
          if (len > max) max = len;
        }
        return Math.max(max, 5);
      });
      var totalWeight = weights.reduce(function (a, b) { return a + b; }, 0) || 1;
      var colWidths = weights.map(function (w) { return Math.max(minWidth, (w / totalWeight) * contentWidth); });
      var curTotal = colWidths.reduce(function (a, b) { return a + b; }, 0);
      var factor = contentWidth / curTotal;
      colWidths = colWidths.map(function (w) { return w * factor; });

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

      var totalPages = pagesRows.length;
      var catalogId = 1;
      var pagesRootId = 2;
      var fontNormId = 3;
      var fontBoldId = 4;

      var pageObjIds = [];
      var contentObjIds = [];
      var nextId = 5;
      for (var i = 0; i < totalPages; i++) {
        pageObjIds.push(nextId++);
        contentObjIds.push(nextId++);
      }

      var pageStreams = [];

      for (var pIdx = 0; pIdx < totalPages; pIdx++) {
        var pRows = pagesRows[pIdx];
        var stream = [];
        var curY = pageHeight - margin;

        if (pIdx === 0) {
          // Branding Header
          stream.push('0.114 0.208 0.341 rg'); // #1d3557 deep navy
          stream.push('BT /F2 15 Tf ' + margin + ' ' + (curY - 14) + ' Td (Lab of Future CRM) Tj ET');

          // Date
          stream.push('0.45 0.50 0.55 rg');
          var dateStr = options.date || new Date().toLocaleString('en-GB');
          stream.push('BT /F1 8.5 Tf ' + (pageWidth - margin - 180).toFixed(2) + ' ' + (curY - 12) + ' Td (' + escapePdf('Generated: ' + dateStr) + ') Tj ET');
          curY -= 26;

          // Report Title
          stream.push('0.08 0.12 0.18 rg');
          stream.push('BT /F2 13 Tf ' + margin + ' ' + (curY - 13) + ' Td (' + escapePdf(options.title || 'Report') + ') Tj ET');
          curY -= 20;

          // Filter summary / Subtitle
          var filterLine = [options.filters, options.note ? ('Note: ' + options.note) : ''].filter(Boolean).join('   |   ');
          if (filterLine) {
            stream.push('0.40 0.45 0.50 rg');
            stream.push('BT /F1 8.5 Tf ' + margin + ' ' + (curY - 9) + ' Td (' + escapePdf(filterLine.slice(0, 150)) + ') Tj ET');
            curY -= 16;
          }
          curY -= 6;
        } else {
          // Continuation Header
          stream.push('0.35 0.40 0.45 rg');
          stream.push('BT /F2 9.5 Tf ' + margin + ' ' + (curY - 12) + ' Td (' + escapePdf((options.title || 'Report') + ' (continued)') + ') Tj ET');
          curY -= 22;
        }

        // Table Header Background
        stream.push('0.114 0.208 0.341 rg');
        stream.push(margin + ' ' + (curY - headerHeight).toFixed(2) + ' ' + contentWidth.toFixed(2) + ' ' + headerHeight + ' re f');

        // Column Headers Text
        stream.push('1 1 1 rg');
        var colX = margin;
        for (var c = 0; c < cols.length; c++) {
          var colW = colWidths[c];
          var title = String(cols[c] == null ? '' : cols[c]);
          var isRight = colAlignRight[c];
          var approxCharWidth = 5.2;
          var displayTitle = title.slice(0, Math.max(4, Math.floor((colW - 8) / approxCharWidth)));
          var textX = isRight ? (colX + colW - 6 - (displayTitle.length * approxCharWidth)) : (colX + 6);
          var textY = curY - headerHeight + 6.5;

          stream.push('BT /F2 8.5 Tf ' + textX.toFixed(2) + ' ' + textY.toFixed(2) + ' Td (' + escapePdf(displayTitle) + ') Tj ET');
          colX += colW;
        }
        curY -= headerHeight;

        // Table Rows
        for (var r = 0; r < pRows.length; r++) {
          var row = pRows[r];
          var isEven = r % 2 === 1;

          if (isEven) {
            stream.push('0.965 0.975 0.985 rg');
            stream.push(margin + ' ' + (curY - rowHeight).toFixed(2) + ' ' + contentWidth.toFixed(2) + ' ' + rowHeight + ' re f');
          }

          // Row separator line
          stream.push('0.88 0.90 0.92 RG 0.5 w');
          stream.push(margin + ' ' + (curY - rowHeight).toFixed(2) + ' m ' + (margin + contentWidth).toFixed(2) + ' ' + (curY - rowHeight).toFixed(2) + ' l S');

          // Cell text
          stream.push('0.12 0.15 0.20 rg');
          colX = margin;
          for (var cIdx = 0; cIdx < cols.length; cIdx++) {
            var cW = colWidths[cIdx];
            var val = String(row[cIdx] == null ? '' : row[cIdx]);
            var rightAlign = colAlignRight[cIdx];
            var charW = 4.8;
            var maxChars = Math.max(3, Math.floor((cW - 10) / charW));
            var displayVal = val.length > maxChars ? val.slice(0, maxChars - 1) + '…' : val;
            var cellY = curY - rowHeight + 5.5;
            var cTextX = rightAlign ? (colX + cW - 6 - (displayVal.length * charW)) : (colX + 6);

            stream.push('BT /F1 8 Tf ' + cTextX.toFixed(2) + ' ' + cellY.toFixed(2) + ' Td (' + escapePdf(displayVal) + ') Tj ET');
            colX += cW;
          }

          curY -= rowHeight;
        }

        // Outer table border
        stream.push('0.80 0.83 0.87 RG 0.75 w');
        var tableH = headerHeight + pRows.length * rowHeight;
        stream.push(margin + ' ' + curY.toFixed(2) + ' ' + contentWidth.toFixed(2) + ' ' + tableH.toFixed(2) + ' re S');

        // Page Footer
        stream.push('0.50 0.55 0.60 rg');
        stream.push('BT /F1 7.5 Tf ' + margin + ' ' + margin + ' Td (Lab of Future CRM   •   Confidential) Tj ET');
        stream.push('BT /F1 7.5 Tf ' + (pageWidth - margin - 70).toFixed(2) + ' ' + margin + ' Td (Page ' + (pIdx + 1) + ' of ' + totalPages + ') Tj ET');

        pageStreams.push(stream.join('\n'));
      }

      // Assemble Objects
      var objTable = {};
      objTable[catalogId] = '<< /Type /Catalog /Pages ' + pagesRootId + ' 0 R >>';
      objTable[pagesRootId] = '<< /Type /Pages /Kids [' + pageObjIds.map(function (id) { return id + ' 0 R'; }).join(' ') + '] /Count ' + totalPages + ' >>';
      objTable[fontNormId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
      objTable[fontBoldId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

      for (var j = 0; j < totalPages; j++) {
        var pId = pageObjIds[j];
        var cId = contentObjIds[j];
        var strm = pageStreams[j];
        objTable[pId] = '<< /Type /Page /Parent ' + pagesRootId + ' 0 R /MediaBox [0 0 ' + pageWidth.toFixed(2) + ' ' + pageHeight.toFixed(2) + '] /Contents ' + cId + ' 0 R /Resources << /Font << /F1 ' + fontNormId + ' 0 R /F2 ' + fontBoldId + ' 0 R >> >> >>';
        objTable[cId] = '<< /Length ' + strm.length + ' >>\nstream\n' + strm + '\nendstream';
      }

      var pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
      var offsets = [];
      var maxObj = 4 + totalPages * 2;

      for (var k = 1; k <= maxObj; k++) {
        offsets[k] = pdf.length;
        pdf += k + ' 0 obj\n' + objTable[k] + '\nendobj\n';
      }

      var xrefOffset = pdf.length;
      pdf += 'xref\r\n0 ' + (maxObj + 1) + '\r\n';
      pdf += '0000000000 65535 f \r\n';
      for (var m = 1; m <= maxObj; m++) {
        pdf += String(offsets[m]).padStart(10, '0') + ' 00000 n \r\n';
      }

      pdf += 'trailer\r\n<< /Size ' + (maxObj + 1) + ' /Root ' + catalogId + ' 0 R >>\r\nstartxref\r\n' + xrefOffset + '\r\n%%EOF\r\n';

      var bytes = new Uint8Array(pdf.length);
      for (var n = 0; n < pdf.length; n++) {
        bytes[n] = pdf.charCodeAt(n) & 0xff;
      }
      return new Blob([bytes], { type: 'application/pdf' });
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
      var html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">' +
        '<head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>' +
        '<x:Name>' + escXml(title.slice(0, 31)) + '</x:Name>' +
        '<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->' +
        '<style>' +
        'th { background-color: #1d3557; color: #ffffff; font-weight: bold; border: 1px solid #cccccc; padding: 6px 10px; font-family: Arial, sans-serif; }' +
        'td { border: 1px solid #e2e8f0; padding: 5px 8px; font-family: Arial, sans-serif; font-size: 13px; }' +
        '.even { background-color: #f8fafc; }' +
        '</style></head><body>' +
        '<h2>' + escXml(title) + '</h2>' +
        '<p style="color:#64748b;font-size:12px">Generated: ' + escXml(new Date().toLocaleString('en-GB')) + ' | Lab of Future CRM</p>' +
        '<table><thead><tr>' + cols.map(function (c) { return '<th>' + escXml(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        rows.map(function (r, rIdx) {
          return '<tr' + (rIdx % 2 === 1 ? ' class="even"' : '') + '>' +
            r.map(function (c) { return '<td>' + escXml(c) + '</td>'; }).join('') + '</tr>';
        }).join('') + '</tbody></table></body></html>';
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
          cols.forEach(function (c, i) { obj[c] = r[i]; });
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
      var dateStr = report.date || new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dubai', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

      var escH = function (s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
          return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
      };

      var chartHtml = '';
      if (chart && chart.length) {
        var maxVal = Math.max.apply(null, chart.map(function (x) { return x.v || 0; })) || 1;
        chartHtml = '<div class="chart-box"><h3>Visual Summary</h3><div class="chart-bars">' +
          chart.map(function (it) {
            var pct = Math.max(2, Math.round(((it.v || 0) / maxVal) * 100));
            return '<div class="c-row"><div class="c-lbl">' + escH(it.l) + '</div>' +
              '<div class="c-track"><div class="c-fill" style="width:' + pct + '%"></div></div>' +
              '<div class="c-val">' + escH(it.v) + '</div></div>';
          }).join('') + '</div></div>';
      }

      var html = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
        '<title>' + escH(title) + ' - Lab of Future CRM</title>' +
        '<style>' +
        '@page { size: ' + (cols.length > 6 ? 'landscape' : 'portrait') + '; margin: 12mm; }' +
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
        '<div class="meta">Exported: ' + escH(dateStr) + '</div>' +
        '</div>' +
        '<div class="title-section">' +
        '<h1>' + escH(title) + '</h1>' +
        (filters ? '<div class="filters-tag">' + escH(filters) + '</div>' : '') +
        (note ? '<p style="color:#64748b;font-size:12px;margin:6px 0 0">' + escH(note) + '</p>' : '') +
        '</div>' +
        chartHtml +
        '<table><thead><tr>' + cols.map(function (c) { return '<th>' + escH(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        rows.map(function (r) {
          return '<tr>' + r.map(function (c) { return '<td>' + escH(c) + '</td>'; }).join('') + '</tr>';
        }).join('') +
        '</tbody></table>' +
        '<div class="foot">' +
        '<div>Lab of Future CRM • Confidential Report</div>' +
        '<div>Total Rows: ' + rows.length + '</div>' +
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
            var k = (typeof dayKey === 'function') ? dayKey(p.at) : String(p.at).slice(0, 10);
            days[k] = days[k] || { n: 0, t: {} };
            days[k].n++;
            days[k].t[p.method] = (days[k].t[p.method] || 0) + (typeof toAED === 'function' ? toAED(p.amt, p.cur) : p.amt);
          });
          var ks = Object.keys(days).sort().reverse();
          var cols = ['Date', 'Receipts'].concat(pm.map(function (m) { return m + ' (AED eq.)'; }), ['Total (AED eq.)']);
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
          var chart = ks.slice(0, 10).reverse().map(function (k) {
            var sum = Object.values(days[k].t).reduce(function (a, x) { return a + x; }, 0);
            return { l: k, v: Math.round(sum) };
          });
          var bName = typeof branchName === 'function' ? branchName(b) : b;
          return {
            cols: cols,
            rows: rows,
            chart: chart,
            note: 'Restricted to ' + bName + ' (Assigned Location). All amounts in AED equivalent.'
          };
        }
        return _origRepR1.apply(this, arguments);
      };
    }

    function getActiveReportContext() {
      var id = S.rep ? S.rep.id : 'r1';
      if (isReceptionStaff()) {
        if (id !== 'r1' && id !== 'r22') {
          id = 'r1';
          if (S.rep) S.rep.id = 'r1';
        }
      }

      var def = (RDEF || []).find(function (r) { return r[0] === id; }) || [id, 'Report'];
      var reportName = def[1];
      var f = (typeof RF === 'function' ? RF() : (S.rep && S.rep.f)) || {};

      if (!isBranchPrivileged()) {
        var userBr = userAssignedBranch();
        if (f && userBr) f.branch = userBr;
        if (id === 'r1') {
          reportName = 'Daily Collection Report – ' + (typeof branchName === 'function' ? branchName(userBr) : userBr);
        }
      }

      var res = (REP && REP[id]) ? REP[id]() : { cols: [], rows: [] };
      var fParts = [];
      if (f.range) fParts.push('Range: ' + (f.range === '7' ? 'Last 7 days' : f.range === '30' ? 'Last 30 days' : f.range === 'month' ? 'This month' : 'All time'));
      
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
      var dateStr = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dubai', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

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

    ACT.repExportAll = function () {
      if (!isBranchPrivileged()) {
        if (typeof toast === 'function') toast('Multi-branch summary export is restricted to System Administrators and Management.', 'warn');
        return;
      }
      var summaryRows = [];
      (RDEF || []).forEach(function (r, idx) {
        var rId = r[0];
        var rName = r[1];
        var rRes = (REP && REP[rId]) ? REP[rId]() : { cols: [], rows: [] };
        summaryRows.push([
          String(idx + 1),
          rId.toUpperCase(),
          rName,
          String(rRes.rows ? rRes.rows.length : 0),
          (rRes.cols || []).slice(0, 4).join(', ') + ((rRes.cols || []).length > 4 ? '...' : '')
        ]);
      });
      var blob = buildPdfBlob({
        title: 'Executive Reports Directory & Summary',
        cols: ['#', 'Report ID', 'Report Title', 'Active Rows', 'Columns Preview'],
        rows: summaryRows,
        filters: 'Consolidated Directory of all 22 CRM Reports',
        note: 'Complete summary of all operational and management reports',
        date: new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dubai', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      });
      downloadBlob(blob, 'lof-crm-all-22-reports-summary.pdf');
      if (typeof addAudit === 'function') addAudit('All reports exported (PDF summary)', 'all', '22 Reports Directory');
      if (typeof toast === 'function') toast('Executive Summary PDF downloaded', 'ok');
    };

    ACT.repExportModal = function () {
      if (typeof openModal === 'function') openModal('reportExport');
    };

    ACT.doRepPdf = function () { if (typeof closeModal === 'function') closeModal(); ACT.repPdf(); };
    ACT.doRepPrint = function () { if (typeof closeModal === 'function') closeModal(); ACT.repPrint(); };
    ACT.doRepCsv = function () { if (typeof closeModal === 'function') closeModal(); ACT.repCsv(); };
    ACT.doRepXls = function () { if (typeof closeModal === 'function') closeModal(); ACT.repXls(); };
    ACT.doRepJson = function () { if (typeof closeModal === 'function') closeModal(); ACT.repJson(); };
    ACT.doRepAllPdf = function () { if (typeof closeModal === 'function') closeModal(); ACT.repExportAll(); };
    ACT.repCopyClipboard = function () {
      var ctx = getActiveReportContext();
      var escCsv = function (v) { v = String(v == null ? '' : v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      var text = [ctx.cols.map(escCsv).join(',')].concat(ctx.rows.map(function (r) { return r.map(escCsv).join(','); })).join('\n');
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

      var allPdfCard = !isPriv ? '' :
        '<div class="card" style="padding:14px;border:1px solid var(--line);border-radius:8px;cursor:pointer" data-act="doRepAllPdf">' +
          '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="font-size:22px">📚</span><b>All 22 Reports Summary</b></div>' +
          '<p class="muted xs" style="margin:0 0 10px">Consolidated multi-report executive directory PDF covering all 22 CRM reports.</p>' +
          '<button class="btn sm ghost" type="button" data-act="doRepAllPdf">' + ic('file') + ' Export All PDF</button>' +
        '</div>';

      var body = '<div class="banner">' + ic('file') + '<span>Exporting <b>' + esc(ctx.name) + '</b> (' + rowCount + ' row' + (rowCount === 1 ? '' : 's') + ', ' + colCount + ' columns). Select your preferred format:</span></div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:16px 0">' +
        '<div class="card" style="padding:14px;border:1px solid var(--line);border-radius:8px;cursor:pointer" data-act="doRepPdf">' +
          '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="font-size:22px">📄</span><b>PDF Document (.pdf)</b></div>' +
          '<p class="muted xs" style="margin:0 0 10px">Formatted official document with Lab of Future branding, tables, auto-pagination.</p>' +
          '<button class="btn sm primary" type="button" data-act="doRepPdf">' + ic('download') + ' Download PDF</button>' +
        '</div>' +
        '<div class="card" style="padding:14px;border:1px solid var(--line);border-radius:8px;cursor:pointer" data-act="doRepPrint">' +
          '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="font-size:22px">🖨️</span><b>Print / Save as PDF</b></div>' +
          '<p class="muted xs" style="margin:0 0 10px">Interactive print-ready preview with SVG charts, browser native vector PDF save.</p>' +
          '<button class="btn sm" type="button" data-act="doRepPrint">Open Print View</button>' +
        '</div>' +
        '<div class="card" style="padding:14px;border:1px solid var(--line);border-radius:8px;cursor:pointer" data-act="doRepCsv">' +
          '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="font-size:22px">📊</span><b>CSV Spreadsheet (.csv)</b></div>' +
          '<p class="muted xs" style="margin:0 0 10px">Raw tabular data with UTF-8 BOM, ideal for Microsoft Excel and Google Sheets.</p>' +
          '<button class="btn sm" type="button" data-act="doRepCsv">' + ic('download') + ' Download CSV</button>' +
        '</div>' +
        '<div class="card" style="padding:14px;border:1px solid var(--line);border-radius:8px;cursor:pointer" data-act="doRepXls">' +
          '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="font-size:22px">📑</span><b>Excel Workbook (.xls)</b></div>' +
          '<p class="muted xs" style="margin:0 0 10px">Structured Excel XML spreadsheet with styled headers and column widths.</p>' +
          '<button class="btn sm" type="button" data-act="doRepXls">' + ic('download') + ' Download Excel</button>' +
        '</div>' +
        '<div class="card" style="padding:14px;border:1px solid var(--line);border-radius:8px;cursor:pointer" data-act="doRepJson">' +
          '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="font-size:22px">📦</span><b>JSON Dataset (.json)</b></div>' +
          '<p class="muted xs" style="margin:0 0 10px">Structured API format containing metadata, column specs, and rows.</p>' +
          '<button class="btn sm ghost" type="button" data-act="doRepJson">' + ic('download') + ' Download JSON</button>' +
        '</div>' +
        allPdfCard +
        '</div>';

      return {
        title: 'Export Report – ' + esc(ctx.name),
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
                ['r22', 'Instalment Status Report (' + bName + ')']
              ];
              return '<div class="list" style="padding:6px">' +
                '<div style="padding:4px 8px;font-size:11px;font-weight:700;color:var(--muted,#64748b);text-transform:uppercase;letter-spacing:0.5px">Branch Reports</div>' +
                items.map(function (it, idx) {
                  var on = S.rep.id === it[0];
                  return '<div class="cl" tabindex="0" data-act="go" data-page="reports" data-rep="' + it[0] + '" style="border:0;border-radius:6px;cursor:pointer;padding:8px 10px;display:block;margin-bottom:4px;' + (on ? 'background:var(--accent-soft);color:var(--accent);font-weight:600' : '') + '">' + (idx + 1) + '. ' + esc(it[1]) + '</div>';
                }).join('') +
                '</div></div>';
            });

            // Add Receptionist restriction banner
            var bannerHtml = '<div class="banner" style="margin-bottom:12px">' + ic('shield') + '<span><b>Branch Restricted:</b> As Reception, your collection reports and exports are restricted strictly to your assigned location (<b>' + esc(bName) + '</b>).</span></div>';
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
            '<button class="btn primary" data-act="repPdf" title="Download report as formatted PDF">' + ic('file') + ' Export PDF</button>' +
            '<button class="btn" data-act="repCsv" title="Download report as CSV spreadsheet">' + ic('download') + ' Export CSV</button>' +
            '<button class="btn ghost" data-act="repExportModal" title="More download formats (Excel, JSON, Print)">' + ic('list') + ' More Formats ▾</button>' +
          '</div>'
        );
      };
    }

    // Enhance PAGES.payRecords with direct Daily Collection shortcut
    if (typeof PAGES !== 'undefined' && PAGES.payRecords) {
      var _origPayRecords = PAGES.payRecords;
      PAGES.payRecords = function () {
        var html = _origPayRecords.apply(this, arguments);
        var isRec = isReceptionStaff();
        var extraBtn = isRec ? ('<button class="btn ghost" data-act="goDailyCol" title="Open Daily Collection Report for assigned branch">' + ic('chart') + ' Daily Collection Report</button>') : '';
        return html.replace(
          '<button class="btn" data-act="payCsv">Export CSV</button>',
          '<div class="row" style="gap:6px;display:inline-flex">' +
            '<button class="btn primary" data-act="payPdf" title="Download payments as PDF">' + ic('file') + ' Export PDF</button>' +
            '<button class="btn" data-act="payCsv" title="Download payments as CSV">' + ic('download') + ' Export CSV</button>' +
            extraBtn +
          '</div>'
        );
      };

      ACT.goDailyCol = function () {
        if (typeof go === 'function') go('reports', { rep: 'r1' });
      };

      ACT.payPdf = function () {
        var ps = (S.pay || []).filter(function (p) { return typeof inScope === 'function' ? inScope(p.branch) : true; });
        var rows = ps.map(function (p) {
          var s = typeof stuById === 'function' ? stuById(p.stu) : null;
          var sName = s ? (s.first + ' ' + s.last) : p.stu;
          var bName = typeof branchName === 'function' ? branchName(p.branch) : p.branch;
          var amtStr = typeof money === 'function' ? money(p.amt, p.cur) : (p.cur + ' ' + p.amt);
          var dateStr = typeof fDT === 'function' ? fDT(p.at) : p.at;
          return [p.id, dateStr, sName, bName, p.enr, amtStr, p.method, p.ref || '—', p.rc];
        });
        var isRec = isReceptionStaff();
        var title = isRec ? ('Payment Records – ' + branchName(receptionBranch())) : 'Payment Records';
        var blob = buildPdfBlob({
          title: title,
          cols: ['Payment ID', 'Date', 'Student', 'Branch', 'Enrolment', 'Amount', 'Method', 'Reference', 'Receipt'],
          rows: rows,
          filters: isRec ? ('Location: ' + branchName(receptionBranch()) + ' (Assigned Branch)') : ('Active Branch Scope (' + rows.length + ' records)'),
          date: new Date().toLocaleString('en-GB'),
        });
        downloadBlob(blob, isRec ? ('payment-records-' + receptionBranch().toLowerCase() + '.pdf') : 'payment-records.pdf');
        if (typeof addAudit === 'function') addAudit('Payment records exported (PDF)', 'payments', rows.length + ' records');
        if (typeof toast === 'function') toast('Payment records PDF downloaded (' + rows.length + ' rows)', 'ok');
      };
    }

    // Enhance generic MODALS.csv
    if (typeof MODALS !== 'undefined' && MODALS.csv) {
      var _origModalCsv = MODALS.csv;
      MODALS.csv = function (m) {
        var x = _origModalCsv(m);
        MODALS._lastExportData = m;
        x.foot = '<button class="btn" data-act="closeModal">Close</button>' +
          '<button class="btn" data-act="modalDownloadPdf">' + ic('file') + ' Download PDF</button>' +
          '<button class="btn" data-act="modalDownloadCsv">' + ic('download') + ' Download CSV</button>' +
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
        return (S.branches || []).filter(function (b) {
          return allowed.includes(b.id);
        }).map(function (b) {
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
          html = html.replace(/all permitted branches/, typeof esc === 'function' ? esc(userAssignedBranchNames()) : userAssignedBranchNames());
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
              '<select name="branch" disabled style="background:var(--bg,#f8fafc);cursor:not-allowed"><option value="' + esc(primaryBr) + '" selected>' + esc(bName) + ' (Assigned)</option></select>' +
              '<input type="hidden" name="branch" value="' + esc(primaryBr) + '">'
            );
          } else {
            var allowedOpts = assigned.map(function (bid) {
              var n = typeof branchName === 'function' ? branchName(bid) : bid;
              return '<option value="' + esc(bid) + '">' + esc(n) + '</option>';
            }).join('');
            res.body = res.body.replace(
              /<select name="branch"[\s\S]*?<\/select>/,
              '<select name="branch" data-change="leadBranch" required>' + allowedOpts + '</select>'
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
              '<select name="branch" disabled style="background:var(--bg,#f8fafc);cursor:not-allowed"><option value="' + esc(primaryBr) + '" selected>' + esc(bName) + ' (Assigned)</option></select>' +
              '<input type="hidden" name="branch" value="' + esc(primaryBr) + '">'
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
            S.dashF.branch = assigned.length === 1 ? assigned[0] : (assigned.includes(el.value) ? el.value : (assigned[0] || ''));
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
            S.lf.branch = assigned.length === 1 ? assigned[0] : (assigned.includes(el.value) ? el.value : (assigned[0] || ''));
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
            S.apF.branch = assigned.length === 1 ? assigned[0] : (assigned.includes(el.value) ? el.value : (assigned[0] || ''));
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
            S.rep.f.branch = assigned.length === 1 ? assigned[0] : (assigned.includes(el.value) ? el.value : (assigned[0] || ''));
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
  if (!window.LOF_API) return;
  var API = window.LOF_API.base;
  var LS = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { } },
  };
  // Sessions live in an HttpOnly cookie the page cannot read; remove tokens left by older versions
  LS.set('lof_token', null);
  var SERVER = { integrations: {}, impersonation: false };
  var COLL = { branches: 1, programs: 1, fees: 1, discounts: 1, staff: 1, leads: 1, opps: 1, students: 1, enr: 1, pay: 1, ms: 1, refunds: 1, approvals: 1, tasks: 1, calls: 1, comms: 1, notifs: 1, audit: 1 };
  var SETTINGS = ['cfg', 'perms', 'scope', 'fx', 'hist'];
  var EXACT = ['lead', 'opp', 'enr', 'pay', 'student', 'ap', 'rf', 'pd'];
  var BLOCK = ['ms', 'task', 'call', 'cm', 'notif', 'audit'];
  var p2 = function (n, w) { return String(n).padStart(w, '0'); };
  var FMT = {
    lead: function (n) { return 'LD-26-' + n; }, opp: function (n) { return 'OP-26-' + p2(n, 4); }, enr: function (n) { return 'EN-26-' + p2(n, 4); },
    pay: function (n) { return 'PY-26-' + p2(n, 4); }, student: function (n) { return 'LOF-26-' + p2(n, 6); }, ap: function (n) { return 'AP-26-' + p2(n, 4); },
    rf: function (n) { return 'RF-26-' + p2(n, 4); }, pd: function (n) { return 'PD-' + p2(n, 2); },
  };
  var INTEG_LABEL = { website: 'Website', meta: 'Meta', whatsapp: 'WhatsApp', exotel: 'Exotel', lms: 'LMS', telr: 'Telr', razorpay: 'Razorpay', erpnext: 'ERPNext', gcal: 'Google Calendar', email: 'E-mail' };

  // ------------------------------------------------------------------ HTTP
  function req(method, path, body) {
    return fetch(API + path, {
      method: method,
      headers: { 'content-type': 'application/json', 'x-lof-csrf': '1' },
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = null;
        try { j = t ? JSON.parse(t) : null; } catch (e) { }
        if (r.status === 401 && path.indexOf('/auth/') < 0) { signOut('Your session has ended – please sign in again.'); throw new Error('Signed out'); }
        if (r.status === 403 && j && j.details && (j.details.code === 'password_change' || j.details.code === 'mfa_setup')) { stageScreen(j.details.code); throw new Error('Signed out'); }
        if (!r.ok) { var err = new Error((j && j.error) || ('HTTP ' + r.status)); err.status = r.status; err.body = j; throw err; }
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

  // ------------------------------------------------------------------ sequences
  var remaps = [];
  function makeSeq(peek) {
    var st = { peek: Object.assign({}, peek), blocks: {} };
    var rc = {};
    Object.keys(peek).forEach(function (k) { if (k.indexOf('rc_') === 0) rc[k.slice(3)] = peek[k] - 1; });
    var target = { rc: rc };
    return new Proxy(target, {
      get: function (t, k) {
        if (k === 'rc') return t.rc;
        if (EXACT.indexOf(k) >= 0) return st.peek[k] || 1;
        if (BLOCK.indexOf(k) >= 0) {
          var b = st.blocks[k];
          if (!b || b.next >= b.end) { var r = xhr('POST', '/seq/block', { name: k, size: 20 }); b = st.blocks[k] = { next: r.start, end: r.start + r.size }; }
          return b.next;
        }
        return t[k];
      },
      set: function (t, k, v) {
        if (EXACT.indexOf(k) >= 0) {
          var expect = st.peek[k] || 1;
          var r = xhr('POST', '/seq/claim', { name: k, expect: expect });
          if (!r.ok && FMT[k]) remaps.push({ from: FMT[k](expect), to: FMT[k](r.value) });
          st.peek[k] = r.value + 1;
          return true;
        }
        if (BLOCK.indexOf(k) >= 0) { if (st.blocks[k]) st.blocks[k].next++; return true; }
        t[k] = v;
        return true;
      },
    });
  }
  /** Another user took the number we showed: rename the new record everywhere before it is saved. */
  function applyRemaps() {
    if (!remaps.length) return;
    var list = remaps.splice(0);
    list.forEach(function (m) {
      var re = new RegExp(m.from.replace(/[-]/g, '\\-') + '(?![0-9])', 'g');
      Object.keys(COLL).forEach(function (c) {
        (S[c] || []).forEach(function (d, i) {
          var j = JSON.stringify(d);
          if (j.indexOf(m.from) >= 0) S[c][i] = JSON.parse(j.replace(re, m.to));
        });
      });
      if (S.route && S.route.id === m.from) S.route.id = m.to;
      toast('Number ' + m.from + ' was just taken by a colleague – saved as ' + m.to, 'warn');
    });
  }

  // ------------------------------------------------------------------ snapshot & sync
  var snap = {}, snapSet = {}, busy = false, again = false, deferredRender = false;
  function takeSnap() {
    snap = {};
    Object.keys(COLL).forEach(function (c) {
      var m = new Map();
      (S[c] || []).forEach(function (d) { m.set(d.id, JSON.stringify(d)); });
      snap[c] = m;
    });
    snapSet = {};
    SETTINGS.forEach(function (k) { snapSet[k] = JSON.stringify(S[k]); });
  }
  /** Remove prototype "(simulated …)" wording from text the screens write; integrations are real now. */
  var SIM_RE = /\s?\((?:simulated|Simulated)[^)"]*\)/g;
  function clean(j) { return SIM_RE.test(j) ? (SIM_RE.lastIndex = 0, j.replace(SIM_RE, '')) : j; }
  function diff(dry) {
    var changes = [], settings = [];
    Object.keys(COLL).forEach(function (c) {
      var seen = new Set();
      (S[c] || []).forEach(function (d) {
        if (!d || !d.id) return;
        seen.add(d.id);
        var j = JSON.stringify(d);
        var before = snap[c].get(d.id);
        if (before !== j) {
          j = clean(j);
          if (before === j) return;
          var ch = { coll: c, id: d.id, op: 'upsert', doc: JSON.parse(j) };
          if (before) ch.base = JSON.parse(clean(before)); // the version this user edited – the server applies only their changes
          changes.push(ch);
          if (!dry) snap[c].set(d.id, j);
        }
      });
      snap[c].forEach(function (_, id) { if (!seen.has(id)) { changes.push({ coll: c, id: id, op: 'delete' }); if (!dry) snap[c].delete(id); } });
    });
    SETTINGS.forEach(function (k) {
      var j = JSON.stringify(S[k]);
      if (snapSet[k] !== j) { settings.push({ key: k, doc: JSON.parse(j) }); if (!dry) snapSet[k] = j; }
    });
    return { changes: changes, settings: settings };
  }
  function mergeDocs(docs) {
    (docs || []).forEach(function (x) {
      var arr = S[x.coll];
      if (!arr) return;
      var i = arr.findIndex(function (d) { return d.id === x.doc.id; });
      if (i >= 0) arr[i] = x.doc; else arr.unshift(x.doc);
      snap[x.coll].set(x.doc.id, JSON.stringify(x.doc));
    });
  }
  function userIsTyping() {
    var a = document.activeElement;
    return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.id !== 'gs' && a.id !== 'lq' && a.id !== 'sq' && a.id !== 'auq');
  }
  function safeRender() {
    if (S.modal || userIsTyping() || (S.route.page === 'wizard')) { deferredRender = true; return; }
    deferredRender = false;
    render();
  }
  function flush() {
    if (!S || !snap.leads) return Promise.resolve();
    if (busy) { again = true; return Promise.resolve(); }
    applyRemaps();
    var d = diff();
    if (!d.changes.length && !d.settings.length) return Promise.resolve();
    busy = true;
    setSaving(true);
    return req('PUT', '/sync', d)
      .then(function (r) {
        mergeDocs(r.docs);
        if (r.settings && r.settings.length) SETTINGS.forEach(function (k) { snapSet[k] = JSON.stringify(S[k]); });
        (r.notices || []).forEach(function (n) { toast(n, 'ok'); });
        safeRender();
      })
      .catch(function (e) {
        if (e.message === 'Signed out') return;
        toast('Not saved: ' + e.message, 'err');
        return reload(true);
      })
      .then(function () {
        busy = false;
        setSaving(false);
        if (again) { again = false; return flush(); }
      });
  }
  var flushTimer = null;
  function scheduleFlush(ms) { clearTimeout(flushTimer); flushTimer = setTimeout(flush, ms || 0); }
  ['click', 'submit', 'change', 'drop'].forEach(function (ev) { document.addEventListener(ev, function () { scheduleFlush(30); }); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === 'Escape') scheduleFlush(30); });
  window.addEventListener('beforeunload', function (e) { if (S && snap.leads && (diff(true).changes.length || busy)) { flush(); e.preventDefault(); } });

  function setSaving(on) {
    var el = document.getElementById('lofSaving');
    if (!el) { el = document.createElement('div'); el.id = 'lofSaving'; el.style.cssText = 'position:fixed;left:50%;top:8px;transform:translateX(-50%);z-index:300;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:2px 10px;font-size:11.5px;color:var(--muted);box-shadow:var(--shadow);display:none'; el.textContent = 'Saving…'; document.body.appendChild(el); }
    el.style.display = on ? 'block' : 'none';
  }

  // ------------------------------------------------------------------ load
  function applyBootstrap(b, keepUi) {
    SERVER = b.server;
    if (!keepUi) {
      S = seed(); // UI state shape from the prototype; data is replaced below
      S.saved = JSON.parse(LS.get('lof_saved_filters') || 'null') || S.saved;
      S.theme = LS.get('lof_theme') || null;
    }
    Object.keys(COLL).forEach(function (c) { S[c] = b.data[c] || []; });
    SETTINGS.forEach(function (k) { S[k] = b.data[k] || {}; });
    S.user = b.me.id;
    if (b.me && b.me.role === 'Reception' && S.perms && S.perms.reports) {
      S.perms.reports.Reception = 'V';
    }
    if (b.me && !['Management', 'System Administrator'].includes(b.me.role)) {
      var assigned = b.me.branch;
      if (assigned) {
        S.dashF = S.dashF || {};
        S.dashF.branch = assigned;
        S.lf = S.lf || {};
        S.lf.branch = assigned;
        S.rep = S.rep || { id: 'r1', f: {} };
        S.rep.f = S.rep.f || {};
        S.rep.f.branch = assigned;
        S.apF = S.apF || {};
        S.apF.branch = assigned;
      }
    }
    S.lmsServerReady = !!b.server.lmsSecrets;
    S.seq = makeSeq(b.seq);
    if (!keepUi) { S.calSel = TODAY; S.calMonth = TODAY.slice(0, 7); }
    takeSnap();
  }
  function reload(force) {
    if (!force && (busy || S.modal || userIsTyping())) return Promise.resolve();
    return req('GET', '/bootstrap').then(function (b) {
      NOW = new Date();
      applyBootstrap(b, true);
      safeRender();
    });
  }
  function start() {
    var app = document.getElementById('app');
    app.innerHTML = '<div style="display:grid;place-items:center;height:100%;color:var(--muted)">Loading Lab of Future CRM…</div>';
    return req('GET', '/bootstrap').then(function (b) {
      applyBootstrap(b, false);
      render();
      startTimers();
    }).catch(function (e) { if (e.message !== 'Signed out') app.innerHTML = '<div class="empty"><b>Could not load the CRM</b>' + esc(e.message) + '</div>'; });
  }
  var timers = [];
  function startTimers() {
    timers.forEach(clearInterval);
    timers = [
      setInterval(function () { NOW = new Date(); TODAY = dayKey(NOW.toISOString()); BASE = Date.parse(TODAY + 'T00:00:00+04:00'); }, 30000),
      setInterval(function () { if (document.visibilityState === 'visible') flush().then(function () { return reload(false); }); }, 45000),
      setInterval(pollIncoming, 8000),
    ];
  }
  var callSince = new Date().toISOString();
  function pollIncoming() {
    if (!S || document.visibilityState !== 'visible' || S.callPop) return;
    req('GET', '/calls/incoming?since=' + encodeURIComponent(callSince)).then(function (r) {
      callSince = r.now;
      var ev = (r.events || []).find(function (e) { return e.lead_id && leadById(e.lead_id); });
      if (ev) { S.callPop = ev.lead_id; S.callPopReal = true; render(); }
    }).catch(function () { });
  }

  // ------------------------------------------------------------------ sign-in
  function signOut(msg) {
    timers.forEach(clearInterval); timers = [];
    // drop everything the previous user could see before showing the sign-in screen
    S = null; S_sel = {}; Object.keys(snap).forEach(function (k) { snap[k] = new Map(); }); snapSet = {};
    loginScreen(msg);
  }
  var pendingPw = null; // kept in memory only between "sign in" and the forced password change
  function authCard(sub, msg, inner, btn, foot) {
    document.getElementById('app').innerHTML =
      '<div style="min-height:100%;display:grid;place-items:center;padding:16px;background:var(--bg)">' +
      '<form id="lofAuth" class="card" style="width:min(100%,410px);box-shadow:0 10px 25px -5px rgba(0,0,0,0.1),0 8px 10px -6px rgba(0,0,0,0.06);border-radius:12px;overflow:hidden" novalidate>' +
      '<div style="padding:22px 24px 16px;text-align:center;background:linear-gradient(180deg,#ffffff 0%,#f8fafc 100%);border-bottom:1px solid var(--line,#e2e8f0)">' +
      '<div style="display:flex;justify-content:center;align-items:center;margin-bottom:8px">' +
      '<img src="/lof-logo.png" alt="Lab of Future - Be Curious" style="max-height:56px;max-width:240px;object-fit:contain" onerror="this.onerror=null;this.src=\'/lof-mark.png\';this.style.maxHeight=\'48px\'">' +
      '</div>' +
      '<div style="font-size:11px;font-weight:700;color:var(--accent,#1d4ed8);letter-spacing:1px;text-transform:uppercase">CRM Portal</div>' +
      '<div class="muted xs" style="margin-top:4px">' + esc(sub) + '</div>' +
      '</div>' +
      '<div class="bd" style="padding:20px 24px 24px;display:flex;flex-direction:column;gap:14px">' +
      (msg ? '<div class="banner" style="margin:0">' + esc(msg) + '</div>' : '') + inner +
      '<div class="fe" id="lofErr" role="alert"></div>' +
      '<button class="btn primary" type="submit" style="justify-content:center;padding:10px 16px;font-weight:600">' + esc(btn) + '</button>' +
      (foot ? '<div style="margin-top:4px;text-align:center">' + foot + '</div>' : '') +
      '</div></form></div>';
    var f = document.getElementById('lofAuth');
    var first = f.querySelector('input:not([type=hidden])');
    if (first) first.focus();
    return f;
  }
  function onSubmit(f, fn) {
    f.addEventListener('submit', function (e) {
      e.preventDefault(); e.stopPropagation();
      var btn = f.querySelector('button[type=submit]');
      btn.disabled = true;
      Promise.resolve(fn(Object.fromEntries(new FormData(f).entries()), document.getElementById('lofErr')))
        .catch(function (x) { document.getElementById('lofErr').textContent = x.message; })
        .then(function () { if (document.body.contains(btn)) btn.disabled = false; });
    }, true);
  }
  function afterAuth(stage) {
    if (stage === 'password_change' || stage === 'mfa_setup') stageScreen(stage); else start();
  }
  function loginScreen(msg, needCode, remembered) {
    var foot = needCode ? '' :
      '<a href="javascript:void(0)" id="linkForgotPw" style="font-size:12.5px;color:var(--accent,#2563eb);text-decoration:none;font-weight:500;cursor:pointer">Forgot your password?</a>';

    var f = authCard(
      needCode ? 'Enter the 6-digit code from your authenticator app' : 'Sign in with your work credentials',
      msg,
      needCode
        ? '<input type="hidden" name="email" value="' + esc(remembered.email) + '"><input type="hidden" name="password" value="' + esc(remembered.password) + '"><div class="f"><label for="lc">Verification code</label><input id="lc" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></div>'
        : '<div class="f"><label for="le">Work E-mail</label><input id="le" name="email" type="email" autocomplete="username" placeholder="name@example.com" required></div>' +
          '<div class="f"><div style="display:flex;justify-content:space-between;align-items:center"><label for="lp" style="margin:0">Password</label></div><input id="lp" name="password" type="password" autocomplete="current-password" required></div>',
      needCode ? 'Verify and Sign In' : 'Sign In',
      foot
    );

    var forgotLink = document.getElementById('linkForgotPw');
    if (forgotLink) {
      forgotLink.addEventListener('click', function (e) {
        e.preventDefault();
        forgotPasswordScreen();
      });
    }

    onSubmit(f, function (d) {
      return req('POST', '/auth/login', { email: d.email, password: d.password, code: d.code }).then(function (r) {
        if (r.mfaRequired) return loginScreen('', true, { email: d.email, password: d.password });
        pendingPw = r.stage === 'password_change' ? d.password : null;
        afterAuth(r.stage);
      });
    });
  }

  function forgotPasswordScreen(msg, emailPrefill) {
    var foot = '<a href="javascript:void(0)" id="linkBackToLogin" style="font-size:12.5px;color:var(--muted,#64748b);text-decoration:none;cursor:pointer">← Back to Sign In</a>';

    var f = authCard(
      'Self-Service Password Reset',
      msg || 'Enter your registered work e-mail address. We will verify your account and provide a 6-digit reset code.',
      '<div class="f"><label for="fpe">Work E-mail</label><input id="fpe" name="email" type="email" autocomplete="email" placeholder="name@example.com" value="' + esc(emailPrefill || '') + '" required autofocus></div>',
      'Send Verification Code',
      foot
    );

    var backLink = document.getElementById('linkBackToLogin');
    if (backLink) {
      backLink.addEventListener('click', function (e) {
        e.preventDefault();
        loginScreen();
      });
    }

    onSubmit(f, function (d, err) {
      var email = (d.email || '').trim().toLowerCase();
      if (!email || email.indexOf('@') < 0) {
        err.textContent = 'Please enter a valid work e-mail address.';
        return;
      }
      return req('POST', '/auth/forgot-password/request', { email: email }).then(function (res) {
        confirmResetPasswordScreen(email, res.message, res.devCode);
      });
    });
  }

  function confirmResetPasswordScreen(email, msg, devCode) {
    var foot = '<div style="display:flex;justify-content:space-between;font-size:12px">' +
      '<a href="javascript:void(0)" id="linkResend" style="color:var(--accent,#2563eb);text-decoration:none;cursor:pointer">Resend code</a>' +
      '<a href="javascript:void(0)" id="linkBackToLogin2" style="color:var(--muted,#64748b);text-decoration:none;cursor:pointer">Back to Sign In</a>' +
    '</div>';

    var devBanner = devCode ?
      '<div class="banner" style="margin:0;background:var(--ok-bg,#ecfdf5);color:var(--ok,#059669);border:1px solid var(--ok);font-size:12px">' +
      '<b>Verification Code:</b> <span class="mono" style="font-weight:700;font-size:14px;letter-spacing:1px">' + esc(devCode) + '</span><br>' +
      '<span class="xs" style="opacity:0.9">In development / testing mode, the code is provided directly here.</span></div>' : '';

    var f = authCard(
      'Set New Password',
      msg || ('A verification code has been sent for ' + esc(email) + '.'),
      devBanner +
      '<input type="hidden" name="email" value="' + esc(email) + '">' +
      '<div class="f"><label for="rpc">6-Digit Verification Code</label><input id="rpc" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="e.g. 123456" pattern="[0-9]{6}" required value="' + esc(devCode || '') + '"></div>' +
      '<div class="f"><label for="rpn">New Password</label><input id="rpn" name="next" type="password" autocomplete="new-password" placeholder="At least 10 characters" required></div>' +
      '<div class="f"><label for="rpn2">Confirm New Password</label><input id="rpn2" name="next2" type="password" autocomplete="new-password" placeholder="Re-enter new password" required>' +
      '<div class="help" style="margin-top:4px">At least 10 characters using three of: lower-case, upper-case, digits, symbols.</div></div>',
      'Reset Password',
      foot
    );

    var resendLink = document.getElementById('linkResend');
    if (resendLink) {
      resendLink.addEventListener('click', function (e) {
        e.preventDefault();
        req('POST', '/auth/forgot-password/request', { email: email }).then(function (res) {
          confirmResetPasswordScreen(email, 'New verification code sent.', res.devCode);
          if (typeof toast === 'function') toast('New verification code sent', 'ok');
        }).catch(function (err) {
          document.getElementById('lofErr').textContent = err.message;
        });
      });
    }

    var backLink = document.getElementById('linkBackToLogin2');
    if (backLink) {
      backLink.addEventListener('click', function (e) {
        e.preventDefault();
        loginScreen();
      });
    }

    onSubmit(f, function (d, err) {
      if (d.next !== d.next2) {
        err.textContent = 'The passwords do not match';
        return;
      }
      return req('POST', '/auth/forgot-password/confirm', {
        email: d.email,
        code: (d.code || '').trim(),
        next: d.next
      }).then(function (res) {
        loginScreen(res.message || 'Password successfully reset! Please sign in with your new password.');
        if (typeof toast === 'function') toast('Password reset successfully', 'ok');
      });
    });
  }
  function stageScreen(stage, msg) {
    timers.forEach(clearInterval);
    if (stage === 'password_change') {
      var f = authCard('Choose a new password', msg || 'Your password must be changed before you continue.',
        (pendingPw ? '' : '<div class="f"><label for="lp0">Current password</label><input id="lp0" name="current" type="password" autocomplete="current-password" required></div>') +
        '<div class="f"><label for="lp1">New password</label><input id="lp1" name="next" type="password" autocomplete="new-password" required></div><div class="f"><label for="lp2">Repeat new password</label><input id="lp2" name="next2" type="password" autocomplete="new-password" required><div class="help">At least 10 characters using three of: lower-case, upper-case, digits, symbols.</div></div>',
        'Save and continue');
      onSubmit(f, function (d, err) {
        if (d.next !== d.next2) { err.textContent = 'The passwords do not match'; return; }
        return req('POST', '/auth/change-password', { current: pendingPw || d.current, next: d.next }).then(function (r) { pendingPw = null; afterAuth(r.stage); });
      });
      return;
    }
    // Two-step verification setup
    authCard('Set up two-step verification', 'Loading…', '', 'Turn on');
    req('POST', '/auth/mfa/setup').then(function (r) {
      var qrImg = '';
      try { if (window.qrcode) { var q = window.qrcode(0, 'M'); q.addData(r.otpauth); q.make(); qrImg = '<img alt="QR code for your authenticator app" src="' + q.createDataURL(5, 8) + '" style="width:200px;height:200px;align-self:center;image-rendering:pixelated;background:#fff;border-radius:6px">'; } } catch (e) { }
      var f = authCard('Set up two-step verification', msg || 'Your role requires a verification code at sign-in. Scan the QR code with Google Authenticator, Microsoft Authenticator or a similar app, then enter the 6-digit code.',
        qrImg + '<div class="f"><label for="ms">Or enter this setup key</label><input id="ms" readonly value="' + esc(r.secret.replace(/(.{4})/g, '$1 ').trim()) + '" class="mono"></div><div class="f"><label for="mc">6-digit code</label><input id="mc" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></div>',
        'Turn on and continue');
      onSubmit(f, function (d) { return req('POST', '/auth/mfa/enable', { code: d.code }).then(function () { start(); }); });
    }).catch(function (e) { authCard('Two-step verification', e.message, '', 'Retry'); });
  }

  // ------------------------------------------------------------------ overrides of simulated behaviour
  var modeOf = function (k) { return (SERVER.integrations || {})[k] || 'mock'; };

  window.simBanner = function () {
    var mock = Object.keys(INTEG_LABEL).filter(function (k) { return modeOf(k) !== 'live'; });
    if (!mock.length) return '';
    return '<div class="banner">' + ic('alert') + '<span>Connected to the LOF server' + (SERVER.env && SERVER.env !== 'production' ? ' (' + esc(SERVER.env) + ')' : '') + '. Running in <b>mock mode</b>: ' + mock.map(function (k) { return INTEG_LABEL[k]; }).join(', ') + '. Live status: Settings → Testing console.</span></div>';
  };

  window.addPay = function (st, e, amt, method, ref, date, by) {
    var k = e.branch;
    st.seq.rc[k] = (st.seq.rc[k] || 0) + 1;
    var n = st.seq.pay;
    st.seq.pay = n + 1;
    var p = { id: FMT.pay(n), enr: e.id, stu: e.stu, amt: amt, cur: e.cur, method: method, ref: ref, at: date.length <= 10 ? date + 'T11:00:00+04:00' : date, rc: 'RC-' + k + '-26-' + p2(st.seq.rc[k], 4), status: 'Recorded', by: by, branch: e.branch };
    st.pay.push(p);
    e.paid = r2(e.paid + amt);
    e.payStatus = e.paid >= e.total - 0.005 ? 'Paid' : e.paid > 0 ? 'Partially paid' : 'Unpaid';
    return p;
  };

  window.runSync = function (id) {
    var m = S.ms.find(function (x) { return x.id === id; });
    if (!m) return;
    if (snap.ms && snap.ms.has(id)) {
      m.status = 'Pending';
      m.hist.push({ at: nowIso(), s: 'Pending', msg: 'Retry requested by ' + me().name });
      render();
    }
    scheduleFlush(0);
    pollSync(id, 0);
  };
  function pollSync(id, n) {
    setTimeout(function () {
      req('GET', '/lms/calls/' + encodeURIComponent(id)).then(function (m) {
        mergeDocs([{ coll: 'ms', doc: m }]);
        if (m.status === 'Pending' || m.status === 'Processing') { if (n < 15) pollSync(id, n + 1); return; }
        req('GET', '/bootstrap').then(function (b) { var s = (b.data.students || []).find(function (x) { return x.id === m.stu; }); if (s) mergeDocs([{ coll: 'students', doc: s }]); safeRender(); });
        var op = m.op === 'cancel' ? 'cancel' : 'enrol';
        toast(m.status === 'Success' ? 'LMS ' + op + ' call succeeded for ' + m.enr : 'LMS ' + op + ' call ' + m.status.toLowerCase() + ': ' + m.err, m.status === 'Success' ? 'ok' : 'err');
      }).catch(function () { if (n < 15) pollSync(id, n + 1); });
    }, n === 0 ? 1500 : 2000);
  }

  ACT.setUser = function (d) {
    if (!SERVER.impersonation) { toast('Role preview is disabled on this server', 'warn'); return; }
    S.menu = null;
    req('POST', '/auth/impersonate', { staffId: d.u }).then(function (r) {
      start().then(function () { toast('Viewing as ' + r.user.name + ' · ' + r.user.role); });
    }).catch(function (e) { toast(e.message, 'err'); });
  };
  ACT.logout = function () { flush().then(function () { return req('POST', '/auth/logout').catch(function () { }); }).then(function () { signOut('You have signed out.'); }); };
  ACT.mfa = function () { S.menu = null; req('GET', '/auth/me').then(function (r) { openModal('mfa', { on: r.mfaEnabled, required: r.mfaRequired }); }); };
  MODALS.mfa = function (m) {
    if (m.on) return {
      title: 'Two-step verification', size: 'sm2', form: m.required ? null : 'mfaOff', ok: 'Turn off', danger: 1,
      body: '<p class="sm">Two-step verification is <b>on</b>. You enter a code from your authenticator app each time you sign in.</p>' + (m.required ? '<p class="muted sm">It is required for your role and cannot be turned off.</p>' : '<div class="fgrid">' + F('Password', 'password', { t: 'password', req: 1, full: 1 }) + F('Current 6-digit code', 'code', { req: 1, full: 1 }) + '</div>')
    };
    return { title: 'Two-step verification', size: 'sm2', foot: '<button class="btn" data-act="closeModal">Not now</button><button class="btn primary" data-act="mfaStart">Set up</button>', body: '<p class="sm">Protect your account with a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password …) in addition to your password.</p>' };
  };
  ACT.mfaStart = function () { closeModal(); flush().then(function () { stageScreen('mfa_setup', 'Scan the QR code with your authenticator app, then enter the 6-digit code.'); }); };
  SUB.mfaOff = function (d, f) { if (!need(f, d, ['password', 'code'])) return; req('POST', '/auth/mfa/disable', d).then(function () { closeModal(); toast('Two-step verification turned off', 'warn'); }).catch(function (e) { setErr(f, 'code', e.message); }); };
  ACT.chgPwd = function () { S.menu = null; openModal('chgPwd', {}); };
  MODALS.chgPwd = function () {
    return { title: 'Change password', size: 'sm2', form: 'chgPwd', ok: 'Change password', body: '<div class="fgrid">' + F('Current password', 'current', { t: 'password', req: 1, full: 1 }) + F('New password', 'next', { t: 'password', req: 1, full: 1, help: 'At least 10 characters using three of: lower-case, upper-case, digits, symbols.' }) + '</div>' };
  };
  SUB.chgPwd = function (d, f) {
    if (!need(f, d, ['current', 'next'])) return;
    req('POST', '/auth/change-password', d).then(function () { closeModal(); toast('Password changed – other devices have been signed out', 'ok'); }).catch(function (e) { setErr(f, 'next', e.message); });
  };
  var _topbar = window.topbar;
  window.topbar = function () {
    var h = _topbar();
    if (!SERVER.impersonation) h = h.replace(/<div class="lab">Switch demo user \(role preview\)<\/div>[\s\S]*?(?=<div class="lab">Display<\/div>)/, '');
    else h = h.replace('Switch demo user (role preview)', 'Role preview (staging)');
    h = h.replace('<div class="lab">Display</div>', '<div class="lab">Account</div><div class="mi" data-act="chgPwd">' + ic('shield') + ' Change password</div><div class="mi" data-act="mfa">' + ic('shield') + ' Two-step verification</div><div class="mi" data-act="logout">' + ic('logout') + ' Sign out</div><div class="lab">Display</div>');
    if (modeOf('exotel') === 'live' || SERVER.env === 'production') h = h.replace(/<button class="btn sm" data-act="simCall"[\s\S]*?<\/button>/, '');
    return h;
  };
  var _theme = ACT.theme;
  ACT.theme = function () { _theme(); LS.set('lof_theme', S.theme); };
  var _saveFilter = ACT.saveFilter;
  ACT.saveFilter = function () { _saveFilter(); LS.set('lof_saved_filters', JSON.stringify(S.saved)); };

  // Remove prototype-only simulators from real data screens (the Testing console replaces them)
  var _leads = PAGES.leads;
  PAGES.leads = function (rt) { return _leads(rt).replace(/<button class="btn" data-act="openSimCapture">[\s\S]*?<\/button>/, ''); };
  var _lead = PAGES.lead;
  PAGES.lead = function (rt) {
    var h = _lead(rt);
    var l = leadById(rt.id);
    if (!l) return h;
    if (SERVER.env === 'production' || modeOf('whatsapp') === 'live') h = h.replace(/<button class="btn sm" data-act="mAvail"[^>]*>Simulate parent reply<\/button>/, '');
    if (l.avail && l.avail.s === 'Replied') h = h.replace(/Parent prefers <b>[^<]*<\/b>\./, 'Parent replied on WhatsApp: <b>“' + esc(l.avail.text || '') + '”</b>. Schedule the call under Follow-ups.');
    return h;
  };

  // Telephony: real click-to-call + real screen-pop
  var _callLog = MODALS.callLog;
  MODALS.callLog = function (m) {
    var x = _callLog(m);
    var live = modeOf('exotel') === 'live';
    x.body = x.body.replace(/<div class="banner">[\s\S]*?<\/div>/, '<div class="banner" style="justify-content:space-between">' + ic('phone') + '<span style="flex:1">' + (live ? 'Click-to-call rings your mobile first, then connects the parent. The call is logged automatically – add the outcome here.' : 'Exotel is in mock mode – dialling is logged but no call is placed.') + '</span><button type="button" class="btn sm primary" data-act="dialExotel" data-id="' + esc(m.id) + '">' + ic('phone') + ' Dial via Exotel</button></div>');
    return x;
  };
  ACT.dialExotel = function (d) {
    req('POST', '/leads/' + encodeURIComponent(d.id) + '/click-to-call').then(function (r) {
      toast(r.mode === 'live' ? 'Calling your phone now – answer to connect the parent' : 'Click-to-call sent (mock mode)', 'ok');
      setTimeout(function () { reload(false); }, 4000);
    }).catch(function (e) { toast(e.message, 'err'); });
  };
  var _answer = ACT.answerCall;
  ACT.answerCall = function () {
    if (S.callPopReal) { var id = S.callPop; S.callPop = null; S.callPopReal = false; go('lead', { id: id }); return; }
    _answer();
  };
  var _callPop = window.callPopHtml;
  window.callPopHtml = function () {
    var h = _callPop();
    return S.callPopReal ? h.replace('<span class="sim">Simulated</span>', '<span class="badge ok">Exotel</span>').replace('Answer &amp; open lead', 'Open lead').replace('Answer & open lead', 'Open lead') : h;
  };

  // Payments: hosted payment links + printable receipts
  var _payCollect = PAGES.payCollect;
  PAGES.payCollect = function (rt) {
    var h = _payCollect(rt);
    h = h.replace(/<div class="banner">[\s\S]*?<\/div>/, '<div class="banner">' + ic('wallet') + '<span>Record counter payments here, or send a secure payment link – <b>Telr</b> for AED branches, <b>Razorpay</b> for INR branches' + (modeOf('telr') === 'live' || modeOf('razorpay') === 'live' ? '' : ' (mock mode)') + '. Online payments are recorded automatically with a receipt.</span></div>');
    if (S.payPick) h = h.replace('<button class="btn primary" type="submit">Record payment (simulated)</button>', '<button class="btn primary" type="submit">Record payment</button><button class="btn" type="button" data-act="payLink" data-id="' + esc(S.payPick) + '">' + ic('link') + ' Send payment link</button>');
    return h;
  };
  ACT.payLink = function (d) {
    var amt = document.querySelector('#payf [name=amt]');
    req('POST', '/payments/links', { enrollmentId: d.id, amount: amt ? +amt.value : undefined }).then(function (r) { openModal('plink', { link: r }); }).catch(function (e) { toast(e.message, 'err'); });
  };
  MODALS.plink = function (m) {
    var l = m.link;
    return {
      title: 'Payment link ' + l.id, size: 'sm2',
      body: '<p class="sm">' + money(l.amount, l.currency) + ' via <b>' + (l.provider === 'telr' ? 'Telr' : 'Razorpay') + '</b>' + (l.mode === 'mock' ? ' <span class="sim">Mock</span>' : '') + '. The payment is recorded automatically when the parent pays.</p><div class="f"><label for="plurl">Link</label><input id="plurl" readonly value="' + esc(l.url) + '"></div>',
      foot: '<button class="btn" data-act="closeModal">Close</button><button class="btn" data-act="copy" data-v="' + esc(l.url) + '">Copy link</button><button class="btn" data-act="plSend" data-id="' + esc(l.id) + '" data-ch="Email">Send by e-mail</button><button class="btn primary" data-act="plSend" data-id="' + esc(l.id) + '" data-ch="WhatsApp">Send on WhatsApp</button>',
    };
  };
  ACT.plSend = function (d) {
    req('POST', '/payments/links/' + encodeURIComponent(d.id) + '/send', { channel: d.ch }).then(function () { closeModal(); toast('Payment link sent by ' + d.ch, 'ok'); }).catch(function (e) { toast(e.message, 'err'); });
  };
  ACT.genReceipt = function (d) {
    var w = window.open('', '_blank');
    fetch(API + '/payments/' + encodeURIComponent(d.id) + '/receipt', { credentials: 'same-origin' }).then(function (r) { return r.text(); }).then(function (html) {
      var url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      if (w) w.location = url; else location.href = url;
    }).catch(function (e) { if (w) w.close(); toast(e.message, 'err'); });
  };
  var _receipt = MODALS.receipt;
  MODALS.receipt = function (m) {
    var x = _receipt(m);
    x.foot = x.foot.replace('Generate receipt (simulated)', 'Open printable receipt');
    x.body = x.body.replace('<span class="sim">Simulated</span>', '').replace('Prototype receipt – not a valid tax document. Finance linkage to ERPNext Accounts is pending integration.', 'Receipt numbers are issued by the server. Payments are posted to ERPNext Accounts as Payment Entries.');
    return x;
  };

  // LMS monitor + integration settings
  ACT.testInteg = function (d) {
    var map = { web: ['website'], meta: ['meta'], wa: ['whatsapp'], tel: ['exotel'], lms: ['lms'], pay: ['telr', 'razorpay'], erp: ['erpnext'], cal: ['gcal'] };
    (map[d.k] || [d.k]).forEach(testIntegration);
  };
  function testIntegration(k) {
    req('POST', '/testing/integrations/' + k + '/test').then(function (r) {
      if (k === 'lms') { S.lmsTestOk = !!r.ok && r.mode === 'live'; safeRender(); }
      toast(INTEG_LABEL[k] + ': ' + (r.ok ? 'connection OK' : 'failed – ' + r.error) + ' (' + r.mode + ')' + (r.note ? ' · ' + r.note : ''), r.ok ? (r.mode === 'live' ? 'ok' : 'warn') : 'err');
    }).catch(function (e) { toast(e.message, 'err'); });
  }
  CHG.outage = function (el) {
    req('POST', '/testing/flags', { moodleFail: el.checked }).then(function () { S.sim.moodleOutage = el.checked; toast(el.checked ? 'Mock LMS calls will fail until switched off' : 'Mock LMS outage off', 'warn'); render(); }).catch(function (e) { toast(e.message, 'err'); });
  };
  var _integ = PAGES.integration;
  PAGES.integration = function (rt) {
    var h = _integ(rt);
    return h.replace(/<div class="banner">[\s\S]*?<\/div>/, modeOf('lms') === 'live' ? '' : '<div class="banner">' + ic('alert') + 'The LMS is in mock mode – switch it on under Settings → LMS Integration and set LMS_URL / LMS_TOKEN on the server to go live.</div>')
      .replace(/Not connected – simulated/g, modeOf('lms') === 'live' ? 'Connected' : 'Mock mode');
  };
  // Website origins + Meta defaults are configurable alongside the existing integration fields
  try {
    var web = INTEG.find(function (g) { return g[0] === 'web'; });
    web[2].push(['origins', 'Allowed website origins (comma separated)']);
    var meta = INTEG.find(function (g) { return g[0] === 'meta'; });
    meta[2].push(['defaultBranch', 'Default branch for Meta leads (e.g. KRM)'], ['defaultProg', 'Default programme (e.g. COD)']);
  } catch (e) { }
  var _cfgInteg = CFG.integrations;
  CFG.integrations = function () {
    return _cfgInteg().replace(/<div class="banner">[\s\S]*?<\/div>/, '<div class="banner">' + ic('shield') + '<span>Credentials (tokens, keys, secrets) are stored as server secrets and never shown here. An integration runs <b>live</b> when it is enabled below and its secrets are set; otherwise it runs in mock mode. Check readiness in Settings → Testing console.</span></div>');
  };

  // Staff sign-in administration (System Administrator): temporary password, sign out everywhere
  var _staffModal = MODALS.staff;
  MODALS.staff = function (m) {
    var x = _staffModal(m);
    if (m.id && me().role === 'System Administrator' && m.id !== me().id) {
      x.body += '<div class="card" style="margin-top:14px"><div class="hd"><h3>Sign-in</h3></div><div class="bd" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
        '<button class="btn sm" type="button" data-act="lofResetPw" data-id="' + esc(m.id) + '">Issue temporary password</button>' +
        '<button class="btn sm" type="button" data-act="lofResetPw" data-id="' + esc(m.id) + '" data-mfa="1">Temporary password + reset two-step</button>' +
        '<button class="btn sm" type="button" data-act="lofRevoke" data-id="' + esc(m.id) + '">Sign out everywhere</button>' +
        '<span class="muted xs">The person must change the temporary password at the next sign-in. All their sessions end.</span></div></div>';
    }
    return x;
  };
  ACT.lofResetPw = function (d) {
    req('POST', '/auth/reset-password', { staffId: d.id, resetMfa: d.mfa === '1' }).then(function (r) {
      openModal('lofTemp', { name: staffName(d.id), pw: r.temporaryPassword });
    }).catch(function (e) { toast(e.message, 'err'); });
  };
  ACT.lofRevoke = function (d) {
    req('POST', '/auth/revoke-sessions', { staffId: d.id }).then(function () { toast(staffName(d.id) + ' was signed out on every device', 'ok'); }).catch(function (e) { toast(e.message, 'err'); });
  };
  MODALS.lofTemp = function (m) {
    return { title: 'Temporary password', size: 'sm2', body: '<p>Give this temporary password to <b>' + esc(m.name) + '</b> in person or by phone – not by e-mail. It is shown only once.</p><p style="font:600 18px ui-monospace,monospace;user-select:all;padding:10px;border:1px solid var(--bd);border-radius:6px;text-align:center">' + esc(m.pw) + '</p>', foot: '<button class="btn primary" data-act="closeModal">Done</button>' };
  };

  // Templates: map CRM templates to WhatsApp-approved templates and e-mail subjects
  var _tpl = MODALS.tpl;
  MODALS.tpl = function (m) {
    var x = _tpl(m);
    var t = m.id ? S.cfg.comms.find(function (y) { return y.id === m.id; }) : {};
    x.body = x.body.replace(/(<div class="f full" data-f="body">)/, F('WhatsApp approved template name', 'waTemplate', { v: t.waTemplate || '', help: 'Needed for business-initiated WhatsApp messages. Body placeholders are sent as template parameters, in order.' }) + F('Template language', 'waLang', { v: t.waLang || 'en' }) + F('E-mail subject', 'subject', { v: t.subject || '' }) + '$1');
    return x;
  };
  var _subTpl = SUB.tpl;
  SUB.tpl = function (d, f) {
    var before = S.cfg.comms.length;
    _subTpl(d, f);
    if (S.modal) return;
    var t = d.oid ? S.cfg.comms.find(function (y) { return y.id === d.oid; }) : S.cfg.comms.length > before ? S.cfg.comms[S.cfg.comms.length - 1] : null;
    if (t) { t.waTemplate = d.waTemplate || ''; t.waLang = d.waLang || 'en'; t.subject = d.subject || ''; }
  };

  // ------------------------------------------------------------------ Settings → Testing console
  GROUPS.find(function (g) { return g.id === 'set'; }).tabs.push(['testing', 'Testing console', 'target', 'configuration']);
  ACCESS.testing = ['configuration', 'V'];
  var TC = { status: null, loading: false, results: {}, sims: {}, scen: {}, logs: null, logF: { integration: '', ok: '' } };
  function tcLoad() {
    TC.loading = true;
    return Promise.all([req('GET', '/testing/status'), tcLogs()]).then(function (r) { TC.status = r[0]; TC.loading = false; safeRender(); }).catch(function (e) { TC.loading = false; TC.error = e.message; safeRender(); });
  }
  function tcLogs() {
    var q = '?limit=100' + (TC.logF.integration ? '&integration=' + TC.logF.integration : '') + (TC.logF.ok === '0' ? '&ok=0' : '');
    return req('GET', '/testing/logs' + q).then(function (r) { TC.logs = r.items; });
  }
  var SIMS = [
    ['website', 'Website enquiry', 'Signed form submission → lead created, routed, WhatsApp/e-mail queued'],
    ['meta', 'Meta lead form', 'Signed leadgen event → lead imported'],
    ['meta-verify', 'Meta subscription check', 'hub.challenge verification'],
    ['whatsapp-verify', 'WhatsApp subscription check', 'hub.challenge verification'],
    ['whatsapp-status', 'WhatsApp delivered', 'Delivery receipt updates the latest test message'],
    ['whatsapp-inbound', 'WhatsApp reply', 'Parent reply threads onto the test lead'],
    ['exotel-incoming', 'Incoming call', 'Caller identified, screen-pop raised'],
    ['exotel-status', 'Call completed', 'Call logged, first-call SLA stopped'],
    ['telr-paid', 'Telr payment', 'Transaction advice → verified → receipt (needs an open test link)'],
    ['razorpay-paid', 'Razorpay payment', 'payment_link.paid → receipt (needs an open test link)'],
    ['bad-signature', 'Forged webhook', 'Invalid signature must be rejected with 401'],
  ];
  var SCEN = [
    ['uae-lead-to-enrolment', 'UAE: enquiry → enrolment → Telr payment', 'Website lead, routing, messages, Exotel call, conversion, enrolment, LMS enrol call, Telr, receipt, ERPNext, idempotency, withdrawal with refund suggestion and LMS cancel call'],
    ['india-lead-to-enrolment', 'India: enquiry → enrolment → Razorpay payment', 'Same flow for Bengaluru with INR and Razorpay'],
    ['meta-lead', 'Meta Lead Ads import', 'Signed leadgen webhook and forged-signature rejection'],
    ['lms-failure-retry', 'LMS outage and retry', 'The failed enrol call is recorded; the retry succeeds (mock mode only)'],
  ];
  var resBadge = function (r) {
    if (!r) return '<span class="faint">—</span>';
    if (r.running) return bdg('Running…', 'info');
    return r.ok ? bdg('Passed' + (r.mode ? ' · ' + r.mode : ''), r.mode === 'mock' ? 'warn' : 'ok') : bdg('Failed', 'crit');
  };
  PAGES.testing = function () {
    if (!TC.status && !TC.loading && !TC.error) tcLoad();
    if (!TC.status) return ph('Testing console', 'Integration readiness, webhook simulations and end-to-end scenarios') + card('', TC.error ? emptyBox('Could not load', TC.error) : emptyBox('Loading…', ''));
    var st = TC.status;
    var head = ph('Testing console', 'Check every integration before go-live. Simulations and scenarios create <b>test records only</b> (IDs start with TST-) and never touch business numbering.',
      '<button class="btn" data-act="tcRefresh">' + ic('refresh') + ' Refresh</button><button class="btn" data-act="tcCron">' + ic('clock') + ' Run scheduler now</button><button class="btn danger" data-act="tcCleanup">Delete test data (' + st.testRecords + ')</button>');
    var info = '<div class="sum"><div class="it"><small>Environment</small><b>' + esc(st.env) + '</b></div><div class="it"><small>Integration mode</small>' + (st.forcedMock ? bdg('Forced mock', 'warn') : bdg('Auto (live when enabled + configured)', 'info')) + '</div><div class="it"><small>Background jobs</small>' + (st.queue ? bdg('Cloudflare Queue', 'ok') : bdg('In-request (no queue bound)', 'warn')) + '</div><div class="it"><small>Live integrations</small><b>' + st.integrations.filter(function (i) { return i.mode === 'live'; }).length + ' / ' + st.integrations.length + '</b></div></div>';
    var integ = card('Integration readiness', table('tci', [
      { h: 'Integration', f: function (i) { return '<b>' + esc(i.label) + '</b>'; } },
      { h: 'Configuration', f: function (i) { return i.enabled ? bdg('Enabled', 'ok') : bdg('Disabled', ''); } },
      { h: 'Mode', f: function (i) { return i.mode === 'live' ? bdg('Live', 'ok') : bdg('Mock', 'warn'); } },
      { h: 'Missing secrets / settings', f: function (i) { return i.missing.length ? '<span class="mono xs" style="color:var(--crit)">' + i.missing.map(esc).join('<br>') + '</span>' : bdg('None', 'ok'); } },
      { h: 'Webhook URL to register', f: function (i) { return i.webhooks.length ? '<span class="mono xs">' + i.webhooks.map(esc).join('<br>') + '</span>' : '<span class="faint">—</span>'; } },
      { h: 'Last activity', f: function (i) { return i.last ? (i.last.ok ? bdg('OK', 'ok') : bdg('Error', 'crit')) + '<div class="muted xs">' + fDT(i.last.at) + ' · ' + esc(i.last.operation) + ' · ' + esc(i.last.mode) + '</div>' : '<span class="faint">Never</span>'; } },
      { h: 'Connection test', f: function (i) { var r = TC.results[i.key]; return '<div class="row"><button class="btn sm" data-act="tcTest" data-k="' + i.key + '">Test</button>' + resBadge(r) + '</div>' + (r && !r.running ? '<div class="xs ' + (r.ok ? 'muted' : '') + '" style="max-width:260px;overflow-wrap:anywhere;' + (r.ok ? '' : 'color:var(--crit)') + '">' + esc(r.ok ? (r.note || JSON.stringify(r.detail || '')).slice(0, 160) : r.error) + '</div>' : ''); } },
    ], st.integrations, { all: 1 }), { np: 1, act: '<button class="btn sm" data-act="tcTestAll">Test all</button>' });
    var sims = card('Webhook simulations', '<p class="muted sm" style="margin-top:0">Each simulation builds a correctly signed provider event and sends it through the real webhook endpoint.</p><div class="grid g3">' + SIMS.map(function (s) {
      var r = TC.sims[s[0]];
      return '<div class="card"><div class="bd"><div class="row" style="justify-content:space-between"><b>' + esc(s[1]) + '</b>' + resBadge(r) + '</div><div class="muted xs" style="margin:4px 0 8px">' + esc(s[2]) + '</div><button class="btn sm" data-act="tcSim" data-k="' + s[0] + '">Send</button>' + (r && !r.running ? '<div class="mono xs" style="margin-top:6px;max-height:80px;overflow:auto;overflow-wrap:anywhere;' + (r.ok ? '' : 'color:var(--crit)') + '">' + esc(r.text) + '</div>' : '') + '</div></div>';
    }).join('') + '</div>');
    var scen = card('End-to-end scenarios', '<div class="grid g2">' + SCEN.map(function (s) {
      var r = TC.scen[s[0]];
      return '<div class="card"><div class="hd"><h3>' + esc(s[1]) + '</h3><div class="row">' + resBadge(r) + '<button class="btn sm primary" data-act="tcScen" data-k="' + s[0] + '">Run</button></div></div><div class="bd"><div class="muted xs" style="margin-bottom:8px">' + esc(s[2]) + '</div>' +
        (r && r.steps ? '<div class="tl">' + r.steps.map(function (x) { return '<div class="ev ' + (x.ok ? 'msg' : 'crit') + '"><div>' + (x.ok ? '✓ ' : '✗ ') + esc(x.step) + '</div><div class="t" style="overflow-wrap:anywhere">' + x.ms + ' ms · ' + esc(typeof x.detail === 'string' ? x.detail : JSON.stringify(x.detail)).slice(0, 220) + '</div></div>'; }).join('') + '</div>' + (r.error ? '<div class="fe">' + esc(r.error) + '</div>' : '') : '<span class="faint xs">Not run yet</span>') +
        '</div></div>';
    }).join('') + '</div>');
    var flags = card('Failure injection (mock mode)', '<label class="chk"><input type="checkbox" data-change="tcFlag" data-k="moodleFail"' + (st.flags && st.flags.moodleFail ? ' checked' : '') + '> Simulate LMS outage – new LMS calls fail until switched off</label>');
    var logs = card('Integration log', '<div class="tb"><select data-change="tcLogF" name="integration" aria-label="Integration"><option value="">All integrations</option>' + Object.keys(INTEG_LABEL).map(function (k) { return '<option value="' + k + '"' + (TC.logF.integration === k ? ' selected' : '') + '>' + INTEG_LABEL[k] + '</option>'; }).join('') + '</select><select data-change="tcLogF" name="ok" aria-label="Result"><option value="">All results</option><option value="0"' + (TC.logF.ok === '0' ? ' selected' : '') + '>Failures only</option></select><span class="muted xs" style="margin-left:auto">Secrets are redacted before logging.</span></div>' +
      table('tcl', [
        { h: 'Time', f: function (l) { return fDT(l.at); } },
        { h: 'Integration', f: function (l) { return esc(INTEG_LABEL[l.integration] || l.integration); } },
        { h: 'Direction', f: function (l) { return l.direction === 'in' ? 'Inbound' : 'Outbound'; } },
        { h: 'Operation', f: function (l) { return '<span class="mono xs">' + esc(l.operation) + '</span>'; } },
        { h: 'Mode', f: function (l) { return l.mode === 'live' ? bdg('Live', 'ok') : bdg('Mock', 'warn'); } },
        { h: 'Result', f: function (l) { return l.ok ? bdg(String(l.status || 'OK'), 'ok') : bdg(String(l.status || 'Error'), 'crit'); } },
        { h: 'ms', f: function (l) { return l.duration_ms == null ? '—' : l.duration_ms; }, r: 1 },
        { h: 'Reference', f: function (l) { return '<span class="mono xs">' + esc(l.ref || '') + '</span>' + (l.is_test ? ' ' + bdg('test', 'info') : ''); } },
      ], TC.logs || [], { ps: 15, row: function (l) { return 'data-act="tcLog" data-id="' + l.id + '"'; }, et: 'No integration calls yet' }), { np: 1 });
    var suite = card('Automated test suite', '<p class="sm" style="margin-top:0">Run before every deployment: <span class="mono">npm test</span> (78 tests: unit, API & permission guard, webhooks, live adapters against stubbed provider APIs, testing console scenarios) and <span class="mono">npm run test:e2e</span> (browser tests of the screens against a local server).</p>');
    return head + info + integ + '<div style="height:14px"></div>' + scen + '<div style="height:14px"></div>' + sims + '<div style="height:14px"></div><div class="grid g2">' + flags + suite + '</div><div style="height:14px"></div>' + logs;
  };
  ACT.tcRefresh = function () { TC.status = null; TC.error = null; render(); };
  ACT.tcTest = function (d) {
    TC.results[d.k] = { running: true }; render();
    return req('POST', '/testing/integrations/' + d.k + '/test').then(function (r) { TC.results[d.k] = r; }).catch(function (e) { TC.results[d.k] = { ok: false, error: e.message }; })
      .then(tcLogs).then(function () { req('GET', '/testing/status').then(function (s) { TC.status = s; safeRender(); }); });
  };
  ACT.tcTestAll = function () { TC.status.integrations.reduce(function (p, i) { return p.then(function () { return ACT.tcTest({ k: i.key }); }); }, Promise.resolve()); };
  ACT.tcSim = function (d) {
    TC.sims[d.k] = { running: true }; render();
    req('POST', '/testing/webhooks/' + d.k + '/simulate', {}).then(function (r) {
      TC.sims[d.k] = { ok: r.ok !== false && (r.status ? r.status < 400 || d.k === 'bad-signature' : true), text: 'HTTP ' + r.status + ' ' + (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
    }).catch(function (e) { TC.sims[d.k] = { ok: false, text: e.message }; }).then(function () { return Promise.all([tcLogs(), req('GET', '/testing/status').then(function (s) { TC.status = s; })]); }).then(function () { reload(true); });
  };
  ACT.tcScen = function (d) {
    TC.scen[d.k] = { running: true }; render();
    req('POST', '/testing/scenarios/' + d.k + '/run').then(function (r) { TC.scen[d.k] = r; }).catch(function (e) { TC.scen[d.k] = { ok: false, error: e.message, steps: [] }; })
      .then(function () { return Promise.all([tcLogs(), req('GET', '/testing/status').then(function (s) { TC.status = s; })]); }).then(function () { reload(true); });
  };
  ACT.tcCron = function () { req('POST', '/testing/cron').then(function (r) { toast('Scheduler ran: ' + r.leadsChecked + ' open leads checked, ' + (r.overdueInstalments || 0) + ' overdue instalment(s) notified, ' + (r.lmsRetries || 0) + ' LMS retries queued', 'ok'); reload(true); }).catch(function (e) { toast(e.message, 'err'); }); };
  ACT.tcCleanup = function () { confirmBox('Delete test data', 'Delete all records created by simulations and scenarios (IDs starting with TST-) and their logs? Business records are not affected.', 'tcCleanup', null, 'Delete test data', 1); };
  CONFIRM.tcCleanup = function () { req('POST', '/testing/cleanup').then(function (r) { toast(r.deleted + ' test records deleted', 'ok'); TC.status = null; TC.scen = {}; TC.sims = {}; reload(true); }).catch(function (e) { toast(e.message, 'err'); }); };
  CHG.tcFlag = function (el) { var b = {}; b[el.dataset.k] = el.checked; req('POST', '/testing/flags', b).then(function () { TC.status.flags = Object.assign({}, TC.status.flags, b); toast('Failure injection ' + (el.checked ? 'on' : 'off'), 'warn'); }); };
  CHG.tcLogF = function (el) { TC.logF[el.name] = el.value; tcLogs().then(function () { render(); }); };
  ACT.tcLog = function (d) { req('GET', '/testing/logs/' + d.id).then(function (l) { openModal('tcLog', { l: l }); }); };
  MODALS.tcLog = function (m) {
    var l = m.l;
    var pretty = function (s) { try { return JSON.stringify(JSON.parse(s), null, 2); } catch (e) { return s || ''; } };
    var pre = function (s) { return '<pre style="white-space:pre-wrap;overflow-wrap:anywhere;background:var(--panel2);border:1px solid var(--line);border-radius:6px;padding:10px;font-family:var(--f-mono);font-size:11.5px;max-height:260px;overflow:auto">' + esc(pretty(s)) + '</pre>'; };
    return {
      title: (INTEG_LABEL[l.integration] || l.integration) + ' · ' + l.operation, size: 'lg', foot: '<button class="btn" data-act="closeModal">Close</button>',
      body: dl([['Time', fDT(l.at)], ['Direction', l.direction === 'in' ? 'Inbound webhook' : 'Outbound API call'], ['Mode', l.mode], ['Request', esc((l.method || '') + ' ' + (l.url || ''))], ['Result', (l.ok ? 'OK' : 'Failed') + (l.status ? ' · HTTP ' + l.status : '') + (l.duration_ms != null ? ' · ' + l.duration_ms + ' ms' : '')], ['Error', esc(l.error || '')], ['Reference', esc(l.ref || '')]]) +
        '<div class="sec">Request</div>' + pre(l.request) + '<div class="sec">Response</div>' + pre(l.response)
    };
  };

  // ------------------------------------------------------------------ fixes found in QA
  // Editing a branch / programme: the disabled Short ID field is not submitted, so carry it over
  var _subBranch = SUB.branch;
  SUB.branch = function (d, f) { if (d.oid && !d.id) d.id = d.oid; return _subBranch(d, f); };
  var _subProg = SUB.prog;
  SUB.prog = function (d, f) { if (d.oid && !d.id) d.id = d.oid; return _subProg(d, f); };
  // Lost leads can be reopened too (prototype offered it only for Not Interested)
  var _leadPage = PAGES.lead;
  PAGES.lead = function (rt) {
    var h = _leadPage(rt), l = leadById(rt.id);
    if (l && l.status === 'Lost' && can('leads', 'E') && h.indexOf('data-act="reopen"') < 0) h = h.replace(/(<button class="btn" data-act="mEditLead"[^>]*>Edit<\/button>)/, '$1<button class="btn" data-act="reopen" data-id="' + esc(l.id) + '">Reopen</button>');
    return h;
  };
  var _reopen = ACT.reopen;
  ACT.reopen = function (d) { var l = leadById(d.id); if (l && l.status === 'Lost') { l.lostReason = ''; l.status = 'Closed'; } _reopen(d); };
  // Bulk assign: only open leads are assigned, so say how many actually were
  SUB.bulkAssign = function (d, f) {
    if (!need(f, d, ['to', 'reason'])) return;
    var ids = Object.keys(S_sel), n = 0;
    ids.forEach(function (id) { var l = leadById(id); if (l && l.status === 'Open') { reassign(l, d.to, d.reason, 'Manual (bulk)'); n++; } });
    S_sel = {}; closeModal();
    toast(n ? n + ' lead(s) assigned to ' + staffName(d.to) + (n < ids.length ? ' – ' + (ids.length - n) + ' closed or converted lead(s) skipped' : '') : 'Nothing assigned – only open leads can be assigned', n ? 'ok' : 'warn');
  };

  // Integrations are real now: remove the prototype's "simulated / not connected" wording everywhere
  var liveText = function (k, live, mock) { return modeOf(k) === 'live' ? live : mock; };
  function deSim(h) {
    return h
      .replace(/<span class="sim">Simulated<\/span>/g, '')
      .replace(/\s?\((?:simulated|Simulated)[^)<]*\)/g, '')
      .replace(/Send \(simulated\)/g, 'Send')
      .replace(/Enabled – simulated/g, 'Enabled')
      .replace(/ · integration <span class="badge warn">not connected – simulated<\/span>/g, '')
      .replace(/WhatsApp Business is not connected – messages are recorded as simulated\./g, liveText('whatsapp', 'Messages are sent through WhatsApp Business.', 'WhatsApp is in mock mode – messages are logged but not delivered.'))
      .replace(/Telephony \(([^)]*)\) is not connected\. Entries marked Simulated were created in this prototype; seeded calls are sample data\./g, liveText('exotel', 'Calls are logged automatically from Exotel; add the outcome on the lead.', 'Exotel is in mock mode – log calls manually.'))
      .replace(/Payment gateway is not connected\. The payment is recorded manually and marked simulated\./g, 'Record the payment taken at the counter. For online payment, finish the enrolment and use Payments → Send payment link.')
      .replace(/WhatsApp and email providers are not connected; sending is simulated\./g, 'Messages are sent by WhatsApp Business and e-mail when those integrations are live (Settings → Testing console).')
      .replace(/Status: <span class="badge warn">[^<]*<\/span>/g, '')
      .replace(/Outcomes that record a call are logged as simulated\./g, 'The outcome is saved on the lead’s call log.')
      .replace(/Simulates the parent answering the WhatsApp availability request \(WhatsApp is not connected\)\./g, 'Record the time the parent asked for.')
      .replace(/Calendar sync \(Google\/Outlook\) is a configurable placeholder and is not connected\. /g, liveText('gcal', 'Scheduled calls are added to the team’s Google Calendar. ', ''))
      .replace(/Downloads are disabled inside the prototype viewer, so the export is shown here\./g, 'Copy the export below into a spreadsheet.');
  }
  var _shell = window.shell;
  window.shell = function () { return deSim(_shell()); };
  var _toast = window.toast;
  window.toast = function (msg, kind) { return _toast(String(msg).replace(/\s?\((?:simulated|Simulated)[^)]*\)/g, '').replace(/ \(simulated telephony\)/g, ''), kind); };
  var _addAudit = window.addAudit;
  window.addAudit = function (act, ref, det, by) { return _addAudit(String(act).replace(/\s?\(simulated\)/g, ''), ref, String(det || '').replace(/\s?\((?:simulated|Simulated)[^)]*\)/g, ''), by); };
  // LMS monitor: list the other integrations with their real mode
  var _integPage = PAGES.integration;
  PAGES.integration = function (rt) {
    var h = _integPage(rt);
    var rows = Object.keys(INTEG_LABEL).filter(function (k) { return k !== 'lms'; }).map(function (k) { return '<tr><td>' + INTEG_LABEL[k] + '</td><td>' + (modeOf(k) === 'live' ? bdg('Live', 'ok') : bdg('Mock', 'warn')) + '</td><td class="muted sm">Details: Settings → Testing console</td></tr>'; }).join('');
    return h.replace(/(<h3>Other integrations<\/h3>[\s\S]*?<tbody>)[\s\S]*?(<\/tbody>)/, '$1' + rows + '$2');
  };

  // ------------------------------------------------------------------ Settings → Database (System Administrator)
  CTABS.push(['database', 'Database']);
  var DBV = { tables: null, name: 'leads', q: '', branch: '', test: false, offset: 0, page: null, loading: false, error: null };
  var DB_LIMIT = 50;
  function dbQuery() { return '?name=' + encodeURIComponent(DBV.name) + '&q=' + encodeURIComponent(DBV.q) + '&branch=' + encodeURIComponent(DBV.branch) + (DBV.test ? '&test=1' : ''); }
  var dbSeq = 0;
  function dbLoad() {
    var my = ++dbSeq; // only the latest request may update the screen (fast table switching)
    DBV.loading = true; DBV.error = null;
    var t = DBV.tables ? Promise.resolve(null) : req('GET', '/admin/db/tables').then(function (r) { DBV.tables = r.datasets; });
    return t.then(function () { return req('GET', '/admin/db/rows' + dbQuery() + '&limit=' + DB_LIMIT + '&offset=' + DBV.offset); })
      .then(function (r) { if (my === dbSeq) DBV.page = r; }).catch(function (e) { if (my === dbSeq) DBV.error = e.message; })
      .then(function () { if (my !== dbSeq) return; DBV.loading = false; safeRender(); });
  }
  function dbDownload(path, fallbackName) {
    return fetch(API + path, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) return r.json().then(function (j) { throw new Error((j && j.error) || 'HTTP ' + r.status); });
      var cd = r.headers.get('content-disposition') || '', m = /filename="([^"]+)"/.exec(cd);
      var truncated = r.headers.get('x-lof-truncated') === '1';
      return r.blob().then(function (b) { var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = m ? m[1] : fallbackName; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000); return { truncated: truncated }; });
    });
  }
  CFG.database = function () {
    if (me().role !== 'System Administrator') return card('Database', emptyBox('Restricted', 'Only a System Administrator can open the database.'));
    if (!DBV.page && !DBV.loading && !DBV.error) { dbLoad(); }
    var ds = (DBV.tables || []).find(function (d) { return d.name === DBV.name; }) || {};
    var groups = ['Business', 'Settings', 'System'].map(function (g) {
      var items = (DBV.tables || []).filter(function (d) { return d.group === g; });
      return '<div class="sec" style="margin-top:6px">' + g + '</div><div class="chips">' + items.map(function (d) { return '<a class="chip' + (d.name === DBV.name ? ' on' : '') + '" data-act="dbPick" data-n="' + d.name + '" tabindex="0">' + esc(d.label) + ' <span class="muted xs">' + d.rows.toLocaleString('en-US') + '</span></a>'; }).join('') + '</div>';
    }).join('');
    var p = DBV.page, body;
    if (DBV.error) body = '<div class="banner" style="background:var(--crit-bg,#fdecec)">' + esc(DBV.error) + '</div>';
    else if (!p) body = emptyBox('Loading…', '');
    else if (!p.rows.length) body = emptyBox('No records', DBV.q || DBV.branch ? 'Clear the search or branch filter.' : 'This table is empty.');
    else body = '<div class="tbl-wrap"><table class="tbl"><thead><tr>' + p.columns.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' + p.rows.map(function (r) {
      var id = r[p.columns.indexOf(p.columns[0])];
      return '<tr' + (ds.detail ? ' class="cl" style="cursor:pointer" data-act="dbRec" data-id="' + esc(id) + '"' : '') + '>' + r.map(function (v) { var t = v == null ? '' : String(v); return '<td class="' + (typeof v === 'number' ? 'r num' : '') + '" title="' + esc(t) + '">' + esc(t.length > 80 ? t.slice(0, 80) + '…' : t) + '</td>'; }).join('') + '</tr>';
    }).join('') + '</tbody></table></div><div class="pager"><span>' + (p.offset + 1) + '–' + (p.offset + p.rows.length) + ' of ' + p.total.toLocaleString('en-US') + '</span><span class="row">' +
      '<button class="btn sm" data-act="dbPage" data-d="-1"' + (p.offset ? '' : ' disabled') + '>Previous</button><button class="btn sm" data-act="dbPage" data-d="1"' + (p.offset + p.rows.length < p.total ? '' : ' disabled') + '>Next</button></span></div>';
    var brs = (S.branches || []).map(function (b) { return '<option value="' + b.id + '"' + (DBV.branch === b.id ? ' selected' : '') + '>' + esc(b.name) + '</option>'; }).join('');
    var filters = '<form data-submit="dbSearch" class="tb" style="border:0;padding:0 0 12px;flex-wrap:wrap"><input type="search" name="q" value="' + esc(DBV.q) + '" placeholder="Search ' + esc(ds.label || '') + '" aria-label="Search" style="min-width:min(100%,260px)">' +
      (ds.branch ? '<select name="branch" aria-label="Branch"><option value="">All branches</option>' + brs + '</select>' : '') +
      (ds.hasTest ? '<label class="chk sm"><input type="checkbox" name="test"' + (DBV.test ? ' checked' : '') + '> Include test records</label>' : '') +
      '<button class="btn sm primary" type="submit">Search</button><span class="row" style="margin-left:auto"><button class="btn sm" type="button" data-act="dbCsv">' + ic('download') + ' Export CSV</button><button class="btn sm" type="button" data-act="dbBackup">' + ic('download') + ' Full backup (JSON)</button><button class="btn sm ghost" type="button" data-act="dbRefresh">Refresh</button></span></form>';
    return '<div class="banner">' + ic('shield') + '<span>Read-only view of the live database. Passwords, two-step secrets and session tokens are never shown. Exports and backups are recorded in the audit log.</span></div>' +
      card('Tables', groups) + '<div style="height:14px"></div>' + card(esc(ds.label || 'Records') + (ds.note ? '<div class="muted xs" style="font-weight:400">' + esc(ds.note) + '</div>' : ''), filters + body);
  };
  ACT.dbPick = function (d) { DBV.name = d.n; DBV.offset = 0; DBV.q = ''; DBV.branch = ''; DBV.page = null; dbLoad(); render(); };
  ACT.dbPage = function (d) { DBV.offset = Math.max(0, DBV.offset + (+d.d) * DB_LIMIT); dbLoad(); };
  ACT.dbRefresh = function () { DBV.tables = null; DBV.page = null; dbLoad(); render(); };
  SUB.dbSearch = function (d) { DBV.q = d.q || ''; DBV.branch = d.branch || ''; DBV.test = !!d.test; DBV.offset = 0; dbLoad(); };
  ACT.dbCsv = function () { dbDownload('/admin/db/rows.csv' + dbQuery(), 'lof-' + DBV.name + '.csv').then(function (r) { toast(r && r.truncated ? 'CSV downloaded – first 50,000 rows only; narrow the search for the rest' : 'CSV downloaded', r && r.truncated ? 'warn' : 'ok'); }).catch(function (e) { toast(e.message, 'err'); }); };
  ACT.dbBackup = function () { dbDownload('/admin/db/backup', 'lof-crm-backup.json').then(function () { toast('Backup downloaded – keep it somewhere safe', 'ok'); }).catch(function (e) { toast(e.message, 'err'); }); };
  ACT.dbRec = function (d) { if (!DBV.page || DBV.page.name !== DBV.name) return; req('GET', '/admin/db/record?name=' + encodeURIComponent(DBV.name) + '&id=' + encodeURIComponent(d.id)).then(function (r) { openModal('dbRec', { id: d.id, r: r }); }).catch(function (e) { toast(e.message, 'err'); }); };
  MODALS.dbRec = function (m) {
    return {
      title: (((DBV.tables || []).find(function (x) { return x.name === DBV.name; }) || {}).label || 'Record') + ' – ' + m.id, size: 'lg', foot: '<button class="btn" data-act="closeModal">Close</button>',
      body: (m.r.meta ? '<p class="muted xs">Updated ' + esc(m.r.meta.updated_at || '') + (m.r.meta.updated_by ? ' by ' + esc(m.r.meta.updated_by) : '') + ' · version ' + esc(m.r.meta.version || 1) + (m.r.meta.is_test ? ' · test record' : '') + '</p>' : '') +
        '<pre class="mono sm" style="white-space:pre-wrap;word-break:break-word;max-height:60vh;overflow:auto;background:var(--bg2,#f6f7f9);padding:12px;border-radius:6px">' + esc(JSON.stringify(m.r.record, null, 2)) + '</pre>'
    };
  };

  // ------------------------------------------------------------------ Configuration → Email Templates (after Communication)
  CTABS.splice(CTABS.findIndex(function (t) { return t[0] === 'comms'; }) + 1, 0, ['emailTpls', 'Email Templates']);
  var ET = { cat: '', q: '' }, etLastField = 'body';
  function etMeta() { return SERVER.emailTemplates || { categories: [], placeholders: {} }; }
  function etList() { return S.cfg.emailTpls || (S.cfg.emailTpls = []); }
  function etById(id) { return etList().find(function (t) { return t.id === id; }); }
  function etBranch(id) { if (id === 'All') return 'All branches'; var b = (S.branches || []).find(function (x) { return x.id === id; }); return b ? b.name : id; }
  function etSample(s) { var p = etMeta().placeholders; return String(s).replace(/\{(\w+)\}/g, function (all, k) { return p[k] ? p[k].sample : all; }); }
  CFG.emailTpls = function () {
    var meta = etMeta(), edit = can('configuration', 'E'), q = ET.q.toLowerCase(), all = etList();
    var rows = all.filter(function (t) { return (!ET.cat || t.cat === ET.cat) && (!q || (t.n + ' ' + t.subject + ' ' + t.body).toLowerCase().indexOf(q) >= 0); });
    var cats = '<div class="chips" style="margin-bottom:12px">' + [''].concat(meta.categories).map(function (c) {
      var n = all.filter(function (t) { return !c || t.cat === c; }).length;
      return '<a class="chip' + (ET.cat === c ? ' on' : '') + '" data-act="etCat" data-c="' + esc(c) + '" tabindex="0">' + esc(c || 'All') + ' <span class="muted xs">' + n + '</span></a>';
    }).join('') + '</div>';
    var search = '<div class="tb" style="border:0;padding:0 0 12px"><input type="search" id="etq" data-input="etq" placeholder="Search name, subject or message" value="' + esc(ET.q) + '" aria-label="Search e-mail templates" style="min-width:min(100%,300px)"></div>';
    var list = rows.length ? table('etpl', [
      { h: 'Template', f: function (t) { return '<b>' + esc(t.n) + '</b><div class="muted xs">' + esc(t.cat) + '</div>'; }, s: function (t) { return t.cat + ' ' + t.n; } },
      { h: 'Subject', f: function (t) { return '<span class="sm">' + esc(t.subject) + '</span>'; } },
      { h: 'Branch', f: function (t) { return esc(etBranch(t.branch)); }, s: function (t) { return etBranch(t.branch); } },
      { h: 'Status', f: function (t) { return bdg(t.active ? 'Active' : 'Inactive', t.active ? 'ok' : ''); } },
      {
        h: '', f: function (t) {
          return '<span class="row" style="justify-content:flex-end;flex-wrap:nowrap"><button class="btn sm" data-act="etPreview" data-id="' + t.id + '">Preview</button>' +
            (edit ? '<button class="btn sm" data-act="etEdit" data-id="' + t.id + '">Edit</button><button class="btn sm ghost" data-act="etCopy" data-id="' + t.id + '">Duplicate</button>' : '') + '</span>';
        }
      },
    ], rows, { all: 1 }) : emptyBox('No templates', ET.q || ET.cat ? 'Clear the search or pick another category.' : 'Add the first template.');
    return card('Email Templates<div class="muted xs" style="font-weight:400">E-mails to parents and clients – fee receipts, reminders, competitions, progress updates and notices.</div>',
      cats + search + list, { act: edit ? '<button class="btn sm primary" data-act="etAdd">' + ic('plus') + ' Add template</button>' : '' }) +
      '<p class="muted xs">Placeholders such as {student_name} or {receipt_no} are filled in when an e-mail is sent. A template for one branch is used instead of the “All branches” template with the same name. Automated lead and enrolment messages are under Communication.</p>';
  };
  ACT.etCat = function (d) { ET.cat = d.c || ''; render(); };
  INP.etq = function (el) { ET.q = el.value; render(); };
  ACT.etAdd = function () { openModal('etTpl', {}); };
  ACT.etEdit = function (d) { openModal('etTpl', { id: d.id }); };
  ACT.etCopy = function (d) { openModal('etTpl', { copy: d.id }); };
  ACT.etPreview = function (d) { openModal('etPreview', { id: d.id }); };
  ACT.etDelete = function (d) { var t = etById(d.id); if (t) confirmBox('Delete template', 'Delete <b>' + esc(t.n) + '</b>? E-mails already sent are not affected.', 'etDelete', d.id, 'Delete', true); };
  CONFIRM.etDelete = function (id) {
    var t = etById(id); if (!t) return;
    S.cfg.emailTpls = etList().filter(function (x) { return x.id !== id; });
    cfgSave('E-mail template ' + t.n, 'Deleted');
  };
  // Placeholder chips insert at the cursor of the subject or message field (whichever was used last)
  document.addEventListener('focusin', function (e) { if (e.target && (e.target.id === 'f_subject' || e.target.id === 'f_body')) etLastField = e.target.id.slice(2); });
  ACT.etIns = function (d) {
    var el = document.getElementById('f_' + etLastField); if (!el) return;
    var v = '{' + d.k + '}', a = el.selectionStart == null ? el.value.length : el.selectionStart, b = el.selectionEnd == null ? a : el.selectionEnd;
    el.value = el.value.slice(0, a) + v + el.value.slice(b);
    el.focus(); el.selectionStart = el.selectionEnd = a + v.length;
  };
  MODALS.etTpl = function (m) {
    var meta = etMeta(), src = etById(m.id || m.copy);
    var t = src ? Object.assign({}, src) : { cat: ET.cat || meta.categories[0], n: '', subject: '', body: '', branch: 'All', active: true };
    if (m.copy) t.n = t.n + ' (copy)';
    var chips = Object.keys(meta.placeholders).map(function (k) { return '<a class="chip" data-act="etIns" data-k="' + k + '" tabindex="0" title="' + esc(meta.placeholders[k].label) + '">{' + k + '}</a>'; }).join('');
    return {
      title: m.id ? 'Edit e-mail template' : 'Add e-mail template', size: 'lg', form: 'etTpl',
      foot: '<button class="btn" type="button" data-act="closeModal">Cancel</button>' + (m.id ? '<button class="btn danger" type="button" data-act="etDelete" data-id="' + esc(m.id) + '">Delete</button>' : '') + '<button class="btn primary" type="submit" form="mform">Save template</button>',
      body: '<input type="hidden" name="oid" value="' + esc(m.id || '') + '"><div class="fgrid">' +
        F('Category', 'cat', { v: t.cat, opts: meta.categories, req: 1 }) + F('Template name', 'n', { v: t.n, req: 1, ph: 'e.g. Fee receipt' }) +
        F('Branch', 'branch', { v: t.branch, opts: [['All', 'All branches']].concat((S.branches || []).map(function (b) { return [b.id, b.name]; })) }) +
        CK('Active – available for sending', 'active', t.active) +
        F('Subject', 'subject', { v: t.subject, req: 1, full: 1 }) +
        F('Message', 'body', { t: 'textarea', rows: 12, v: t.body, req: 1, full: 1, help: 'Plain text. Blank lines start a new paragraph.' }) +
        '<div class="f full"><label>Placeholders – click to insert at the cursor</label><div class="chips">' + chips + '</div></div></div>'
    };
  };
  SUB.etTpl = function (d, f) {
    if (!need(f, d, ['n', 'subject', 'body'])) return;
    var known = etMeta().placeholders, name = d.n.trim(), branch = d.branch || 'All';
    var unknown = function (s) { return (String(s).match(/\{[^{}]*\}/g) || []).map(function (p) { return p.slice(1, -1); }).find(function (k) { return !known[k]; }); };
    var bs = unknown(d.subject), bb = unknown(d.body);
    if (bs !== undefined) { setErr(f, 'subject', 'Unknown placeholder {' + bs + '}'); return; }
    if (bb !== undefined) { setErr(f, 'body', 'Unknown placeholder {' + bb + '}'); return; }
    if (etList().some(function (t) { return t.id !== d.oid && t.n.toLowerCase() === name.toLowerCase() && t.branch === branch; })) { setErr(f, 'n', 'A template with this name already exists for this branch'); return; }
    var o = { cat: d.cat, n: name, subject: d.subject.trim(), body: d.body, branch: branch, active: !!d.active };
    if (d.oid) Object.assign(etById(d.oid), o);
    else {
      var next = etList().reduce(function (mx, t) { return Math.max(mx, +String(t.id).replace(/\D/g, '') || 0); }, 0) + 1;
      etList().push(Object.assign({ id: 'ET' + next }, o));
    }
    closeModal();
    cfgSave('E-mail template ' + name, o.cat + ' · ' + etBranch(branch));
  };
  MODALS.etPreview = function (m) {
    var t = etById(m.id) || {}, p = etMeta().placeholders;
    return {
      title: 'Preview – ' + (t.n || ''), size: 'lg',
      foot: '<button class="btn" data-act="closeModal">Close</button>' + (can('configuration', 'E') ? '<button class="btn primary" data-act="etEdit" data-id="' + esc(t.id) + '">Edit</button>' : ''),
      body: '<p class="muted xs" style="margin-top:0">Shown with sample values. Real e-mails use the student’s and parent’s details.</p>' +
        '<div style="border:1px solid var(--bd);border-radius:8px;overflow:hidden"><div style="padding:10px 14px;border-bottom:1px solid var(--bd)">' +
        '<div class="muted xs">To: ' + esc(p.parent_name ? p.parent_name.sample : '') + '</div><b>' + esc(etSample(t.subject || '')) + '</b></div>' +
        '<div class="sm" style="padding:14px;white-space:pre-wrap;line-height:1.55">' + esc(etSample(t.body || '')) + '</div></div>'
    };
  };

  // ------------------------------------------------------------------ Configuration → Email Outgoing / Email Incoming
  CTABS.splice(CTABS.findIndex(function (t) { return t[0] === 'emailTpls'; }) + 1, 0, ['mailOut', 'Email Outgoing'], ['mailIn', 'Email Incoming']);
  var MAIL = { status: null, inbox: null, loading: false, error: null };
  var MAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
  function mailLoad() {
    if (MAIL.loading) return;
    MAIL.loading = true; MAIL.error = null;
    Promise.all([req('GET', '/mail/status'), req('GET', '/mail/inbound')])
      .then(function (r) { MAIL.status = r[0]; MAIL.inbox = r[1].items; })
      .catch(function (e) { MAIL.error = e.message; })
      .then(function () { MAIL.loading = false; safeRender(); });
  }
  function mailReady() { if (!MAIL.status && !MAIL.loading && !MAIL.error) mailLoad(); return !!MAIL.status; }
  var mailKV = function (rows) { return '<div class="fgrid">' + rows.map(function (r) { return '<div class="f"><label>' + r[0] + '</label><div>' + r[1] + '</div></div>'; }).join('') + '</div>'; };

  CFG.mailOut = function () {
    var o = S.cfg.mailOut || {}, edit = can('configuration', 'E'), st = MAIL.status && MAIL.status.outgoing;
    var status = !mailReady() ? (MAIL.error ? emptyBox('Could not load', MAIL.error) : emptyBox('Loading…', '')) : mailKV([
      ['Provider', esc(st.provider)],
      ['Mode', st.mode === 'live' ? bdg('Live – e-mails are delivered', 'ok') : bdg('Mock – nothing is delivered', 'warn')],
      ['Sending address', '<span class="mono sm">' + esc(st.from || 'not set') + '</span>'],
      ['Missing settings', st.missing.length ? '<span class="mono xs" style="color:var(--crit)">' + st.missing.map(esc).join(', ') + '</span>' : bdg('None', 'ok')],
    ]) + (o.on === false ? '<div class="banner" style="margin-top:12px">' + ic('alert') + '<span><b>Sending is paused.</b> E-mails are not sent until you turn sending back on.</span></div>' : '');
    var form = cfgForm('mailOut',
      swRow('Send e-mails', 'on', o.on !== false, 'Turn off to pause every e-mail the CRM sends (messages are marked Failed and can be sent again).') +
      '<div class="fgrid" style="margin-top:12px">' +
      F('Sender name', 'fromName', { v: o.fromName, req: 1, help: 'Shown to parents as the sender, e.g. Lab of Future' }) +
      F('Reply-to address', 'replyTo', { v: o.replyTo, ph: 'communications@laboffuture.com', help: 'Where parent replies go. Leave empty to use the sending address.' }) +
      F('Send a copy (BCC) to', 'bcc', { v: o.bcc, ph: 'optional', help: 'Keeps a copy of every e-mail in this mailbox' }) +
      F('Daily sending limit', 'dailyLimit', { t: 'number', min: 0, max: 10000, v: o.dailyLimit, help: 'Stops sending for the day above this number (0 = no limit). Gmail allows about 2,000 a day.' }) +
      F('Signature', 'signature', { t: 'textarea', rows: 4, v: o.signature, full: 1, ph: 'Lab of Future\n+971 4 000 0000 · laboffuture.com', help: 'Added to the end of every e-mail' }) + '</div>');
    var test = '<form data-submit="mailTest" class="row" novalidate style="flex-wrap:wrap;gap:8px"><input type="email" name="to" placeholder="your.name@laboffuture.com" aria-label="Send test e-mail to" style="min-width:min(100%,280px)"><button class="btn primary" type="submit">Send test e-mail</button></form>' +
      '<p class="muted xs">Uses the saved settings above. In mock mode the e-mail is only written to the Integration log.</p>';
    return card('Connection', status, { act: '<button class="btn sm ghost" data-act="mailRefresh">Refresh</button>' }) + '<div style="height:14px"></div>' +
      card('Sending rules', edit ? form : mailKV([['Sending', o.on === false ? 'Paused' : 'On'], ['Sender name', esc(o.fromName)], ['Reply-to', esc(o.replyTo || '—')], ['Copy to', esc(o.bcc || '—')], ['Daily limit', esc(o.dailyLimit)]])) +
      (edit ? '<div style="height:14px"></div>' + card('Test', test) : '') +
      '<p class="muted xs">These rules apply to every e-mail the CRM sends: lead messages, enrolment welcome, payment links and e-mail templates.</p>';
  };
  SUB.cfg_mailOut = function (d, f) {
    clearErrs(f);
    if (!need(f, d, ['fromName'])) return;
    if (/[<>"]/.test(d.fromName)) { setErr(f, 'fromName', 'Do not use < > or quotes'); return; }
    if (d.replyTo && !MAIL_RE.test(d.replyTo.trim())) { setErr(f, 'replyTo', 'Enter a valid e-mail address'); return; }
    if (d.bcc && !MAIL_RE.test(d.bcc.trim())) { setErr(f, 'bcc', 'Enter a valid e-mail address'); return; }
    var lim = Number(d.dailyLimit);
    if (!Number.isInteger(lim) || lim < 0 || lim > 10000) { setErr(f, 'dailyLimit', 'Whole number from 0 to 10,000'); return; }
    S.cfg.mailOut = { on: !!d.on, fromName: d.fromName.trim(), replyTo: (d.replyTo || '').trim().toLowerCase(), bcc: (d.bcc || '').trim().toLowerCase(), signature: d.signature || '', dailyLimit: lim };
    cfgSave('Email Outgoing', (d.on ? 'Sending on' : 'Sending paused') + ' · limit ' + lim + '/day');
  };
  SUB.mailTest = function (d) {
    var to = String(d.to || '').trim();
    if (!MAIL_RE.test(to)) { toast('Enter a valid e-mail address', 'err'); return; }
    flush().then(function () { return req('POST', '/mail/test-send', { to: to }); })
      .then(function (r) { toast(r.mode === 'live' ? 'Test e-mail sent to ' + to : 'Mock mode: test e-mail logged, not delivered', r.mode === 'live' ? 'ok' : 'warn'); })
      .catch(function (e) { toast(e.message, 'err'); });
  };
  ACT.mailRefresh = function () { MAIL.status = null; MAIL.inbox = null; MAIL.error = null; mailLoad(); render(); };

  CFG.mailIn = function () {
    var r = S.cfg.mailIn || {}, edit = can('configuration', 'E'), ready = mailReady();
    var brs = (S.branches || []).map(function (b) { return [b.id, b.name]; });
    var progs = (S.programs || []).map(function (p) { return [p.id, p.name]; });
    var conn = '<div class="banner">' + ic('mail') + '<span>' + (ready && MAIL.status.incoming.connected ? 'Mailbox connected – new e-mails are imported every 5 minutes.' : '<b>Mailbox not connected yet.</b> Automatic import starts when the Gmail connection is set up. You can set the rules now and test them with the simulation below.') + '</span></div>';
    var form = cfgForm('mailIn',
      swRow('Import incoming e-mail', 'on', !!r.on, 'Read new e-mails from the mailbox and file them in the CRM') +
      swRow('Notify staff when an e-mail arrives', 'notify', r.notify !== false, 'The counsellor (leads) or the branch team (students) gets a CRM notification') +
      '<div class="fgrid" style="margin-top:12px">' +
      F('Mailbox', 'mailbox', { v: r.mailbox, ph: 'communications@laboffuture.com' }) +
      F('E-mail from an unknown sender', 'unknown', { v: r.unknown || 'review', opts: [['review', 'Hold for review – notify the Admissions Head'], ['lead', 'Create a new lead'], ['ignore', 'Ignore']] }) +
      F('Branch for new leads', 'branch', { v: r.branch, opts: brs, blank: '— choose —', help: 'Used when unknown senders create a lead' }) +
      F('Programme for new leads', 'prog', { v: r.prog, opts: progs, blank: '— choose —' }) +
      F('Blocked senders', 'block', { t: 'textarea', rows: 4, v: (r.block || []).join('\n'), full: 1, ph: 'spam@example.com\n@marketing-company.com', help: 'One address or domain per line. E-mails from these senders are never filed.' }) + '</div>');
    var how = '<ol class="sm" style="margin:0;padding-left:18px;line-height:1.7">' +
      '<li>Sender is a <b>parent on a student record</b> → filed on that student (on each sibling) and the branch team is notified.</li>' +
      '<li>Sender is a <b>lead’s e-mail</b> → filed on the newest open lead and its counsellor is notified.</li>' +
      '<li><b>Unknown sender</b> → held for review, a new lead is created, or ignored (rule above).</li>' +
      '<li>Blocked senders, auto-replies and bounce messages are skipped. The same e-mail is never filed twice.</li></ol>';
    var sim = '<form data-submit="mailSim" novalidate><div class="fgrid">' +
      F('From (e-mail)', 'from', { req: 1, ph: 'parent@example.com', id: 'ms_from' }) + F('Sender name', 'fromName', { ph: 'optional', id: 'ms_name' }) +
      F('Subject', 'subject', { v: 'Question about the next class', full: 1, id: 'ms_subject' }) +
      F('Message', 'text', { t: 'textarea', rows: 3, v: 'Hello, can you tell me when the next class starts?', full: 1, id: 'ms_text' }) +
      '</div><div class="row" style="margin-top:12px"><button class="btn primary" type="submit">Run simulation</button><span class="muted xs">Uses the saved rules. Use a parent’s address to see it land on their record; leads created here are test records (TST-…).</span></div></form>';
    var rows = (MAIL.inbox || []);
    var tone = function (s) { return /^Matched|^New lead/.test(s) ? 'ok' : /review/.test(s) ? 'warn' : ''; };
    var link = function (i) {
      if (!i.ref) return '<span class="faint">—</span>';
      return i.ref.split(', ').map(function (id) { return '<a class="link" tabindex="0" data-act="go" data-page="' + (i.refType === 'student' ? 'student' : 'lead') + '" data-id="' + esc(id) + '">' + esc(id) + '</a>'; }).join(', ');
    };
    var inbox = !ready ? emptyBox(MAIL.error ? 'Could not load' : 'Loading…', MAIL.error || '') : rows.length ? table('mailin', [
      { h: 'Received', f: function (i) { return fDT(i.at || i.receivedAt) + (i.sim ? '<div class="muted xs">Simulation</div>' : ''); }, s: function (i) { return i.at || i.receivedAt; } },
      { h: 'From', f: function (i) { return (i.fromName ? esc(i.fromName) + '<div class="muted xs">' + esc(i.from) + '</div>' : esc(i.from)); } },
      { h: 'Subject', f: function (i) { return '<b class="sm">' + esc(i.subject) + '</b><div class="muted xs">' + esc((i.snippet || '').slice(0, 90)) + '</div>'; } },
      { h: 'Result', f: function (i) { return bdg(i.status, tone(i.status)); } },
      { h: 'Filed on', f: link },
    ], rows, { ps: 10 }) : emptyBox('No e-mails yet', 'Received e-mails and simulations appear here.');
    return conn + card('Filing rules', edit ? form : mailKV([['Import', r.on ? 'On' : 'Off'], ['Mailbox', esc(r.mailbox || '—')], ['Unknown sender', esc(r.unknown || 'review')]])) +
      '<div style="height:14px"></div><div class="grid g2" style="align-items:start">' + card('How e-mails are filed', how) + (edit ? card('Simulate an incoming e-mail', sim) : '') + '</div>' +
      '<div style="height:14px"></div>' + card('Recent incoming e-mails', inbox, { np: rows.length ? 1 : 0, act: '<button class="btn sm ghost" data-act="mailRefresh">Refresh</button>' });
  };
  SUB.cfg_mailIn = function (d, f) {
    clearErrs(f);
    if (d.mailbox && !MAIL_RE.test(d.mailbox.trim())) { setErr(f, 'mailbox', 'Enter a valid e-mail address'); return; }
    if (d.unknown === 'lead') {
      if (!d.branch) { setErr(f, 'branch', 'Choose a branch'); return; }
      var b = (S.branches || []).find(function (x) { return x.id === d.branch; });
      if (!d.prog || !b || (b.programs || []).indexOf(d.prog) < 0) { setErr(f, 'prog', 'Choose a programme offered at this branch'); return; }
    }
    var block = String(d.block || '').split(/[\n,;]+/).map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
    var bad = block.find(function (x) { return !MAIL_RE.test(x) && !/^@?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(x); });
    if (bad) { setErr(f, 'block', '"' + bad + '" is not an e-mail address or domain'); return; }
    S.cfg.mailIn = { on: !!d.on, mailbox: (d.mailbox || '').trim().toLowerCase(), unknown: d.unknown || 'review', branch: d.branch || '', prog: d.prog || '', block: block, notify: !!d.notify };
    cfgSave('Email Incoming', (d.on ? 'Import on' : 'Import off') + ' · unknown senders: ' + S.cfg.mailIn.unknown);
  };
  SUB.mailSim = function (d, f) {
    clearErrs(f);
    if (!MAIL_RE.test(String(d.from || '').trim())) { setErr(f, 'from', 'Enter the sender’s e-mail address'); return; }
    flush().then(function () { return req('POST', '/mail/inbound/simulate', { from: d.from.trim(), fromName: d.fromName || '', subject: d.subject || '', text: d.text || '' }); })
      .then(function (r) {
        toast('Simulation: ' + r.status + (r.ref ? ' – ' + r.ref : ''), /^Matched|^New lead/.test(r.status) ? 'ok' : 'warn');
        MAIL.inbox = null; MAIL.status = null; mailLoad(); return reload(false);
      })
      .catch(function (e) { toast(e.message, 'err'); });
  };

  // ------------------------------------------------------------------ Configuration → Branches: delete / archive
  // A branch with no records is deleted. A branch with records (payments can never be deleted) is archived instead:
  // it leaves every list, dropdown and everyone's branch access, its records stay stored, and it can be restored.
  var isArchived = function (b) { return !!(b && b.archived); };
  var _cfgBranches = CFG.branches;
  CFG.branches = function () {
    var all = S.branches, html;
    S.branches = all.filter(function (b) { return !isArchived(b); }); // the table shows active branches only
    try { html = _cfgBranches(); } finally { S.branches = all; }
    var gone = all.filter(isArchived);
    if (gone.length) {
      html += '<div style="height:14px"></div>' + card('Archived branches', table('cbArch', [
        { h: 'Branch', f: function (b) { return '<b>' + esc(b.name) + '</b><div class="mono muted xs">' + esc(b.code) + '</div>'; } },
        { h: 'Country · city', f: function (b) { return esc(b.country + ' · ' + b.city); } },
        { h: 'Archived', f: function (b) { return (b.archivedAt ? fDT(b.archivedAt) : '—') + (b.archivedBy ? '<div class="muted xs">by ' + esc(b.archivedBy) + '</div>' : ''); } },
        { h: '', f: function (b) { return can('configuration', 'D') ? '<button class="btn sm" data-act="restoreBranch" data-id="' + esc(b.id) + '">Restore</button>' : ''; } },
      ], gone, { all: 1 }), { np: 1 }) + '<p class="muted xs">Archived branches and their records are hidden from every screen and kept in the database (Settings → Database). Restoring brings them back with status Closed.</p>';
    }
    if (!can('configuration', 'D')) return html;
    return html.replace(/(<button class="btn sm" data-act="mBranch" data-id="([^"]+)">Edit<\/button>)/g,
      '<span class="row" style="flex-wrap:nowrap;justify-content:flex-end">$1<button class="btn sm" style="color:var(--crit)" data-act="delBranch" data-id="$2">Delete</button></span>');
  };
  function branchUse(id) {
    var n = function (arr) { return (arr || []).filter(function (x) { return x && x.branch === id; }).length; };
    var use = [[n(S.leads), 'leads'], [n(S.opps), 'opportunities'], [n(S.students), 'students'], [n(S.enr), 'enrolments'], [n(S.pay), 'payments'], [n(S.staff), 'staff'], [n(S.fees), 'fee entries']]
      .filter(function (x) { return x[0]; }).map(function (x) { return x[0] + ' ' + x[1]; });
    if ((S.cfg.mailIn || {}).branch === id) use.push('Email Incoming settings');
    if ((S.cfg.emailTpls || []).some(function (t) { return t.branch === id; })) use.push('Email Templates');
    return use;
  }
  ACT.delBranch = function (d) {
    var b = S.branches.find(function (x) { return x.id === d.id; }); if (!b) return;
    var use = branchUse(b.id);
    if (use.length) {
      if ((S.cfg.mailIn || {}).branch === b.id) { toast(b.name + ' receives new leads from e-mail – choose another branch under Email Incoming first', 'err'); return; }
      confirmBox('Delete branch', '<b>' + esc(b.name) + '</b> has records: ' + esc(use.join(', ')) + '.<br><br>Payments and receipts can never be deleted, so the branch will be <b>removed from every list and from everyone’s branch access</b>, and its records kept safely in the database. You can restore it later under Archived branches.', 'archiveBranch', b.id, 'Delete branch', true);
      return;
    }
    confirmBox('Delete branch', 'Delete <b>' + esc(b.name) + '</b> (' + esc(b.id) + ')? This cannot be undone.', 'delBranch', b.id, 'Delete branch', true);
  };
  var afterBranchChange = function () { flush().then(function () { return reload(false); }).catch(function () { }); };
  CONFIRM.archiveBranch = function (id) {
    var b = S.branches.find(function (x) { return x.id === id; }); if (!b) return;
    b.archived = true; b.status = 'Closed';
    addAudit('Branch deleted (archived)', id, b.name);
    toast('Branch ' + b.name + ' deleted – its records are kept and can be restored', 'ok');
    render();
    afterBranchChange();
  };
  ACT.restoreBranch = function (d) {
    var b = S.branches.find(function (x) { return x.id === d.id; }); if (!b) return;
    confirmBox('Restore branch', 'Restore <b>' + esc(b.name) + '</b>? It comes back with status Closed and its records reappear for users with access to it. Set it to Operating under Edit when it reopens.', 'restoreBranch', b.id, 'Restore');
  };
  CONFIRM.restoreBranch = function (id) {
    var b = S.branches.find(function (x) { return x.id === id; }); if (!b) return;
    b.archived = false; delete b.archivedAt; delete b.archivedBy;
    addAudit('Branch restored', id, b.name);
    toast('Branch ' + b.name + ' restored', 'ok');
    render();
    afterBranchChange();
  };
  // ------------------------------------------------------------------ Configuration → Staff & Users: delete / archive
  // A user with no work attached is deleted (login removed). Anyone else is archived: sign-in disabled at once,
  // open leads, opportunities and follow-ups move to the Unassigned queue, history keeps their name; restorable.
  var _cfgStaff = CFG.staff;
  CFG.staff = function () {
    var all = S.staff, html;
    S.staff = all.filter(function (s) { return !isArchived(s); }); // the table shows current users only
    try { html = _cfgStaff(); } finally { S.staff = all; }
    var gone = all.filter(isArchived);
    if (gone.length) {
      html += '<div style="height:14px"></div>' + card('Archived users', table('csArch', [
        { h: 'Name', f: function (s) { return '<b>' + esc(s.name) + '</b><div class="muted xs">' + esc(s.emp || '') + ' · ' + esc(s.email || '') + '</div>'; } },
        { h: 'Role', f: function (s) { return esc(s.role); } },
        { h: 'Branch', f: function (s) { return esc(branchName(s.branch)); } },
        { h: 'Archived', f: function (s) { return (s.archivedAt ? fDT(s.archivedAt) : '—') + (s.archivedBy ? '<div class="muted xs">by ' + esc(s.archivedBy) + '</div>' : ''); } },
        { h: '', f: function (s) { return can('configuration', 'D') ? '<button class="btn sm" data-act="restoreStaff" data-id="' + esc(s.id) + '">Restore</button>' : ''; } },
      ], gone, { all: 1 }), { np: 1 }) + '<p class="muted xs">Archived users cannot sign in. Their name stays on past leads, payments and history. Restoring brings the user back with access disabled – enable it under Edit.</p>';
    }
    if (!can('configuration', 'D')) return html;
    return html.replace(/(<button class="btn sm" data-act="mStaff" data-id="([^"]+)">Edit<\/button>)/g,
      '<span class="row" style="flex-wrap:nowrap;justify-content:flex-end">$1<button class="btn sm" style="color:var(--crit)" data-act="delStaff" data-id="$2">Delete</button></span>');
  };
  function staffUse(id) {
    var count = function (arr, f) { return (arr || []).filter(f).length; };
    var open = { leads: count(S.leads, function (l) { return l.cslr === id && l.status === 'Open'; }), opps: count(S.opps, function (o) { return o.cslr === id && ['Enrolled', 'Lost'].indexOf(o.stage) < 0; }), tasks: count(S.tasks, function (t) { return t.cslr === id && t.status === 'Pending'; }) };
    var any = count(S.leads, function (l) { return l.cslr === id; }) + count(S.opps, function (o) { return o.cslr === id; }) + count(S.tasks, function (t) { return t.cslr === id; }) +
      count(S.enr, function (e) { return e.cslr === id; }) + count(S.branches, function (b) { return b.admin === id; });
    return { open: open, any: any };
  }
  ACT.delStaff = function (d) {
    var s = S.staff.find(function (x) { return x.id === d.id; }); if (!s) return;
    if (s.id === S.user) { toast('You cannot delete your own user', 'err'); return; }
    var u = staffUse(s.id);
    if (!u.any) { confirmBox('Delete user', 'Delete <b>' + esc(s.name) + '</b> (' + esc(s.email) + ')? Their login is removed. This cannot be undone.', 'delStaff', s.id, 'Delete user', true); return; }
    var moves = [[u.open.leads, 'open lead'], [u.open.opps, 'open opportunit'], [u.open.tasks, 'pending follow-up']].filter(function (x) { return x[0]; })
      .map(function (x) { return x[0] + ' ' + x[1] + (x[1] === 'open opportunit' ? (x[0] === 1 ? 'y' : 'ies') : (x[0] === 1 ? '' : 's')); });
    confirmBox('Delete user', '<b>' + esc(s.name) + '</b> has work in the CRM, so their name is kept on past records and the user is <b>archived</b>:<ul class="sm" style="margin:8px 0;padding-left:18px">' +
      '<li>Sign-in is disabled immediately and open sessions end.</li>' +
      (moves.length ? '<li>' + esc(moves.join(', ')) + ' move to the <b>Unassigned queue</b> and the Admissions Head is notified.</li>' : '') +
      '<li>You can restore the user later under Archived users.</li></ul>', 'archiveStaff', s.id, 'Delete user', true);
  };
  CONFIRM.delStaff = function (id) {
    var s = S.staff.find(function (x) { return x.id === id; }); if (!s) return;
    S.staff = S.staff.filter(function (x) { return x.id !== id; });
    if (S.scope) delete S.scope[id];
    if (S.cfg.targets) S.cfg.targets = S.cfg.targets.filter(function (t) { return t.c !== id; });
    addAudit('User deleted', id, s.name);
    toast(s.name + ' deleted', 'ok');
    render();
  };
  CONFIRM.archiveStaff = function (id) {
    var s = S.staff.find(function (x) { return x.id === id; }); if (!s) return;
    s.archived = true; s.status = 'Inactive'; s.access = 'Disabled';
    addAudit('User deleted (archived)', id, s.name);
    toast(s.name + ' deleted – open work moved to the Unassigned queue', 'ok');
    render();
    afterBranchChange();
  };
  ACT.restoreStaff = function (d) {
    var s = S.staff.find(function (x) { return x.id === d.id; }); if (!s) return;
    confirmBox('Restore user', 'Restore <b>' + esc(s.name) + '</b>? The user comes back with access disabled; enable it under Edit to let them sign in. Leads moved to the Unassigned queue are not reassigned automatically.', 'restoreStaff', s.id, 'Restore');
  };
  CONFIRM.restoreStaff = function (id) {
    var s = S.staff.find(function (x) { return x.id === id; }); if (!s) return;
    s.archived = false; delete s.archivedAt; delete s.archivedBy;
    addAudit('User restored', id, s.name);
    toast(s.name + ' restored – enable access under Edit', 'ok');
    render();
    afterBranchChange();
  };

  // Archived branches and users never appear as a choice in any dropdown (records that still show one keep their selection)
  var _renderAll = window.render;
  window.render = function () {
    _renderAll.apply(this, arguments);
    if (!S || !S.branches) return;
    var gone = S.branches.filter(isArchived).concat((S.staff || []).filter(isArchived)).map(function (b) { return b.id; });
    if (!gone.length) return;
    document.querySelectorAll('select option').forEach(function (o) { if (gone.indexOf(o.value) >= 0 && !o.selected) o.remove(); });
  };
  CONFIRM.delBranch = function (id) {
    var b = S.branches.find(function (x) { return x.id === id; }); if (!b) return;
    S.branches = S.branches.filter(function (x) { return x.id !== id; });
    Object.keys(S.scope || {}).forEach(function (k) { if (Array.isArray(S.scope[k])) S.scope[k] = S.scope[k].filter(function (x) { return x !== id; }); });
    addAudit('Branch deleted', id, b.name);
    toast('Branch ' + b.name + ' deleted', 'ok');
    render();
  };

  // ------------------------------------------------------------------ go
  var _closeModal = window.closeModal;
  window.closeModal = function () { _closeModal(); if (deferredRender) { deferredRender = false; render(); } };
  req('GET', '/auth/me').then(function (r) { afterAuth(r.stage); }).catch(function () { loginScreen(); });
})();
