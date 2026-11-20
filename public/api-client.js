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
      var curTotal = colWidths.reduce(function (a, b) { return a + b; }, 0) || 1;
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
      return {
        opt: options, cols: cols, pages: pagesRows, w: pageWidth, h: pageHeight, margin: margin, contentWidth: contentWidth,
        colWidths: colWidths, colAlignRight: colAlignRight, rowHeight: rowHeight, headerHeight: headerHeight,
      };
    }

    function renderPdfPage(L, pIdx, pageNo, totalPages) {
      var options = L.opt, cols = L.cols, pRows = L.pages[pIdx];
      var pageWidth = L.w, pageHeight = L.h, margin = L.margin, contentWidth = L.contentWidth;
      var colWidths = L.colWidths, colAlignRight = L.colAlignRight, rowHeight = L.rowHeight, headerHeight = L.headerHeight;
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
          var val = sanitizePdf(row[cIdx]);
          var rightAlign = colAlignRight[cIdx];
          var charW = 4.8;
          var maxChars = Math.max(4, Math.floor((cW - 10) / charW));
          var displayVal = val.length > maxChars ? val.slice(0, maxChars - 3) + '...' : val;
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

      if (!pRows.length) {
        stream.push('0.45 0.50 0.55 rg');
        stream.push('BT /F1 9 Tf ' + margin + ' ' + (curY - 18).toFixed(2) + ' Td (' + escapePdf(options.empty || 'No records for the selected filters.') + ') Tj ET');
      }

      // Page Footer
      stream.push('0.50 0.55 0.60 rg');
      stream.push('BT /F1 7.5 Tf ' + margin + ' ' + margin + ' Td (' + escapePdf('Lab of Future CRM   *   Confidential') + ') Tj ET');
      stream.push('BT /F1 7.5 Tf ' + (pageWidth - margin - 70).toFixed(2) + ' ' + margin + ' Td (Page ' + pageNo + ' of ' + totalPages + ') Tj ET');

      return stream.join('\n');
    }

    function assemblePdf(pages) {
      var catalogId = 1, pagesRootId = 2, fontNormId = 3, fontBoldId = 4;
      var pageObjIds = [], contentObjIds = [], nextId = 5;
      pages.forEach(function () { pageObjIds.push(nextId++); contentObjIds.push(nextId++); });

      var objTable = {};
      objTable[catalogId] = '<< /Type /Catalog /Pages ' + pagesRootId + ' 0 R >>';
      objTable[pagesRootId] = '<< /Type /Pages /Kids [' + pageObjIds.map(function (id) { return id + ' 0 R'; }).join(' ') + '] /Count ' + pages.length + ' >>';
      objTable[fontNormId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
      objTable[fontBoldId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
      pages.forEach(function (pg, j) {
        objTable[pageObjIds[j]] = '<< /Type /Page /Parent ' + pagesRootId + ' 0 R /MediaBox [0 0 ' + pg.w.toFixed(2) + ' ' + pg.h.toFixed(2) + '] /Contents ' + contentObjIds[j] + ' 0 R /Resources << /Font << /F1 ' + fontNormId + ' 0 R /F2 ' + fontBoldId + ' 0 R >> >> >>';
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
      pdf += 'trailer\r\n<< /Size ' + (maxObj + 1) + ' /Root ' + catalogId + ' 0 R >>\r\nstartxref\r\n' + xrefOffset + '\r\n%%EOF\r\n';

      var bytes = new Uint8Array(pdf.length);
      for (var n = 0; n < pdf.length; n++) bytes[n] = pdf.charCodeAt(n) & 0xff;
      return new Blob([bytes], { type: 'application/pdf' });
    }

    function buildPdfDoc(sections) {
      var layouts = sections.map(layoutPdfSection);
      var total = layouts.reduce(function (a, L) { return a + L.pages.length; }, 0);
      var out = [], pageNo = 0;
      layouts.forEach(function (L) {
        L.pages.forEach(function (_, i) { pageNo++; out.push({ w: L.w, h: L.h, stream: renderPdfPage(L, i, pageNo, total) }); });
      });
      return assemblePdf(out);
    }

    function buildPdfBlob(options) { return buildPdfDoc([options]); }

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
            return p.status !== 'Cancelled' && p.branch === b && (typeof inRange === 'function' ? inRange(p.at, rangeFilter) : true);
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

    // forId: build the context of any report (export all) without changing the report on screen
    function getActiveReportContext(forId) {
      var id = forId || (S.rep ? S.rep.id : 'r1');
      if (isReceptionStaff() && !forId) {
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

    // ---------------- all reports in one file (each user gets the reports and branches they can see)
    function exportableReportIds() {
      if (isReceptionStaff()) return ['r1', 'r22'];
      return (RDEF || []).map(function (r) { return r[0]; }).filter(function (id) { return REP && REP[id]; });
    }
    function allReportContexts() {
      return exportableReportIds().map(function (id) {
        try { return getActiveReportContext(id); } catch (e) { return { id: id, name: id, cols: ['Error'], rows: [[String(e && e.message || e)]], filters: '', note: '' }; }
      });
    }
    var fileDate = function () { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' }); };

    ACT.repExportAll = function () {
      var ctxs = allReportContexts();
      if (!ctxs.length) { if (typeof toast === 'function') toast('No reports available for your role', 'warn'); return; }
      var date = ctxs[0].date || new Date().toLocaleString('en-GB');
      var sections = ctxs.map(function (c, i) {
        return { title: (i + 1) + '. ' + c.name, cols: c.cols, rows: c.rows, filters: c.filters, note: c.note, date: date };
      });
      // Contents first: one line per report with its row count and the page it starts on
      var toc = { title: 'All reports (' + ctxs.length + ')', cols: ['#', 'Report', 'Rows', 'Page'], rows: [], filters: ctxs[0].filters, note: 'Each report starts on a new page.', date: date, landscape: false };
      toc.rows = ctxs.map(function (c, i) { return [String(i + 1), c.name, String(c.rows.length), '']; });
      var page = layoutPdfSection(toc).pages.length + 1;
      toc.rows = ctxs.map(function (c, i) {
        var r = [String(i + 1), c.name, String(c.rows.length), String(page)];
        page += layoutPdfSection(sections[i]).pages.length;
        return r;
      });
      downloadBlob(buildPdfDoc([toc].concat(sections)), 'lof-crm-all-reports-' + fileDate() + '.pdf');
      if (typeof addAudit === 'function') addAudit('All reports exported (PDF)', 'all', ctxs.length + ' reports, ' + (page - 1) + ' pages');
      if (typeof toast === 'function') toast('All ' + ctxs.length + ' reports downloaded as one PDF (' + (page - 1) + ' pages)', 'ok');
    };

    // Excel 2003 XML workbook: a Contents sheet plus one sheet per report (opens in Excel and LibreOffice)
    ACT.repExportAllXls = function () {
      var ctxs = allReportContexts();
      if (!ctxs.length) { if (typeof toast === 'function') toast('No reports available for your role', 'warn'); return; }
      var x = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); };
      var used = {};
      var sheetName = function (i, name) {
        var base = ((i + 1) + ' ' + name).replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31).trim(), n = base, k = 2;
        while (used[n.toLowerCase()]) n = base.slice(0, 28) + ' ' + k++;
        used[n.toLowerCase()] = 1;
        return n;
      };
      var cell = function (v, style) {
        var s = String(v == null ? '' : v), num = /^-?\d+(\.\d+)?$/.test(s.replace(/,/g, '')) && s.length < 16;
        return '<Cell' + (style ? ' ss:StyleID="' + style + '"' : '') + '><Data ss:Type="' + (num ? 'Number' : 'String') + '">' + x(num ? s.replace(/,/g, '') : s) + '</Data></Cell>';
      };
      var sheet = function (name, title, sub, cols, rows) {
        return '<Worksheet ss:Name="' + x(name) + '"><Table>' +
          '<Row>' + cell(title, 'title') + '</Row>' + (sub ? '<Row>' + cell(sub, 'sub') + '</Row>' : '') + '<Row/>' +
          '<Row>' + cols.map(function (c) { return cell(c, 'head'); }).join('') + '</Row>' +
          rows.map(function (r) { return '<Row>' + r.map(function (v) { return cell(v); }).join('') + '</Row>'; }).join('') +
          '</Table></Worksheet>';
      };
      var names = ctxs.map(function (c, i) { return sheetName(i, c.name); });
      var xml = '<?xml version="1.0" encoding="UTF-8"?>\n<?mso-application progid="Excel.Sheet"?>\n' +
        '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
        '<Styles><Style ss:ID="title"><Font ss:Bold="1" ss:Size="13"/></Style><Style ss:ID="sub"><Font ss:Color="#64748B"/></Style>' +
        '<Style ss:ID="head"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#1D3557" ss:Pattern="Solid"/></Style></Styles>' +
        sheet('Contents', 'Lab of Future CRM – all reports', 'Generated ' + (ctxs[0].date || '') + '  |  ' + (ctxs[0].filters || ''), ['#', 'Report', 'Rows', 'Sheet'],
          ctxs.map(function (c, i) { return [String(i + 1), c.name, String(c.rows.length), names[i]]; })) +
        ctxs.map(function (c, i) { return sheet(names[i], c.name, [c.filters, c.note].filter(Boolean).join('  |  '), c.cols, c.rows); }).join('') +
        '</Workbook>';
      downloadBlob(new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' }), 'lof-crm-all-reports-' + fileDate() + '.xls');
      if (typeof addAudit === 'function') addAudit('All reports exported (Excel)', 'all', ctxs.length + ' reports');
      if (typeof toast === 'function') toast('All ' + ctxs.length + ' reports downloaded as one Excel workbook', 'ok');
    };

    // ---------------- new single-report formats: Word document and HTML page
    function reportHtmlDoc(ctx, forWord) {
      var h = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
      return '<html' + (forWord ? ' xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"' : '') + '>' +
        '<head><meta charset="utf-8"><title>' + h(ctx.name) + '</title>' +
        (forWord ? '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->' : '<meta name="viewport" content="width=device-width,initial-scale=1">') +
        '<style>' + (forWord && ctx.cols.length > 6 ? '@page { size: 841.9pt 595.3pt; mso-page-orientation: landscape; margin: 36pt; } ' : '@page { margin: 36pt; } ') +
        'body{font-family:Arial,Helvetica,sans-serif;color:#1e293b;font-size:11pt;margin:24px} .brand{color:#1d3557;font-weight:bold;font-size:15pt}' +
        ' .meta{color:#64748b;font-size:9pt;margin:4px 0 14px} h1{font-size:14pt;margin:14px 0 4px}' +
        ' table{border-collapse:collapse;width:100%;font-size:9pt} th{background:#1d3557;color:#fff;text-align:left;padding:5px 7px;border:1px solid #1d3557}' +
        ' td{padding:4px 7px;border:1px solid #e2e8f0} tr:nth-child(even) td{background:#f8fafc} .foot{color:#94a3b8;font-size:8pt;margin-top:14px}</style></head><body>' +
        '<div class="brand">Lab of Future CRM</div><h1>' + h(ctx.name) + '</h1>' +
        '<div class="meta">Generated ' + h(ctx.date) + (ctx.filters ? ' &nbsp;|&nbsp; ' + h(ctx.filters) : '') + (ctx.note ? '<br>' + h(ctx.note) : '') + '</div>' +
        '<table><thead><tr>' + ctx.cols.map(function (c) { return '<th>' + h(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        (ctx.rows.length ? ctx.rows.map(function (r) { return '<tr>' + r.map(function (v) { return '<td>' + h(v) + '</td>'; }).join('') + '</tr>'; }).join('')
          : '<tr><td colspan="' + Math.max(1, ctx.cols.length) + '">No records for the selected filters.</td></tr>') +
        '</tbody></table><div class="foot">Lab of Future CRM &middot; Confidential &middot; ' + ctx.rows.length + ' rows</div></body></html>';
    }
    ACT.repDoc = function () {
      var ctx = getActiveReportContext();
      downloadBlob(new Blob(['﻿' + reportHtmlDoc(ctx, true)], { type: 'application/msword;charset=utf-8' }), ctx.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.doc');
      if (typeof addAudit === 'function') addAudit('Report exported (Word)', ctx.id, ctx.name);
      if (typeof toast === 'function') toast('Word document downloaded (' + ctx.rows.length + ' rows)', 'ok');
    };
    ACT.repHtml = function () {
      var ctx = getActiveReportContext();
      downloadBlob(new Blob([reportHtmlDoc(ctx, false)], { type: 'text/html;charset=utf-8' }), ctx.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.html');
      if (typeof addAudit === 'function') addAudit('Report exported (HTML)', ctx.id, ctx.name);
      if (typeof toast === 'function') toast('HTML page downloaded (' + ctx.rows.length + ' rows)', 'ok');
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
    ACT.doRepAllXls = function () { if (typeof closeModal === 'function') closeModal(); ACT.repExportAllXls(); };
    ACT.doRepDoc = function () { if (typeof closeModal === 'function') closeModal(); ACT.repDoc(); };
    ACT.doRepHtml = function () { if (typeof closeModal === 'function') closeModal(); ACT.repHtml(); };
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

      var nAll = exportableReportIds().length;
      var allPdfCard = '<div class="card" style="padding:14px;border:1px solid var(--line);border-radius:8px;cursor:pointer" data-act="doRepDoc">' +
          '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="font-size:22px">📝</span><b>Word Document (.doc)</b></div>' +
          '<p class="muted xs" style="margin:0 0 10px">Editable report for Microsoft Word or Google Docs – add comments before sharing.</p>' +
          '<button class="btn sm" type="button" data-act="doRepDoc">' + ic('download') + ' Download Word</button>' +
        '</div>' +
        '<div class="card" style="padding:14px;border:1px solid var(--line);border-radius:8px;cursor:pointer" data-act="doRepHtml">' +
          '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="font-size:22px">🌐</span><b>Web Page (.html)</b></div>' +
          '<p class="muted xs" style="margin:0 0 10px">Self-contained page that opens in any browser – easy to e-mail or archive.</p>' +
          '<button class="btn sm" type="button" data-act="doRepHtml">' + ic('download') + ' Download HTML</button>' +
        '</div>' +
        '</div>' +
        '<div class="sec" style="margin-top:4px">All reports' + (isPriv ? '' : ' – ' + esc(userAssignedBranchNames())) + '</div>' +
        '<p class="muted xs" style="margin:2px 0 10px">Every report you can see (' + nAll + '), with the filters currently selected, in one file.</p>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:0 0 6px">' +
        '<div class="card" style="padding:14px;border:1px solid var(--line);border-radius:8px;cursor:pointer" data-act="doRepAllPdf">' +
          '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="font-size:22px">📚</span><b>All reports – PDF</b></div>' +
          '<p class="muted xs" style="margin:0 0 10px">Contents page, then each of the ' + nAll + ' reports in full, each starting on a new page.</p>' +
          '<button class="btn sm primary" type="button" data-act="doRepAllPdf">' + ic('download') + ' Download all as PDF</button>' +
        '</div>' +
        '<div class="card" style="padding:14px;border:1px solid var(--line);border-radius:8px;cursor:pointer" data-act="doRepAllXls">' +
          '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="font-size:22px">🗂️</span><b>All reports – Excel</b></div>' +
          '<p class="muted xs" style="margin:0 0 10px">One workbook: a Contents sheet plus one sheet per report.</p>' +
          '<button class="btn sm" type="button" data-act="doRepAllXls">' + ic('download') + ' Download all as Excel</button>' +
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
            '<button class="btn" data-act="repExportAll" title="Download every report you can see in one PDF">' + ic('file') + ' Export All (PDF)</button>' +
            '<button class="btn ghost" data-act="repExportModal" title="More download formats (Word, Excel, HTML, JSON, Print, all reports)">' + ic('list') + ' More Formats ▾</button>' +
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
          return [p.id, dateStr, sName, bName, p.enr, amtStr + (p.status === 'Cancelled' ? ' (CANCELLED)' : ''), p.method, p.ref || '—', p.rc];
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
  // ---------------- sign-in screens (final design "LOF CRM Login v3"): a dark starry page with an orbiting satellite, a
  // meteor and a planet horizon; the header with the logo and "Need help?"; the sign-in card in a glowing animated border
  // on the left; on the right the dotted map with the animated route of our centres (Jaipur → Dubai → Chennai →
  // Coimbatore → Mumbai), the headline and the enquiry-to-enrolment journey; the footer lists the roles.
  // Phones: header, a smaller map, then the card. The same shell is used for sign-in, the two-step code, password reset
  // and the forced password change. Stars, route and animations are copied from the design file.
  var LB_ANIM = "@property --lof-a{syntax:'<angle>';inherits:false;initial-value:0deg}\n@keyframes lof-spin{to{--lof-a:360deg}}\n.lof-beam{background:conic-gradient(from var(--lof-a),rgba(142,177,242,0) 0deg,rgba(142,177,242,0) 230deg,rgba(142,177,242,.9) 290deg,#ffffff 318deg,rgba(213,58,40,.95) 340deg,rgba(213,58,40,0) 360deg),rgba(255,255,255,.14);animation:lof-spin 6s linear infinite}\n\n@keyframes lof-rise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}\n@keyframes lof-fade{from{opacity:0}to{opacity:1}}\n.lof-rise{animation:lof-rise .9s cubic-bezier(.2,.7,.2,1) both}\n.lof-fade{animation:lof-fade 1.4s ease both}\n.lof-d1{animation-delay:.1s}.lof-d2{animation-delay:.35s}.lof-d3{animation-delay:.55s}.lof-d4{animation-delay:.75s}\n\n@keyframes lof-flow{0%{left:-23px;opacity:0}6%{opacity:1}84%{left:calc(100% - 23px);opacity:1}96%,100%{left:calc(100% - 23px);opacity:0}}\n.lof-flow{animation:lof-flow 5s cubic-bezier(.45,0,.55,1) infinite}\n@keyframes lof-arrive{0%,82%{box-shadow:0 0 0 0 rgba(213,58,40,0)}88%{box-shadow:0 0 0 8px rgba(213,58,40,.4)}100%{box-shadow:0 0 0 14px rgba(213,58,40,0)}}\n.lof-arrive{animation:lof-arrive 5s ease-out infinite}\n\n@keyframes lof-twinkle{0%,100%{opacity:.15}50%{opacity:.95}}\n.lof-tw1{animation:lof-twinkle 3.2s ease-in-out infinite}\n.lof-tw2{animation:lof-twinkle 4.6s ease-in-out 1.2s infinite}\n.lof-tw3{animation:lof-twinkle 5.8s ease-in-out 2.4s infinite}\n@keyframes lof-rot{to{transform:rotate(360deg)}}\n@keyframes lof-rot-rev{to{transform:rotate(-360deg)}}\n.lof-orbit{transform-origin:600px 600px;animation:lof-rot 48s linear infinite}\n.lof-orbit2{transform-origin:600px 600px;animation:lof-rot-rev 80s linear infinite}\n@keyframes lof-blink{0%,92%,100%{opacity:.25}96%{opacity:1}}\n.lof-blink{animation:lof-blink 2.4s ease-in-out infinite}\n@keyframes lof-meteor{0%,72%{transform:translate(0,0) rotate(-24deg);opacity:0}74%{opacity:1}84%,100%{transform:translate(-520px,232px) rotate(-24deg);opacity:0}}\n.lof-meteor{animation:lof-meteor 11s ease-in 3s infinite}\n\n@keyframes lof-trail1{0%,2%{stroke-dashoffset:379;opacity:1}20%,94%{stroke-dashoffset:0;opacity:1}99%{stroke-dashoffset:0;opacity:0}100%{stroke-dashoffset:379;opacity:0}}\n@keyframes lof-comet1{0%,1.8%{stroke-dashoffset:26;opacity:0}2%{stroke-dashoffset:26;opacity:1}20%{stroke-dashoffset:-379;opacity:1}20.3%,100%{stroke-dashoffset:-379;opacity:0}}\n.lof-trail1{stroke-dasharray:379 379;animation:lof-trail1 var(--lof-t) linear infinite}\n.lof-comet1{stroke-dasharray:26 431;animation:lof-comet1 var(--lof-t) ease-in-out infinite}\n@keyframes lof-trail2{0%,26%{stroke-dashoffset:523;opacity:1}46%,94%{stroke-dashoffset:0;opacity:1}99%{stroke-dashoffset:0;opacity:0}100%{stroke-dashoffset:523;opacity:0}}\n@keyframes lof-comet2{0%,25.8%{stroke-dashoffset:26;opacity:0}26%{stroke-dashoffset:26;opacity:1}46%{stroke-dashoffset:-523;opacity:1}46.3%,100%{stroke-dashoffset:-523;opacity:0}}\n.lof-trail2{stroke-dasharray:523 523;animation:lof-trail2 var(--lof-t) linear infinite}\n.lof-comet2{stroke-dasharray:26 575;animation:lof-comet2 var(--lof-t) ease-in-out infinite}\n@keyframes lof-trail3{0%,52%{stroke-dashoffset:81;opacity:1}58%,94%{stroke-dashoffset:0;opacity:1}99%{stroke-dashoffset:0;opacity:0}100%{stroke-dashoffset:81;opacity:0}}\n@keyframes lof-comet3{0%,51.8%{stroke-dashoffset:26;opacity:0}52%{stroke-dashoffset:26;opacity:1}58%{stroke-dashoffset:-81;opacity:1}58.3%,100%{stroke-dashoffset:-81;opacity:0}}\n.lof-trail3{stroke-dasharray:81 81;animation:lof-trail3 var(--lof-t) linear infinite}\n.lof-comet3{stroke-dasharray:26 133;animation:lof-comet3 var(--lof-t) ease-in-out infinite}\n@keyframes lof-trail4{0%,64%{stroke-dashoffset:177;opacity:1}74%,94%{stroke-dashoffset:0;opacity:1}99%{stroke-dashoffset:0;opacity:0}100%{stroke-dashoffset:177;opacity:0}}\n@keyframes lof-comet4{0%,63.8%{stroke-dashoffset:26;opacity:0}64%{stroke-dashoffset:26;opacity:1}74%{stroke-dashoffset:-177;opacity:1}74.3%,100%{stroke-dashoffset:-177;opacity:0}}\n.lof-trail4{stroke-dasharray:177 177;animation:lof-trail4 var(--lof-t) linear infinite}\n.lof-comet4{stroke-dasharray:26 229;animation:lof-comet4 var(--lof-t) ease-in-out infinite}\n@keyframes lof-on-jaipur{0%,94%{opacity:1}99%,100%{opacity:.75}}\n@keyframes lof-ping-jaipur{0%,0%{transform:scale(.6);opacity:0}0.1%{transform:scale(.6);opacity:.9}7%,100%{transform:scale(2.6);opacity:0}}\n.lof-on-jaipur{animation:lof-on-jaipur var(--lof-t) linear infinite}.lof-ping-jaipur{transform-box:fill-box;transform-origin:center;animation:lof-ping-jaipur var(--lof-t) ease-out infinite}\n@keyframes lof-on-dubai{0%,19.5%{opacity:.4}20%,94%{opacity:1}99%,100%{opacity:.4}}\n@keyframes lof-ping-dubai{0%,19.9%{transform:scale(.6);opacity:0}20.1%{transform:scale(.6);opacity:.9}27%,100%{transform:scale(2.6);opacity:0}}\n.lof-on-dubai{animation:lof-on-dubai var(--lof-t) linear infinite}.lof-ping-dubai{transform-box:fill-box;transform-origin:center;animation:lof-ping-dubai var(--lof-t) ease-out infinite}\n@keyframes lof-on-mumbai{0%,73.5%{opacity:.4}74%,94%{opacity:1}99%,100%{opacity:.4}}\n@keyframes lof-ping-mumbai{0%,73.9%{transform:scale(.6);opacity:0}74.1%{transform:scale(.6);opacity:.9}81%,100%{transform:scale(2.6);opacity:0}}\n.lof-on-mumbai{animation:lof-on-mumbai var(--lof-t) linear infinite}.lof-ping-mumbai{transform-box:fill-box;transform-origin:center;animation:lof-ping-mumbai var(--lof-t) ease-out infinite}\n@keyframes lof-on-chennai{0%,45.5%{opacity:.4}46%,94%{opacity:1}99%,100%{opacity:.4}}\n@keyframes lof-ping-chennai{0%,45.9%{transform:scale(.6);opacity:0}46.1%{transform:scale(.6);opacity:.9}53%,100%{transform:scale(2.6);opacity:0}}\n.lof-on-chennai{animation:lof-on-chennai var(--lof-t) linear infinite}.lof-ping-chennai{transform-box:fill-box;transform-origin:center;animation:lof-ping-chennai var(--lof-t) ease-out infinite}\n@keyframes lof-on-coimbatore{0%,57.5%{opacity:.4}58%,94%{opacity:1}99%,100%{opacity:.4}}\n@keyframes lof-ping-coimbatore{0%,57.9%{transform:scale(.6);opacity:0}58.1%{transform:scale(.6);opacity:.9}65%,100%{transform:scale(2.6);opacity:0}}\n.lof-on-coimbatore{animation:lof-on-coimbatore var(--lof-t) linear infinite}.lof-ping-coimbatore{transform-box:fill-box;transform-origin:center;animation:lof-ping-coimbatore var(--lof-t) ease-out infinite}\n.lof-route{--lof-t:12s}\n\n@media (prefers-reduced-motion: reduce){\n.lof-route *,.lof-beam,.lof-rise,.lof-fade,.lof-flow,.lof-arrive,.lof-tw1,.lof-tw2,.lof-tw3,.lof-orbit,.lof-orbit2,.lof-blink,.lof-meteor{animation:none !important}\n.lof-route [class^=lof-comet],.lof-route [class^=lof-ping],.lof-flow,.lof-meteor{opacity:0 !important}\n.lof-route [class^=lof-trail]{stroke-dashoffset:0 !important}\n}";
  var LB_STARS = "<circle class=\"lof-tw1\" cx=\"466.3\" cy=\"111.3\" r=\"0.6\" fill=\"#dbe6f7\" opacity=\"0.29\"></circle><circle cx=\"771.7\" cy=\"269.9\" r=\"0.6\" fill=\"#dbe6f7\" opacity=\"0.75\"></circle><circle cx=\"309.2\" cy=\"63.4\" r=\"1.3\" fill=\"#dbe6f7\" opacity=\"0.29\"></circle><circle cx=\"130.6\" cy=\"313.3\" r=\"0.7\" fill=\"#dbe6f7\" opacity=\"0.77\"></circle><circle cx=\"908.1\" cy=\"430.3\" r=\"0.6\" fill=\"#dbe6f7\" opacity=\"0.57\"></circle><circle class=\"lof-tw3\" cx=\"571.2\" cy=\"720.5\" r=\"0.6\" fill=\"#dbe6f7\" opacity=\"0.56\"></circle><circle cx=\"191.8\" cy=\"309.3\" r=\"0.7\" fill=\"#dbe6f7\" opacity=\"0.56\"></circle><circle cx=\"806.8\" cy=\"503.3\" r=\"0.7\" fill=\"#dbe6f7\" opacity=\"0.57\"></circle><circle cx=\"920.0\" cy=\"274.8\" r=\"0.7\" fill=\"#dbe6f7\" opacity=\"0.56\"></circle><circle cx=\"891.4\" cy=\"366.4\" r=\"1.3\" fill=\"#dbe6f7\" opacity=\"0.68\"></circle><circle class=\"lof-tw2\" cx=\"670.5\" cy=\"681.5\" r=\"1.1\" fill=\"#dbe6f7\" opacity=\"0.41\"></circle><circle cx=\"1143.9\" cy=\"515.9\" r=\"0.9\" fill=\"#dbe6f7\" opacity=\"0.3\"></circle><circle cx=\"432.4\" cy=\"365.4\" r=\"1.1\" fill=\"#dbe6f7\" opacity=\"0.65\"></circle><circle cx=\"414.6\" cy=\"723.4\" r=\"0.7\" fill=\"#dbe6f7\" opacity=\"0.53\"></circle><circle cx=\"237.5\" cy=\"252.4\" r=\"1.6\" fill=\"#dbe6f7\" opacity=\"0.48\"></circle><circle class=\"lof-tw1\" cx=\"1385.3\" cy=\"57.3\" r=\"1.1\" fill=\"#dbe6f7\" opacity=\"0.44\"></circle><circle cx=\"504.3\" cy=\"366.5\" r=\"1.6\" fill=\"#dbe6f7\" opacity=\"0.29\"></circle><circle cx=\"134.8\" cy=\"199.2\" r=\"0.7\" fill=\"#dbe6f7\" opacity=\"0.28\"></circle><circle cx=\"1010.1\" cy=\"477.6\" r=\"1.6\" fill=\"#dbe6f7\" opacity=\"0.41\"></circle><circle cx=\"555.5\" cy=\"493.5\" r=\"0.6\" fill=\"#dbe6f7\" opacity=\"0.77\"></circle><circle class=\"lof-tw3\" cx=\"511.9\" cy=\"450.9\" r=\"1.6\" fill=\"#dbe6f7\" opacity=\"0.28\"></circle><circle cx=\"1106.3\" cy=\"95.5\" r=\"0.9\" fill=\"#dbe6f7\" opacity=\"0.47\"></circle><circle cx=\"1320.2\" cy=\"366.4\" r=\"0.8\" fill=\"#dbe6f7\" opacity=\"0.5\"></circle><circle cx=\"791.2\" cy=\"651.9\" r=\"1.3\" fill=\"#dbe6f7\" opacity=\"0.73\"></circle><circle cx=\"400.9\" cy=\"306.5\" r=\"1.1\" fill=\"#dbe6f7\" opacity=\"0.63\"></circle><circle class=\"lof-tw2\" cx=\"547.8\" cy=\"170.3\" r=\"0.7\" fill=\"#dbe6f7\" opacity=\"0.35\"></circle><circle cx=\"334.0\" cy=\"172.2\" r=\"1.6\" fill=\"#dbe6f7\" opacity=\"0.71\"></circle><circle cx=\"262.6\" cy=\"208.1\" r=\"0.8\" fill=\"#dbe6f7\" opacity=\"0.48\"></circle><circle cx=\"531.7\" cy=\"418.0\" r=\"0.8\" fill=\"#dbe6f7\" opacity=\"0.63\"></circle><circle cx=\"742.3\" cy=\"455.8\" r=\"0.6\" fill=\"#dbe6f7\" opacity=\"0.5\"></circle><circle class=\"lof-tw1\" cx=\"1254.2\" cy=\"702.5\" r=\"1.3\" fill=\"#dbe6f7\" opacity=\"0.47\"></circle><circle cx=\"567.5\" cy=\"355.4\" r=\"1.3\" fill=\"#dbe6f7\" opacity=\"0.28\"></circle><circle cx=\"97.0\" cy=\"154.1\" r=\"0.8\" fill=\"#dbe6f7\" opacity=\"0.31\"></circle><circle cx=\"865.0\" cy=\"75.6\" r=\"0.8\" fill=\"#dbe6f7\" opacity=\"0.55\"></circle><circle cx=\"1366.5\" cy=\"452.9\" r=\"0.7\" fill=\"#dbe6f7\" opacity=\"0.73\"></circle><circle class=\"lof-tw3\" cx=\"884.3\" cy=\"109.6\" r=\"1\" fill=\"#dbe6f7\" opacity=\"0.78\"></circle><circle cx=\"867.3\" cy=\"349.9\" r=\"0.7\" fill=\"#dbe6f7\" opacity=\"0.72\"></circle><circle cx=\"1430.1\" cy=\"343.9\" r=\"1.6\" fill=\"#dbe6f7\" opacity=\"0.42\"></circle><circle cx=\"207.5\" cy=\"553.3\" r=\"1\" fill=\"#dbe6f7\" opacity=\"0.51\"></circle><circle cx=\"996.6\" cy=\"381.1\" r=\"0.9\" fill=\"#dbe6f7\" opacity=\"0.77\"></circle><circle class=\"lof-tw2\" cx=\"760.7\" cy=\"108.2\" r=\"0.6\" fill=\"#dbe6f7\" opacity=\"0.67\"></circle><circle cx=\"429.2\" cy=\"474.5\" r=\"0.7\" fill=\"#dbe6f7\" opacity=\"0.63\"></circle><circle cx=\"376.0\" cy=\"270.6\" r=\"0.8\" fill=\"#dbe6f7\" opacity=\"0.45\"></circle><circle cx=\"320.8\" cy=\"399.7\" r=\"1.1\" fill=\"#dbe6f7\" opacity=\"0.6\"></circle><circle cx=\"883.0\" cy=\"581.8\" r=\"0.9\" fill=\"#dbe6f7\" opacity=\"0.69\"></circle><circle class=\"lof-tw1\" cx=\"1178.4\" cy=\"546.0\" r=\"0.9\" fill=\"#dbe6f7\" opacity=\"0.36\"></circle><circle cx=\"709.6\" cy=\"539.5\" r=\"0.6\" fill=\"#dbe6f7\" opacity=\"0.68\"></circle><circle cx=\"680.0\" cy=\"142.9\" r=\"1.1\" fill=\"#dbe6f7\" opacity=\"0.5\"></circle><circle cx=\"1349.3\" cy=\"729.2\" r=\"1.1\" fill=\"#dbe6f7\" opacity=\"0.29\"></circle><circle cx=\"147.1\" cy=\"346.9\" r=\"1.1\" fill=\"#dbe6f7\" opacity=\"0.36\"></circle><circle class=\"lof-tw3\" cx=\"898.7\" cy=\"664.4\" r=\"0.6\" fill=\"#dbe6f7\" opacity=\"0.51\"></circle><circle cx=\"940.3\" cy=\"590.1\" r=\"0.7\" fill=\"#dbe6f7\" opacity=\"0.71\"></circle><circle cx=\"172.7\" cy=\"286.7\" r=\"0.9\" fill=\"#dbe6f7\" opacity=\"0.51\"></circle><circle cx=\"257.1\" cy=\"582.4\" r=\"1.1\" fill=\"#dbe6f7\" opacity=\"0.3\"></circle><circle cx=\"1362.5\" cy=\"532.7\" r=\"1.6\" fill=\"#dbe6f7\" opacity=\"0.47\"></circle><circle class=\"lof-tw2\" cx=\"1363.4\" cy=\"534.9\" r=\"0.8\" fill=\"#dbe6f7\" opacity=\"0.8\"></circle><circle cx=\"39.7\" cy=\"436.0\" r=\"1.6\" fill=\"#dbe6f7\" opacity=\"0.69\"></circle><circle cx=\"210.5\" cy=\"610.0\" r=\"1.6\" fill=\"#dbe6f7\" opacity=\"0.61\"></circle><circle cx=\"504.6\" cy=\"404.9\" r=\"0.8\" fill=\"#dbe6f7\" opacity=\"0.26\"></circle><circle cx=\"1151.1\" cy=\"536.1\" r=\"0.7\" fill=\"#dbe6f7\" opacity=\"0.54\"></circle><circle class=\"lof-tw1\" cx=\"1344.4\" cy=\"320.2\" r=\"0.9\" fill=\"#dbe6f7\" opacity=\"0.7\"></circle><circle cx=\"303.9\" cy=\"185.9\" r=\"1\" fill=\"#dbe6f7\" opacity=\"0.53\"></circle><circle cx=\"1099.7\" cy=\"240.6\" r=\"1.3\" fill=\"#dbe6f7\" opacity=\"0.71\"></circle><circle cx=\"87.7\" cy=\"546.1\" r=\"1.6\" fill=\"#dbe6f7\" opacity=\"0.61\"></circle><circle cx=\"1173.7\" cy=\"381.4\" r=\"0.8\" fill=\"#dbe6f7\" opacity=\"0.54\"></circle><circle class=\"lof-tw3\" cx=\"753.8\" cy=\"13.8\" r=\"1.6\" fill=\"#dbe6f7\" opacity=\"0.68\"></circle><circle cx=\"876.3\" cy=\"572.7\" r=\"0.8\" fill=\"#dbe6f7\" opacity=\"0.34\"></circle><circle cx=\"681.8\" cy=\"535.2\" r=\"0.6\" fill=\"#dbe6f7\" opacity=\"0.43\"></circle><circle cx=\"746.4\" cy=\"409.9\" r=\"0.7\" fill=\"#dbe6f7\" opacity=\"0.74\"></circle><circle cx=\"81.8\" cy=\"141.2\" r=\"0.6\" fill=\"#dbe6f7\" opacity=\"0.67\"></circle><circle class=\"lof-tw2\" cx=\"731.1\" cy=\"414.6\" r=\"0.7\" fill=\"#dbe6f7\" opacity=\"0.49\"></circle><circle cx=\"882.0\" cy=\"373.1\" r=\"0.9\" fill=\"#dbe6f7\" opacity=\"0.63\"></circle><circle cx=\"651.4\" cy=\"393.6\" r=\"1.6\" fill=\"#dbe6f7\" opacity=\"0.53\"></circle><circle cx=\"356.6\" cy=\"386.1\" r=\"1\" fill=\"#dbe6f7\" opacity=\"0.76\"></circle><circle cx=\"1285.6\" cy=\"149.5\" r=\"1.6\" fill=\"#dbe6f7\" opacity=\"0.33\"></circle><circle class=\"lof-tw1\" cx=\"175.1\" cy=\"326.3\" r=\"0.7\" fill=\"#dbe6f7\" opacity=\"0.62\"></circle><circle cx=\"616.8\" cy=\"157.0\" r=\"1\" fill=\"#dbe6f7\" opacity=\"0.68\"></circle><circle cx=\"1291.7\" cy=\"114.0\" r=\"1.1\" fill=\"#dbe6f7\" opacity=\"0.33\"></circle><circle cx=\"1271.3\" cy=\"714.0\" r=\"0.9\" fill=\"#dbe6f7\" opacity=\"0.66\"></circle><circle cx=\"135.5\" cy=\"653.1\" r=\"0.8\" fill=\"#dbe6f7\" opacity=\"0.79\"></circle>";
  var LB_ROUTE = "<path d=\"M466.9 42.2 Q284 -18 100.6 76.2\" stroke=\"#2F3E62\" stroke-width=\"1.2\" stroke-dasharray=\"3 5\" fill=\"none\"></path>\n<path class=\"lof-trail1\" d=\"M466.9 42.2 Q284 -18 100.6 76.2\" stroke=\"#4A7BD6\" stroke-width=\"1.6\" fill=\"none\"></path>\n<path class=\"lof-comet1\" d=\"M466.9 42.2 Q284 -18 100.6 76.2\" stroke=\"#8EB1F2\" stroke-width=\"9\" stroke-linecap=\"round\" fill=\"none\" opacity=\"0\" stroke-opacity=\".3\"></path>\n<path class=\"lof-comet1\" d=\"M466.9 42.2 Q284 -18 100.6 76.2\" stroke=\"#ffffff\" stroke-width=\"3\" stroke-linecap=\"round\" fill=\"none\" opacity=\"0\"></path>\n<path d=\"M100.6 76.2 Q340 60 546.9 305.8\" stroke=\"#2F3E62\" stroke-width=\"1.2\" stroke-dasharray=\"3 5\" fill=\"none\"></path>\n<path class=\"lof-trail2\" d=\"M100.6 76.2 Q340 60 546.9 305.8\" stroke=\"#4A7BD6\" stroke-width=\"1.6\" fill=\"none\"></path>\n<path class=\"lof-comet2\" d=\"M100.6 76.2 Q340 60 546.9 305.8\" stroke=\"#8EB1F2\" stroke-width=\"9\" stroke-linecap=\"round\" fill=\"none\" opacity=\"0\" stroke-opacity=\".3\"></path>\n<path class=\"lof-comet2\" d=\"M100.6 76.2 Q340 60 546.9 305.8\" stroke=\"#ffffff\" stroke-width=\"3\" stroke-linecap=\"round\" fill=\"none\" opacity=\"0\"></path>\n<path d=\"M546.9 305.8 Q540 350 487.8 343.7\" stroke=\"#2F3E62\" stroke-width=\"1.2\" stroke-dasharray=\"3 5\" fill=\"none\"></path>\n<path class=\"lof-trail3\" d=\"M546.9 305.8 Q540 350 487.8 343.7\" stroke=\"#4A7BD6\" stroke-width=\"1.6\" fill=\"none\"></path>\n<path class=\"lof-comet3\" d=\"M546.9 305.8 Q540 350 487.8 343.7\" stroke=\"#8EB1F2\" stroke-width=\"9\" stroke-linecap=\"round\" fill=\"none\" opacity=\"0\" stroke-opacity=\".3\"></path>\n<path class=\"lof-comet3\" d=\"M546.9 305.8 Q540 350 487.8 343.7\" stroke=\"#ffffff\" stroke-width=\"3\" stroke-linecap=\"round\" fill=\"none\" opacity=\"0\"></path>\n<path d=\"M487.8 343.7 Q405 290 415 194.2\" stroke=\"#2F3E62\" stroke-width=\"1.2\" stroke-dasharray=\"3 5\" fill=\"none\"></path>\n<path class=\"lof-trail4\" d=\"M487.8 343.7 Q405 290 415 194.2\" stroke=\"#4A7BD6\" stroke-width=\"1.6\" fill=\"none\"></path>\n<path class=\"lof-comet4\" d=\"M487.8 343.7 Q405 290 415 194.2\" stroke=\"#8EB1F2\" stroke-width=\"9\" stroke-linecap=\"round\" fill=\"none\" opacity=\"0\" stroke-opacity=\".3\"></path>\n<path class=\"lof-comet4\" d=\"M487.8 343.7 Q405 290 415 194.2\" stroke=\"#ffffff\" stroke-width=\"3\" stroke-linecap=\"round\" fill=\"none\" opacity=\"0\"></path>\n<circle class=\"lof-ping-jaipur\" cx=\"466.9\" cy=\"42.2\" r=\"10\" stroke=\"#8EB1F2\" stroke-width=\"2\" fill=\"none\" opacity=\"0\"></circle>\n<g class=\"lof-on-jaipur\"><circle cx=\"466.9\" cy=\"42.2\" r=\"13\" fill=\"#1D4087\" opacity=\".28\"></circle><circle cx=\"466.9\" cy=\"42.2\" r=\"6\" fill=\"#ffffff\"></circle><circle cx=\"466.9\" cy=\"42.2\" r=\"2.5\" fill=\"#1D4087\"></circle><text x=\"482.9\" y=\"38\" text-anchor=\"start\" fill=\"#ffffff\" font-family=\"Inter,system-ui,sans-serif\" font-size=\"13\" font-weight=\"600\">Jaipur</text><text x=\"482.9\" y=\"52\" text-anchor=\"start\" fill=\"#8EB1F2\" font-family=\"Inter,system-ui,sans-serif\" font-size=\"9.5\" font-weight=\"500\">Where it began</text></g>\n<circle class=\"lof-ping-dubai\" cx=\"100.6\" cy=\"76.2\" r=\"10\" stroke=\"#8EB1F2\" stroke-width=\"2\" fill=\"none\" opacity=\"0\"></circle>\n<g class=\"lof-on-dubai\"><circle cx=\"100.6\" cy=\"76.2\" r=\"13\" fill=\"#1D4087\" opacity=\".28\"></circle><circle cx=\"100.6\" cy=\"76.2\" r=\"6\" fill=\"#ffffff\"></circle><circle cx=\"100.6\" cy=\"76.2\" r=\"2.5\" fill=\"#1D4087\"></circle><text x=\"116.6\" y=\"92\" text-anchor=\"start\" fill=\"#ffffff\" font-family=\"Inter,system-ui,sans-serif\" font-size=\"13\" font-weight=\"600\">Dubai</text><text x=\"116.6\" y=\"106\" text-anchor=\"start\" fill=\"#8EB1F2\" font-family=\"Inter,system-ui,sans-serif\" font-size=\"9.5\" font-weight=\"500\">Well established</text></g>\n<circle class=\"lof-ping-mumbai\" cx=\"415\" cy=\"194.2\" r=\"10\" stroke=\"#8EB1F2\" stroke-width=\"2\" fill=\"none\" opacity=\"0\"></circle>\n<g class=\"lof-on-mumbai\"><circle cx=\"415\" cy=\"194.2\" r=\"13\" fill=\"#1D4087\" opacity=\".28\"></circle><circle cx=\"415\" cy=\"194.2\" r=\"6\" fill=\"#ffffff\"></circle><circle cx=\"415\" cy=\"194.2\" r=\"2.5\" fill=\"#1D4087\"></circle><text x=\"431\" y=\"192\" text-anchor=\"start\" fill=\"#ffffff\" font-family=\"Inter,system-ui,sans-serif\" font-size=\"13\" font-weight=\"600\">Mumbai</text><text x=\"431\" y=\"206\" text-anchor=\"start\" fill=\"#8EB1F2\" font-family=\"Inter,system-ui,sans-serif\" font-size=\"9.5\" font-weight=\"500\">Newest centre</text></g>\n<circle class=\"lof-ping-chennai\" cx=\"546.9\" cy=\"305.8\" r=\"10\" stroke=\"#8EB1F2\" stroke-width=\"2\" fill=\"none\" opacity=\"0\"></circle>\n<g class=\"lof-on-chennai\"><circle cx=\"546.9\" cy=\"305.8\" r=\"13\" fill=\"#1D4087\" opacity=\".28\"></circle><circle cx=\"546.9\" cy=\"305.8\" r=\"6\" fill=\"#ffffff\"></circle><circle cx=\"546.9\" cy=\"305.8\" r=\"2.5\" fill=\"#1D4087\"></circle><text x=\"562.9\" y=\"310.8\" text-anchor=\"start\" fill=\"#ffffff\" font-family=\"Inter,system-ui,sans-serif\" font-size=\"13\" font-weight=\"600\">Chennai</text></g>\n<circle class=\"lof-ping-coimbatore\" cx=\"487.8\" cy=\"343.7\" r=\"10\" stroke=\"#8EB1F2\" stroke-width=\"2\" fill=\"none\" opacity=\"0\"></circle>\n<g class=\"lof-on-coimbatore\"><circle cx=\"487.8\" cy=\"343.7\" r=\"13\" fill=\"#1D4087\" opacity=\".28\"></circle><circle cx=\"487.8\" cy=\"343.7\" r=\"6\" fill=\"#ffffff\"></circle><circle cx=\"487.8\" cy=\"343.7\" r=\"2.5\" fill=\"#1D4087\"></circle><text x=\"471.8\" y=\"348.7\" text-anchor=\"end\" fill=\"#ffffff\" font-family=\"Inter,system-ui,sans-serif\" font-size=\"13\" font-weight=\"600\">Coimbatore</text></g>";
  function lbBrand() {
    return '<div class="lb-brand"><span class="lb-logo-tile"><img class="lb-logo" src="/login-logo.png" alt="Lab of Future, Be Curious" width="480" height="135"></span>' +
      '<span class="lb-brand-sep" aria-hidden="true"></span><span class="lb-brand-sub">CRM &amp; Sales</span></div>';
  }
  function lbScene() {
    return '<svg class="lb-stars" aria-hidden="true" focusable="false" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">' + LB_STARS + '</svg>' +
      '<div class="lb-meteor lof-meteor" aria-hidden="true"></div>' +
      '<div class="lb-planet" aria-hidden="true"></div>' +
      '<svg class="lb-orbits" aria-hidden="true" focusable="false" width="1200" height="1200" viewBox="0 0 1200 1200" fill="none">' +
        '<circle cx="600" cy="600" r="330" stroke="#22304E" stroke-width="1.2"/><circle cx="600" cy="600" r="450" stroke="#22304E" stroke-width="1.2" stroke-dasharray="2 8"/>' +
        '<g class="lof-orbit"><g transform="translate(930 600) rotate(90)"><circle r="16" fill="#8EB1F2" opacity=".12"/>' +
          '<rect x="-5" y="-7" width="10" height="14" rx="2" fill="#dbe6f7"/><rect x="-21" y="-4.5" width="13" height="9" rx="1" fill="#1D4087" stroke="#4A7BD6" stroke-width="1"/>' +
          '<rect x="8" y="-4.5" width="13" height="9" rx="1" fill="#1D4087" stroke="#4A7BD6" stroke-width="1"/><path d="M-8 0H-5M5 0H8M0 -7V-12" stroke="#dbe6f7" stroke-width="1.2"/>' +
          '<circle class="lof-blink" cx="0" cy="-13" r="2" fill="#D53A28"/></g></g>' +
        '<g class="lof-orbit2"><circle cx="600" cy="150" r="3.5" fill="#dbe6f7"/><circle cx="600" cy="150" r="9" fill="#8EB1F2" opacity=".15"/></g></svg>' +
      '<svg class="lb-sat-m" aria-hidden="true" focusable="false" width="390" height="200" viewBox="0 0 390 200"><g class="lof-sat"><g transform="translate(0 92) rotate(-8)">' +
        '<circle r="11" fill="#8EB1F2" opacity=".12"/><rect x="-3.5" y="-5" width="7" height="10" rx="1.5" fill="#dbe6f7"/>' +
        '<rect x="-15" y="-3" width="9" height="6" rx="1" fill="#1D4087" stroke="#4A7BD6" stroke-width=".8"/><rect x="6" y="-3" width="9" height="6" rx="1" fill="#1D4087" stroke="#4A7BD6" stroke-width=".8"/>' +
        '<circle class="lof-blink" cx="0" cy="-8" r="1.6" fill="#D53A28"/></g></g></svg>';
  }
  function lbContext() {
    var steps = ['Enquiry', 'First call', 'Counselling', 'Opportunity', 'Enrolled'];
    return '<section class="lb-ctx" aria-label="About LOF CRM"><div class="lb-map">' +
      '<img class="lof-fade lof-d1" src="/login-map.svg" alt="" width="620" height="380">' +
      '<svg class="lof-route lof-fade lof-d2" role="img" aria-label="Lab of Future\'s growth: started in Jaipur, then Dubai, Chennai, Coimbatore and now Mumbai" viewBox="0 0 620 380" fill="none">' + LB_ROUTE + '</svg>' +
      '<div class="lb-hero lof-rise lof-d2"><h2>Every enquiry, from first call to <span>first class.</span></h2>' +
      '<div class="lb-journey lof-rise lof-d4"><div class="lb-j-line"><span class="lof-flow" aria-hidden="true"></span></div><ol>' +
      steps.map(function (s, i) { return '<li' + (i === steps.length - 1 ? ' class="last"' : '') + '><span class="lb-j-dot' + (i === steps.length - 1 ? ' lof-arrive' : '') + '"></span><span class="lb-j-label">' + s + '</span></li>'; }).join('') +
      '</ol></div></div></div></section>';
  }
  function lbStyles() {
    if (document.getElementById('lbStyle')) return;
    var l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(l);
    var st = document.createElement('style'); st.id = 'lbStyle';
    var F = 'Inter,system-ui,-apple-system,"Segoe UI",sans-serif';
    st.textContent = [
      '.lb-shell{position:relative;min-height:100vh;min-height:100dvh;width:100%;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;font-family:' + F + ';color:#B6C1D8;color-scheme:light;' +
        'background:radial-gradient(620px 540px at 19% 56%,rgba(42,91,176,.5),rgba(42,91,176,0) 70%),radial-gradient(980px 760px at 70% 46%,rgba(29,64,135,.26),rgba(29,64,135,0) 70%),#0A1120}',
      '.lb-shell :focus-visible{outline:2px solid #4A7BD6;outline-offset:2px}',
      '.lb-stars{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}',
      '.lb-meteor{position:absolute;left:1180px;top:70px;width:140px;height:2px;border-radius:2px;background:linear-gradient(90deg,#fff,rgba(142,177,242,0));opacity:0;pointer-events:none}',
      '.lb-planet{position:absolute;left:50%;top:calc(100% - 150px);width:3200px;height:3200px;margin-left:-1600px;border-radius:50%;pointer-events:none;' +
        'background:radial-gradient(circle at 50% 0%,#1A3F80 0%,#0F2550 6%,#0A1120 18%);box-shadow:0 -1px 0 rgba(190,210,248,.55),0 -10px 30px rgba(142,177,242,.28),0 -40px 120px rgba(74,123,214,.22)}',
      '.lb-orbits{position:absolute;left:-300px;top:-128px;pointer-events:none}.lb-sat-m{display:none}',
      // header
      '.lb-top{position:relative;display:flex;justify-content:space-between;align-items:center;gap:16px;padding:28px 80px}',
      '.lb-brand{display:flex;align-items:center;gap:12px}',
      '.lb-logo-tile{background:#fff;border-radius:12px;padding:7px 12px;display:flex;align-items:center;box-shadow:0 8px 24px rgba(3,8,20,.45)}.lb-logo{height:38px;width:auto;display:block}',
      '.lb-brand-sep{width:1px;height:28px;background:#2F3E62}.lb-brand-sub{font-size:14px;font-weight:600;color:#fff;letter-spacing:.01em;white-space:nowrap}',
      '.lb-help{font:14px ' + F + ';color:#B6C1D8;padding:10px 16px;border:1px solid #2F3E62;border-radius:10px;background:rgba(255,255,255,.03);cursor:pointer}.lb-help:hover{color:#fff}',
      // main: the card on the left, the map on the right
      '.lb-main{position:relative;flex:1;display:flex;flex-wrap:wrap;align-items:center;gap:40px 48px;padding:0 56px 24px 80px}',
      '.lb-left{flex:0 1 440px;min-width:0;display:flex;flex-direction:column;gap:18px}',
      '.lb-frost{padding:1.5px;border-radius:22px;box-shadow:0 30px 80px rgba(3,8,20,.55),0 0 70px rgba(74,123,214,.22)}',
      '.lb-card{margin:0;background:#fff;border-radius:20.5px;padding:40px;display:flex;flex-direction:column;gap:22px;color:#0F1B33;font-family:' + F + '}',
      '.lb-head{display:flex;flex-direction:column;gap:8px}',
      '.lb-eyebrow{font:600 11px ' + F + ';letter-spacing:.12em;text-transform:uppercase;color:#1D4087}',
      '.lb-h1{margin:0;font-size:32px;line-height:1.15;font-weight:600;color:#0F2550}',
      '.lb-sub{margin:0;font-size:15px;line-height:1.5;color:#66708A}',
      '.lb-fields{display:flex;flex-direction:column;gap:16px}',
      '.lb-f,.lb-card .f{display:flex;flex-direction:column;gap:6px}',
      '.lb-f label,.lb-card .f label{font-size:13px;font-weight:500;color:#0F1B33}',
      '.lb-labrow{display:flex;justify-content:space-between;align-items:baseline;gap:12px}',
      '.lb-in,.lb-card .f input{width:100%;box-sizing:border-box;height:48px;border:1px solid #CFD7E4;border-radius:10px;padding:0 14px;font:15px ' + F + ';color:#0F1B33;background:#fff;transition:border-color .2s,box-shadow .2s}',
      '.lb-in:hover,.lb-card .f input:hover{border-color:#A0A8BA}',
      '.lb-in:focus,.lb-card .f input:focus{border-color:#1D4087;box-shadow:0 0 0 4px rgba(29,64,135,.15);outline:none}',
      '.lb-card .f input[readonly]{background:#F5F7FB}',
      '.lb-pw{position:relative}.lb-pw .lb-in{padding-right:76px}',
      '.lb-eye{position:absolute;right:6px;top:7px;height:34px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:#1D4087;font:500 13px ' + F + ';cursor:pointer}',
      '.lb-check{display:flex;align-items:center;gap:10px;font-size:14px;color:#0F1B33;cursor:pointer}.lb-check input{width:18px;height:18px;margin:0;accent-color:#1D4087}',
      '.lb-btn{height:50px;width:100%;border:0;border-radius:10px;background:#1D4087;color:#fff;font:600 15px ' + F + ';cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;transition:transform .15s,box-shadow .2s,filter .2s}',
      '.lb-btn svg{width:18px;height:18px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}',
      '.lb-btn:hover{filter:brightness(1.08);box-shadow:0 10px 24px rgba(29,64,135,.45);transform:translateY(-1px)}.lb-btn:disabled{opacity:.65;cursor:progress;transform:none}',
      '.lb-link{color:#1D4087;text-decoration:none;font-weight:500;font-size:13px;cursor:pointer}.lb-link:hover{text-decoration:underline}',
      '.lb-msg{padding:12px 14px;border-radius:10px;background:#EEF3FB;color:#0F2550;font-size:13px;line-height:1.5}',
      '.lb-err{font-size:13.5px;line-height:1.45;color:#b42318}.lb-err:empty{display:none}',
      '.lb-info{font-size:13px;color:#66708A}.lb-info:empty{display:none}',
      '.lb-foot{font-size:13px;color:#66708A}.lb-foot a{color:#1D4087!important}',
      '.lb-card .help{font-size:12.5px;color:#66708A}.lb-card .banner{margin:0}',
      '.lb-access{margin:0;padding:0 6px;font-size:13px;color:#8592AD}',
      '.lb-helpbox{margin:0;padding:12px 14px;border-radius:12px;border:1px solid #2F3E62;background:rgba(255,255,255,.04);font-size:13px;line-height:1.5;color:#B6C1D8}.lb-helpbox b{color:#fff}.lb-helpbox[hidden]{display:none}',
      // right: map, route, headline and journey
      '.lb-ctx{flex:1 1 560px;min-width:0;display:flex;justify-content:center}',
      '.lb-map{position:relative;width:100%;max-width:900px;aspect-ratio:620/380}',
      '.lb-map img{position:absolute;inset:0;width:100%;height:100%;display:block;-webkit-mask-image:radial-gradient(ellipse 72% 72% at 55% 45%,#000 45%,rgba(0,0,0,0) 100%);mask-image:radial-gradient(ellipse 72% 72% at 55% 45%,#000 45%,rgba(0,0,0,0) 100%)}',
      '.lof-route{position:absolute;inset:0;width:100%;height:100%;overflow:visible}',
      '.lb-hero{position:absolute;left:8%;top:44%;width:50%;display:flex;flex-direction:column;gap:22px}',
      '.lb-hero h2{margin:0;font-size:clamp(28px,3vw,46px);line-height:1.06;font-weight:600;color:#fff;letter-spacing:-.015em}.lb-hero h2 span{color:#EE5A46}',
      '.lb-journey{position:relative;max-width:460px}',
      '.lb-j-line{position:absolute;left:6px;right:6px;top:5px;height:2px;background:#2F3E62;border-radius:2px}',
      '.lb-j-line .lof-flow{position:absolute;top:-4px;width:46px;height:10px;border-radius:10px;background:radial-gradient(closest-side,#fff,rgba(142,177,242,.7) 45%,rgba(142,177,242,0))}',
      '.lb-journey ol{position:relative;list-style:none;margin:0;padding:0;display:flex;justify-content:space-between}',
      '.lb-journey li{display:flex;flex-direction:column;align-items:center;gap:10px}.lb-journey li:first-child{align-items:flex-start}.lb-journey li.last{align-items:flex-end}',
      '.lb-j-dot{width:12px;height:12px;border-radius:50%;background:#4A7BD6;box-shadow:0 0 0 4px #0F1A33}.lb-journey li.last .lb-j-dot{background:#D53A28}',
      '.lb-j-label{font-size:13px;font-weight:500;color:#B6C1D8}.lb-journey li.last .lb-j-label{font-weight:600;color:#fff}',
      // footer: the roles
      '.lb-page-foot{position:relative;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px 24px;padding:18px 80px;border-top:1px solid rgba(133,146,173,.16);background:rgba(6,12,24,.45)}',
      '.lb-roles{display:flex;flex-wrap:wrap;align-items:center;gap:8px}',
      '.lb-roles-t{font:600 11px ' + F + ';letter-spacing:.1em;text-transform:uppercase;color:#8592AD;margin-right:6px}',
      '.lb-role{font-size:13px;color:#B6C1D8;padding:5px 12px;border:1px solid rgba(133,146,173,.25);border-radius:999px;background:rgba(255,255,255,.03)}',
      '.lb-copy{font-size:13px;color:#8592AD}',
      LB_ANIM,
      '@keyframes lof-sat{0%{transform:translate(-40px,0)}100%{transform:translate(430px,-60px)}}.lof-sat{animation:lof-sat 26s linear infinite}',
      '@media (prefers-reduced-motion:reduce){.lof-sat{animation:none!important}}',
      '@media (max-width:1180px){.lb-top{padding:24px 40px}.lb-main{padding:0 32px 24px 40px}.lb-page-foot{padding:16px 40px}}',
      // phones and narrow windows: header, a smaller map, then the card
      '@media (max-width:900px){' +
        '.lb-shell{gap:12px;padding:18px 16px;background:radial-gradient(420px 460px at 50% 70%,rgba(42,91,176,.5),rgba(42,91,176,0) 70%),radial-gradient(420px 300px at 50% 22%,rgba(29,64,135,.28),rgba(29,64,135,0) 70%),#0A1120}' +
        '.lb-orbits,.lb-meteor,.lb-hero,.lb-page-foot,.lb-brand-sep{display:none}' +
        '.lb-sat-m{display:block;position:absolute;left:0;top:0;pointer-events:none}' +
        '.lb-planet{top:auto;bottom:-1346px;width:1400px;height:1400px;margin-left:-700px;background:radial-gradient(circle at 50% 0%,#1A3F80 0%,#0F2550 8%,#0A1120 22%);box-shadow:0 -1px 0 rgba(190,210,248,.55),0 -10px 30px rgba(142,177,242,.28),0 -30px 80px rgba(74,123,214,.22)}' +
        '.lb-top{padding:0 4px}.lb-brand{gap:10px}.lb-logo-tile{border-radius:10px;padding:6px 10px}.lb-logo{height:30px}.lb-brand-sub{font-size:13px}' +
        '.lb-help{min-height:44px;padding:0 12px}' +
        '.lb-main{flex:none;flex-direction:column;flex-wrap:nowrap;align-items:stretch;gap:12px;padding:0}' +
        '.lb-ctx{order:-1;flex:none}.lb-map{width:340px;max-width:100%}' +
        '.lb-left{flex:none;gap:12px}.lb-frost{border-radius:20px;box-shadow:0 24px 60px rgba(3,8,20,.55),0 0 60px rgba(74,123,214,.22)}' +
        '.lb-card{border-radius:18.5px;padding:22px;gap:16px}.lb-head{gap:4px}.lb-eyebrow{font-size:10px}.lb-h1{font-size:24px;line-height:1.2}.lb-sub{display:none}' +
        '.lb-fields{gap:14px}.lb-in,.lb-card .f input{font-size:16px}.lb-eye{right:4px;top:2px;height:44px;padding:0 12px;font-size:14px}' +
        '.lb-check input{width:20px;height:20px}.lb-btn{font-size:16px}' +
        '.lb-access{text-align:center;line-height:1.5}' +
      '}',
    ].join('\n');
    document.head.appendChild(st);
  }
  function authShell(cardHtml) {
    lbStyles();
    // the sign-in screens keep their own colours; the CRM applies the user's own theme again after sign-in
    document.documentElement.removeAttribute('data-theme');
    var roles = ['Counsellor', 'Reception', 'Admissions Head', 'Centre Administrator', 'Management'];
    document.getElementById('app').innerHTML =
      '<div class="lb-shell" id="lbRoot">' + lbScene() +
      '<header class="lb-top lof-fade">' + lbBrand() +
      '<button type="button" class="lb-help" id="lbHelp" aria-expanded="false" aria-controls="lbHelpBox"><span class="lb-help-l">Need help?</span></button></header>' +
      '<main class="lb-main"><div class="lb-left">' +
      '<div class="lb-frost lof-beam lof-rise lof-d1">' + cardHtml + '</div>' +
      '<p class="lb-helpbox" id="lbHelpBox" hidden>Forgot your password? Use <b>Forgot password?</b> on the sign-in form to get a 6-digit reset code. ' +
      'For a new account, a locked account or a lost authenticator, ask your Centre Administrator.</p>' +
      '<p class="lb-access lof-rise lof-d3">No access yet? Ask your Centre Administrator.</p></div>' +
      lbContext() + '</main>' +
      '<footer class="lb-page-foot lof-fade lof-d3"><div class="lb-roles"><span class="lb-roles-t">Built for every desk</span>' +
      roles.map(function (r) { return '<span class="lb-role">' + r + '</span>'; }).join('') + '</div>' +
      '<span class="lb-copy">© ' + new Date().getFullYear() + ' Lab of Future · Top Rock Global Pvt Ltd</span></footer>' +
      '</div>';
    var hb = document.getElementById('lbHelp');
    if (window.matchMedia && window.matchMedia('(max-width:900px)').matches) hb.querySelector('.lb-help-l').textContent = 'Help';
    hb.addEventListener('click', function () {
      var box = document.getElementById('lbHelpBox'), open = box.hidden;
      box.hidden = !open;
      hb.setAttribute('aria-expanded', String(open));
    });
  }
  var LB_ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>';
  function authCard(sub, msg, inner, btn, foot) {
    authShell('<form id="lofAuth" class="lb-card" novalidate>' +
      '<div class="lb-head"><span class="lb-eyebrow">LOF CRM · Staff sign in</span><h1 class="lb-h1">' + esc(sub) + '</h1></div>' +
      (msg ? '<div class="lb-msg" role="status">' + esc(msg) + '</div>' : '') + '<div class="lb-fields">' + inner + '</div>' +
      '<div class="lb-err" id="lofErr" role="alert"></div>' +
      '<button class="lb-btn" type="submit">' + esc(btn) + '</button>' +
      (foot ? '<div class="lb-foot">' + foot + '</div>' : '') +
      '</form>');
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
    var f;
    if (needCode) {
      f = authCard('Two-step verification', msg || 'Enter the 6-digit code from your authenticator app.',
        '<input type="hidden" name="email" value="' + esc(remembered.email) + '"><input type="hidden" name="password" value="' + esc(remembered.password) + '">' +
        '<div class="f"><label for="lc">Verification code</label><input id="lc" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="123456" required></div>',
        'Verify and Sign In', '');
    } else {
      // Remember Me keeps only the e-mail address on this device – never the password
      var saved = LS.get('lof_login_email') || '';
      authShell('<form id="lofAuth" class="lb-card" novalidate>' +
        '<div class="lb-head"><span class="lb-eyebrow">LOF CRM · Staff sign in</span><h1 class="lb-h1">Welcome back</h1><p class="lb-sub">Pick up your leads, admissions and payments where you left them.</p></div>' +
        (msg ? '<div class="lb-msg" role="status">' + esc(msg) + '</div>' : '') +
        '<div class="lb-fields">' +
        '<div class="lb-f"><label for="le">Work email</label>' +
        '<input class="lb-in" id="le" name="email" type="email" autocomplete="username" placeholder="name@laboffuture.com" required value="' + esc(saved) + '"></div>' +
        '<div class="lb-f"><div class="lb-labrow"><label for="lp">Password</label><a href="#" class="lb-link" id="linkForgotPw">Forgot password?</a></div>' +
        '<div class="lb-pw"><input class="lb-in" id="lp" name="password" type="password" autocomplete="current-password" placeholder="Enter your password" required>' +
        '<button type="button" class="lb-eye" id="lbEye" aria-label="Show password" aria-pressed="false">Show</button></div></div>' +
        '<label class="lb-check"><input type="checkbox" name="remember" id="lbRemember"' + (saved ? ' checked' : '') + '>Remember my e-mail on this device</label>' +
        '</div>' +
        '<div class="lb-err" id="lofErr" role="alert"></div>' +
        '<button class="lb-btn" type="submit">Sign in' + LB_ARROW + '</button>' +
        '</form>');
      f = document.getElementById('lofAuth');
      (saved ? document.getElementById('lp') : document.getElementById('le')).focus();
      document.getElementById('lbEye').addEventListener('click', function () {
        var pw = document.getElementById('lp'), show = pw.type === 'password';
        pw.type = show ? 'text' : 'password';
        this.textContent = show ? 'Hide' : 'Show';
        this.setAttribute('aria-pressed', String(show));
        this.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      });
      document.getElementById('linkForgotPw').addEventListener('click', function (e) {
        e.preventDefault();
        forgotPasswordScreen('', document.getElementById('le').value.trim());
      });
    }

    onSubmit(f, function (d) {
      return req('POST', '/auth/login', { email: d.email, password: d.password, code: d.code }).then(function (r) {
        if (!needCode) LS.set('lof_login_email', d.remember ? String(d.email || '').trim() : null);
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
  ACT.theme = function () {
    // smooth crossfade between light and dark (skipped when the user prefers reduced motion)
    var root = document.documentElement;
    if (!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      root.classList.add('theme-switching'); clearTimeout(ACT.theme.t); ACT.theme.t = setTimeout(function () { root.classList.remove('theme-switching'); }, 420);
    }
    _theme(); LS.set('lof_theme', S.theme);
    toast((S.theme === 'dark' ? 'Dark' : 'Light') + ' theme on', 'ok');
  };
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
      body: '<p class="sm">' + money(l.amount, l.currency) + ' via <b>' + (l.provider === 'telr' ? 'Telr' : 'Razorpay') + '</b>' + (l.mode === 'mock' ? ' <span class="sim">Mock</span>' : '') + '. ' + (l.opp ? 'When the parent pays, <b>' + esc(l.student || '') + '</b> is enrolled automatically and the payment is recorded with a receipt.' : 'The payment is recorded automatically when the parent pays.') + ' The link works for <b>24 hours</b>: after that the parent sees “Payment link expired”, and once paid it shows “Payment already done”.</p><div class="f"><label for="plurl">Link</label><input id="plurl" readonly value="' + esc(l.url) + '"></div>',
      foot: '<button class="btn" data-act="closeModal">Close</button><button class="btn" data-act="copy" data-v="' + esc(l.url) + '">Copy link</button><button class="btn" data-act="plSend" data-id="' + esc(l.id) + '" data-ch="Email">Send by e-mail</button><button class="btn primary" data-act="plSend" data-id="' + esc(l.id) + '" data-ch="WhatsApp">Send on WhatsApp</button>',
    };
  };
  ACT.plSend = function (d) {
    req('POST', '/payments/links/' + encodeURIComponent(d.id) + '/send', { channel: d.ch }).then(function () { closeModal(); toast('Payment link sent by ' + d.ch, 'ok'); }).catch(function (e) { toast(e.message, 'err'); });
  };
  // ---------------- Payment link from an opportunity (Opportunity 30% / Admission Decision 70%)
  // The counsellor fills in the enrolment form (student, programme, fee, payment term) and, instead of enrolling,
  // creates a payment link. The server checks the form now and enrols the student automatically when the parent pays.
  function canShareLink() { return can('enrollments', 'C') || can('opportunities', 'E') || can('payments', 'C'); }
  var LINK_ST = {
    created: ['Awaiting payment', 'warn'], paid: ['Paid – enrolled', 'ok'], replaced: ['Replaced by a newer link', ''],
    expired: ['Expired', ''], cancelled: ['Cancelled', ''], failed: ['Failed', 'crit'],
  };
  function linkWhen(t) { return String(t || '').replace('T', ' ').slice(0, 16); }
  function oppLinksCard(o) {
    S.oppLinks = S.oppLinks || {};
    var L = S.oppLinks[o.id];
    if (L === undefined) {
      S.oppLinks[o.id] = null;
      req('GET', '/opps/' + encodeURIComponent(o.id) + '/payment-links').then(function (r) { S.oppLinks[o.id] = r.items || []; safeRender(); }).catch(function () { S.oppLinks[o.id] = []; });
      return '';
    }
    if (!L || !L.length) return '';
    var rows = L.map(function (l) {
      var st = l.status === 'paid' && l.apply_error ? ['Paid – enrol by hand', 'crit'] : (LINK_ST[l.status] || [l.status, '']);
      var act = l.status === 'created' && canShareLink()
        ? '<button class="btn sm" data-act="copy" data-v="' + esc(l.url) + '">Copy</button> <button class="btn sm" data-act="plSend" data-id="' + esc(l.id) + '" data-ch="WhatsApp">WhatsApp</button> <button class="btn sm" data-act="plSend" data-id="' + esc(l.id) + '" data-ch="Email">E-mail</button>'
        : l.status === 'paid' && !l.apply_error ? '<span class="mono xs">' + esc(l.enrollment_id) + '</span>' : '';
      if (l.status === 'created' && l.expires_at) st = [st[0] + ' · until ' + new Date(l.expires_at).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }), st[1]];
      return { l: l, st: st, act: act };
    });
    var cols = [
      { h: 'Link', f: function (r) { return '<span class="mono">' + esc(r.l.id) + '</span>'; } },
      { h: 'Amount', r: 1, f: function (r) { return money(r.l.amount, r.l.currency); } },
      { h: 'Status', f: function (r) { return bdg(r.st[0], r.st[1]) + (r.l.apply_error ? '<div class="muted xs">' + esc(r.l.apply_error) + '</div>' : ''); } },
      { h: 'Shared', f: function (r) { return esc(r.l.created_by || '') + '<div class="muted xs">' + esc(linkWhen(r.l.created_at)) + '</div>'; } },
      { h: '', f: function (r) { return r.act; } },
    ];
    return '<div style="height:14px"></div>' + card('Payment links', table('oppLinks', cols, rows, { all: 1 }) + '<p class="muted xs" style="padding:0 14px 12px">When the parent pays, the student is enrolled with the details filled in when the link was shared, and the receipt follows automatically.</p>', { np: 1 });
  }
  var _oppPage = PAGES.opp;
  PAGES.opp = function (rt) {
    var h = _oppPage(rt);
    var o = typeof oppById === 'function' ? oppById(rt.id) : null;
    if (!o || !inScope(o.branch)) return h;
    if (!['Enrolled', 'Lost'].includes(o.stage) && canShareLink()) {
      var btn = '<button class="btn primary" data-act="oppPayLink" data-id="' + esc(o.id) + '">' + ic('link') + ' Share payment link</button>';
      h = h.replace('<div class="row" style="margin-bottom:14px">', '<div class="row" style="margin-bottom:14px">' + btn);
      h = h.replace('<button class="btn primary" data-act="enrollOpp"', '<button class="btn" data-act="enrollOpp"');
    }
    return h + oppLinksCard(o);
  };
  ACT.oppPayLink = function (d) {
    S.pendingViaLink = true;
    try { ACT.enrollOpp(d); } finally { S.pendingViaLink = false; }
    if (S.wiz) { S.wiz.viaLink = true; render(); }
  };
  var _wizMode = ACT.wizMode;
  ACT.wizMode = function (d) { var via = S.wiz && S.wiz.viaLink; _wizMode(d); if (via && S.wiz) { S.wiz.viaLink = true; render(); } };
  var _wizCancel = ACT.wizCancel;
  ACT.wizCancel = function () { var w = S.wiz; if (w && w.viaLink && w.opp) { S.wiz = null; S.wizQ = ''; go('opp', { id: w.opp }); return; } _wizCancel(); };
  var _wizPage = PAGES.wizard;
  PAGES.wizard = function (rt) {
    var h = _wizPage(rt), w = S.wiz;
    if (!w || !w.viaLink) return h;
    h = h.replace('3. Payment &amp; confirm', '3. Payment link').replace('3. Payment & confirm', '3. Payment link');
    var o = w.opp && oppById(w.opp);
    h = h.replace('<div class="step">', '<div class="banner" style="margin-bottom:12px">' + ic('link') + '<span>Payment link for <b>' + esc(o ? o.student : '') + '</b>: fill in the enrolment details the parent would give at the counter. Nothing is enrolled yet – the student is enrolled automatically as soon as the parent pays through the link.</span></div><div class="step">');
    if (w.step === 3 && w.fee) {
      var c = calcFee(w.fee, w.disc, w.mode === 'new'), sch = buildSched(termById(w.term), c.total, TODAY), cur = w.fee.cur;
      var plan = w.linkPlan || (sch.length > 1 ? 'first' : 'full');
      var opt = function (v, label, sub) {
        return '<label style="display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--line);border-radius:8px;cursor:pointer;margin-bottom:8px"><input type="radio" name="plan" value="' + v + '" data-change="wizPlan"' + (plan === v ? ' checked' : '') + ' style="margin-top:3px"><span><b>' + label + '</b><br><span class="muted xs">' + sub + '</span></span></label>';
      };
      var form = '<form id="wf3" data-submit="wizLink"><div class="sec" style="margin-top:0">What the parent pays through the link</div>' +
        (sch.length > 1 ? opt('first', 'First instalment – ' + money(sch[0].amt, cur), esc(termName(w.term)) + ': the remaining ' + (sch.length - 1) + ' instalment' + (sch.length > 2 ? 's follow' : ' follows') + ' the payment schedule below') : '') +
        opt('full', 'Full fee – ' + money(c.total, cur), 'Everything in one payment') +
        '<p class="muted xs">To switch between full payment and instalments, go Back and pick the payment term.</p></form>';
      h = h.replace(/<form id="wf3" data-submit="wizFinish">[\s\S]*?<\/form>(<div class="banner" style="margin-top:12px">[\s\S]*?<\/div>)?/, function () {
        return form + '<div class="banner" style="margin-top:12px">' + ic('check') + '<span>Send the link to the parent by WhatsApp or e-mail. When they pay, the student is enrolled, the LMS enrol call starts and the receipt is sent – no one needs to finish the enrolment by hand.</span></div>';
      });
      h = h.replace('>Complete enrolment</button>', '>' + ic('link') + ' Create payment link</button>');
    }
    return h;
  };
  CHG.wizPlan = function (el) { if (S.wiz) S.wiz.linkPlan = el.value; };
  var _wizFinish = SUB.wizFinish;
  SUB.wizLink = function (d, f) {
    var w = S.wiz;
    if (!w || !w.viaLink || !w.fee) return;
    var oppId = w.opp;
    var c = calcFee(w.fee, w.disc, w.mode === 'new'), sch = buildSched(termById(w.term), c.total, TODAY);
    var plan = d.plan || w.linkPlan || (sch.length > 1 ? 'first' : 'full');
    var amount = plan === 'full' ? c.total : sch[0].amt;
    var btn = document.querySelector('[data-act="wizNext"]');
    if (btn) btn.disabled = true;
    flush().then(function () {
      // Build the enrolment exactly as "Complete enrolment" would, take it as the link's form, then put the screen data back
      var bak = {};
      Object.keys(COLL).forEach(function (k) { bak[k] = JSON.stringify(S[k] || []); });
      var keep = { go: window.go, runSync: window.runSync, toast: window.toast };
      var changes = [];
      try {
        window.go = function () {}; window.runSync = function () {}; window.toast = function () {};
        _wizFinish({ amt: '0', method: 'Cash', ref: '' }, f);
        applyRemaps();
        changes = diff(true).changes;
      } finally {
        window.go = keep.go; window.runSync = keep.runSync; window.toast = keep.toast;
        Object.keys(COLL).forEach(function (k) { S[k] = JSON.parse(bak[k]); });
        S.wiz = w;
      }
      if (!changes.some(function (x) { return x.coll === 'enr'; })) { if (btn) btn.disabled = false; toast('Check the enrolment details – the form is not complete', 'err'); return; }
      return req('POST', '/opps/' + encodeURIComponent(oppId) + '/payment-link', { changes: changes, amount: amount }).then(function (r) {
        if (r.oppDoc) mergeDocs([{ coll: 'opps', doc: r.oppDoc }]);
        S.wiz = null; S.wizQ = '';
        if (S.oppLinks) delete S.oppLinks[oppId];
        go('opp', { id: oppId });
        openModal('plink', { link: r });
      });
    }).catch(function (e) { if (btn) btn.disabled = false; toast(e.message, 'err'); });
  };

  ACT.genReceipt = function (d) {
    var w = window.open('', '_blank');
    fetch(API + '/payments/' + encodeURIComponent(d.id) + '/receipt', { credentials: 'same-origin' }).then(function (r) { return r.text(); }).then(function (html) {
      var url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      if (w) w.location = url; else location.href = url;
    }).catch(function (e) { if (w) w.close(); toast(e.message, 'err'); });
  };
  // Invoice / receipt PDF – the same files the parent receives with the receipt e-mail
  ACT.payPdf = function (d) {
    fetch(API + '/payments/' + encodeURIComponent(d.id) + '/' + (d.kind === 'invoice' ? 'invoice' : 'receipt') + '.pdf', { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.error || 'Could not create the PDF'); });
      var name = ((r.headers.get('content-disposition') || '').match(/filename="([^"]+)"/) || [])[1] || (d.kind + '.pdf');
      return r.blob().then(function (b) {
        var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name;
        document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      });
    }).catch(function (e) { toast(e.message, 'err'); });
  };
  var _receipt = MODALS.receipt;
  MODALS.receipt = function (m) {
    var x = _receipt(m);
    x.foot = x.foot.replace('<button class="btn primary" data-act="genReceipt"',
      '<button class="btn" data-act="payPdf" data-kind="invoice" data-id="' + esc(m.id) + '">' + ic('download') + ' Invoice PDF</button>' +
      '<button class="btn" data-act="payPdf" data-kind="receipt" data-id="' + esc(m.id) + '">' + ic('download') + ' Receipt PDF</button>' +
      '<button class="btn primary" data-act="genReceipt"');
    x.foot = x.foot.replace('Generate receipt (simulated)', 'Open printable receipt');
    var rp = S.pay.find(function (y) { return y.id === m.id; });
    if (rp && rp.status === 'Cancelled') x.body = '<div class="banner" style="background:var(--crit-bg,#fdecec);color:var(--crit,#b42318);display:block;margin-bottom:10px"><b>Cancelled</b> on ' + esc(fDT(rp.cancel.at)) + ' by ' + esc(rp.cancel.by) + ' · with the parent’s knowledge: ' + esc(rp.cancel.parentAware) + '<br>Reason: ' + esc(rp.cancel.reason) + '</div>' + x.body;
    else if (rp && canCancelPay()) x.foot = '<button class="btn danger" data-act="payCancel" data-id="' + esc(m.id) + '" style="margin-right:auto">Cancel transaction</button>' + x.foot;
    x.body = x.body.replace('<span class="sim">Simulated</span>', '').replace('Prototype receipt – not a valid tax document. Finance linkage to ERPNext Accounts is pending integration.', 'Receipt numbers are issued by the server. Payments are posted to ERPNext Accounts as Payment Entries.');
    return x;
  };

  // ---------------- Branch GST (Configuration → Branches) – GSTIN, PAN, CGST %, SGST % for the tax invoice
  // Only those who can edit configuration (System Administrator by default) can change a branch. When CGST and
  // SGST are set, new fees for that branch are charged at CGST + SGST (calcFee) and the invoice shows both lines.
  function branchGst(b) {
    var has = function (v) { return v !== undefined && v !== null && v !== '' && isFinite(Number(v)); };
    if (!b || !has(b.cgst) || !has(b.sgst) || Number(b.cgst) + Number(b.sgst) <= 0) return null;
    return { cgst: Number(b.cgst), sgst: Number(b.sgst) };
  }
  var brOf = function (f) { return f && (S.branches || []).find(function (b) { return b.id === f.branch; }); };
  window.feeTaxPct = function (f) { var g = branchGst(brOf(f)); return g ? Math.round((g.cgst + g.sgst) * 100) / 100 : Number(f.tax) || 0; };
  window.feeTaxLabel = function (f) {
    var g = branchGst(brOf(f));
    return g ? 'GST ' + window.feeTaxPct(f) + '% (CGST ' + g.cgst + '% + SGST ' + g.sgst + '%)' : 'Tax (' + f.tax + '%)';
  };
  function gstProblemUi(d) {
    var gstin = String(d.gstin || '').trim().toUpperCase(), pan = String(d.pan || '').trim().toUpperCase();
    if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) return ['gstin', 'GSTIN must be 15 characters, e.g. 29ABCDE1234F1Z5'];
    if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) return ['pan', 'PAN must be 10 characters, e.g. ABCDE1234F'];
    if (gstin && pan && gstin.slice(2, 12) !== pan) return ['pan', 'Does not match the PAN inside the GSTIN (characters 3–12)'];
    var c = String(d.cgst == null ? '' : d.cgst).trim(), s = String(d.sgst == null ? '' : d.sgst).trim();
    if ((c === '') !== (s === '')) return [c === '' ? 'cgst' : 'sgst', 'Enter both CGST and SGST, or neither'];
    if (c !== '' && !(+c >= 0 && +c <= 50)) return ['cgst', 'A percentage from 0 to 50'];
    if (s !== '' && !(+s >= 0 && +s <= 50)) return ['sgst', 'A percentage from 0 to 50'];
    return null;
  }
  var _brModal = MODALS.branch;
  MODALS.branch = function (m) {
    var x = _brModal(m), b = m.id ? (S.branches || []).find(function (y) { return y.id === m.id; }) || {} : {};
    var num = function (v) { return v === undefined || v === null ? '' : v; };
    var gst = '<div class="sec">GST – printed on the tax invoice (India)</div>' +
      F('GSTIN', 'gstin', { v: b.gstin || '', ph: '29ABCDE1234F1Z5', help: '15-character GST number' }) +
      F('PAN', 'pan', { v: b.pan || '', ph: 'ABCDE1234F', help: '10-character PAN' }) + '<div></div>' +
      F('Central GST – CGST %', 'cgst', { t: 'number', min: 0, max: 50, step: '0.01', v: num(b.cgst), help: 'e.g. 9' }) +
      F('State GST – SGST %', 'sgst', { t: 'number', min: 0, max: 50, step: '0.01', v: num(b.sgst), help: 'e.g. 9' }) + '<div></div>' +
      '<div class="f full"><p class="muted xs" style="margin:0">When CGST and SGST are set, new fees at this branch are charged at CGST + SGST and the invoice shows both lines with the GSTIN and PAN. Enrolments already made keep the tax they were charged. Leave empty for branches without GST (UAE VAT keeps using the fee\'s tax %).</p></div>';
    x.body = x.body.replace('<div class="sec">Programmes offered</div>', gst + '<div class="sec">Programmes offered</div>');
    return x;
  };
  var _brSub = SUB.branch;
  SUB.branch = function (d, f) {
    var bad = gstProblemUi(d);
    if (bad) { clearErrs(f); setErr(f, bad[0], bad[1]); return; }
    var id = String(d.oid || d.id || '').toUpperCase();
    _brSub(d, f);
    var b = (S.branches || []).find(function (y) { return y.id === id; });
    if (!b || S.modal) return; // the form is still open: the branch was not saved
    var n = function (v) { v = String(v == null ? '' : v).trim(); return v === '' ? null : Math.round(Number(v) * 100) / 100; };
    b.gstin = String(d.gstin || '').trim().toUpperCase();
    b.pan = String(d.pan || '').trim().toUpperCase();
    b.cgst = n(d.cgst);
    b.sgst = n(d.sgst);
    render();
  };

  // ---------------- Payments → Payment links / Cancelled
  // Every payment link: who it went to, who created and sent it (how, when) and whether the parent paid.
  // Counsellors see only the links they shared (the server filters). Cancelled transactions have their own section.
  function canSeeLinks() { return can('payments', 'V') || can('payments', 'C') || can('enrollments', 'C') || can('opportunities', 'E'); }
  window.canSeeLinks = canSeeLinks;
  (function () {
    var g = GROUPS.find(function (x) { return x.id === 'pay'; });
    if (!g) return;
    var at = g.tabs.findIndex(function (t) { return t[0] === 'payRecords'; }) + 1;
    g.tabs.splice(at, 0, ['payCancelled', 'Cancelled', 'x', 'payments'], ['payLinks', 'Payment links', 'link', '*plinks']);
  })();
  var PL = { items: null, own: false, loading: false, at: 0 };
  function loadPL() {
    if (PL.loading) return;
    PL.loading = true;
    req('GET', '/payments/link-list').then(function (r) { PL.items = r.items || []; PL.own = !!r.own; PL.at = Date.now(); })
      .catch(function (e) { PL.items = PL.items || []; PL.at = Date.now(); toast(e.message, 'err'); })
      .then(function () { PL.loading = false; safeRender(); });
  }
  var PL_KIND = { opp: 'Opportunity – enrols on payment', collect: 'Payment collection', reminder: 'Instalment reminder' };
  function plStatus(x) {
    if (x.status === 'paid') return x.applyError ? ['Paid – enrol by hand', 'crit'] : x.paymentStatus === 'Cancelled' ? ['Paid – payment cancelled later', 'warn'] : ['Paid', 'ok'];
    return ({ created: ['Awaiting payment', 'warn'], expired: ['Not paid – expired', 'crit'], replaced: ['Not paid – replaced', ''], cancelled: ['Not paid – cancelled', ''], failed: ['Payment failed', 'crit'] })[x.status] || [x.status, ''];
  }
  CHG.plF = function (el) { S.plF = el.value; render(); };
  INP.plQ = function (el) { S.plQ = el.value; render(); };
  ACT.plRefresh = function () { loadPL(); };
  var _plSend2 = ACT.plSend;
  ACT.plSend = function (d) { _plSend2(d); setTimeout(loadPL, 1500); };
  PAGES.payLinks = function () {
    if (!canSeeLinks()) return ph('Payment links', '') + emptyBox('No access', 'Your role cannot see payment links.');
    if (!PL.loading && (!PL.items || Date.now() - PL.at > 60000)) loadPL();
    var all = PL.items || [], f = S.plF || '', q = String(S.plQ || '').toLowerCase().trim();
    var group = function (x) { return x.status === 'paid' ? 'paid' : x.status === 'created' ? 'open' : 'unpaid'; };
    var rows = all.filter(function (x) {
      if (f && group(x) !== f) return false;
      if (!q) return true;
      return [x.id, x.student, x.parent, x.phone, x.email, x.createdBy, x.sentBy, x.opp, x.enrollment, x.receipt].some(function (v) { return String(v || '').toLowerCase().indexOf(q) >= 0; });
    });
    // collected = paid through a link and not cancelled afterwards
    var paid = all.filter(function (x) { return x.status === 'paid' && x.paymentStatus !== 'Cancelled'; });
    var sum = paid.reduce(function (a, x) { return a + toAED(x.amount, x.currency); }, 0);
    var cols = [
      { h: 'Shared', s: function (x) { return x.createdAt; }, f: function (x) { return fDT(x.createdAt) + '<div class="muted xs">by ' + esc(x.createdBy || '—') + '</div>'; } },
      { h: 'To (parent)', f: function (x) { return '<b>' + esc(x.parent || '—') + '</b><div class="muted xs">' + esc([x.phone, x.email].filter(Boolean).join(' · ')) + '</div>'; } },
      { h: 'Student / for', f: function (x) {
        return (x.studentId ? '<a ' + sgo(x.studentId) + '>' + esc(x.student) + '</a>' : esc(x.student || '—')) +
          '<div class="muted xs">' + esc(x.prog) + ' · ' + esc(branchName(x.branch)) + '</div><div class="muted xs">' + esc(PL_KIND[x.kind] || x.kind) + ' · <span class="mono">' + esc(x.kind === 'opp' ? (x.opp || '') : (x.enrollment || x.opp || '')) + '</span></div>';
      } },
      { h: 'Amount', r: 1, s: function (x) { return toAED(x.amount, x.currency); }, f: function (x) { return money(x.amount, x.currency); } },
      { h: 'Sent', f: function (x) {
        return x.sentAt ? esc(x.sentVia || '') + ' · ' + fDT(x.sentAt) + '<div class="muted xs">by ' + esc(x.sentBy || '—') + (x.sentTo ? ' to ' + esc(x.sentTo) : '') + (x.sends > 1 ? ' · sent ' + x.sends + ' times' : '') + '</div>'
          : '<span class="muted xs">Not sent from the CRM (link copied, or not sent yet)</span>';
      } },
      { h: 'Paid?', f: function (x) {
        var st = plStatus(x);
        var more = x.status === 'paid' ? (x.paidAt ? fDT(x.paidAt) : '') + (x.receipt ? ' · <span class="mono">' + esc(x.receipt) + '</span>' : '')
          : x.status === 'created' ? (x.expiresAt ? 'Valid until ' + fDT(x.expiresAt) : 'Open until the next reminder') : '';
        return bdg(st[0], st[1]) + (more ? '<div class="muted xs">' + more + '</div>' : '') + (x.applyError ? '<div class="muted xs">' + esc(x.applyError) + '</div>' : '');
      } },
      { h: '', f: function (x) {
        return x.status === 'created' ? '<button class="btn sm" data-act="copy" data-v="' + esc(x.url) + '">Copy</button> <button class="btn sm" data-act="plSend" data-id="' + esc(x.id) + '" data-ch="WhatsApp">WhatsApp</button> <button class="btn sm" data-act="plSend" data-id="' + esc(x.id) + '" data-ch="Email">E-mail</button>' : '';
      } },
    ];
    var tools = '<input id="plQ" data-input="plQ" value="' + esc(S.plQ || '') + '" placeholder="Search parent, student, mobile, link…" aria-label="Search payment links" style="min-width:240px">' +
      '<select data-change="plF" aria-label="Status"><option value="">All links</option><option value="open"' + (f === 'open' ? ' selected' : '') + '>Awaiting payment</option><option value="paid"' + (f === 'paid' ? ' selected' : '') + '>Paid</option><option value="unpaid"' + (f === 'unpaid' ? ' selected' : '') + '>Not paid (expired / replaced)</option></select>' +
      '<button class="btn" data-act="plRefresh">' + ic('refresh') + ' Refresh</button>';
    return ph('Payment links', PL.own ? 'The payment links you shared – whether each parent paid' : 'Every payment link shared with parents – who sent it and whether it was paid', tools) +
      '<div class="sum"><div class="it"><small>Links</small><b>' + all.length + '</b></div><div class="it"><small>Paid</small><b>' + paid.length + '</b></div><div class="it"><small>Collected through links (AED equivalent)</small><b>' + Math.round(sum).toLocaleString('en-US') + '</b></div><div class="it"><small>Awaiting payment</small><b>' + all.filter(function (x) { return x.status === 'created'; }).length + '</b></div><div class="it"><small>Not paid</small><b>' + all.filter(function (x) { return group(x) === 'unpaid'; }).length + '</b></div></div>' +
      (PL.own ? '<div class="banner" style="margin-bottom:12px">' + ic('link') + '<span>You see the payment links you created or sent. Centre Administrators, Reception and Management see all links of their branches.</span></div>' : '') +
      card('', PL.items ? table('plinks', cols, rows, { ps: 15, et: all.length ? 'No links match' : 'No payment links yet', ed: all.length ? 'Change the search or the status filter.' : 'Links shared from an opportunity, from Payments → Collect or with instalment reminders appear here.' }) : '<p class="muted" style="padding:16px">Loading payment links…</p>', { np: 1 });
  };

  // Cancelled transactions: their own section; Payment Records lists only active payments
  ACT.payCancelCsv = function () {
    var ps = S.pay.filter(function (p) { return p.status === 'Cancelled' && inScope(p.branch); });
    openModal('csv', { name: 'cancelled-transactions', head: ['Payment', 'Receipt', 'Paid on', 'Student', 'Branch', 'Enrolment', 'Amount', 'Currency', 'Method', 'Reference', 'Cancelled on', 'Cancelled by', "Parent's knowledge", 'Reason'],
      rows: ps.map(function (p) { var s = stuById(p.stu), c = p.cancel || {}; return [p.id, p.rc, fDT(p.at), s ? s.first + ' ' + s.last : p.stu, branchName(p.branch), p.enr, p.amt, p.cur, p.method, p.ref, c.at ? fDT(c.at) : '', c.by || '', c.parentAware || '', c.reason || '']; }) });
  };
  PAGES.payCancelled = function () {
    if (!can('payments', 'V')) return ph('Cancelled transactions', '') + emptyBox('No access', 'Your role cannot see payments.');
    var when = function (p) { return (p.cancel && p.cancel.at) || p.at; };
    var ps = S.pay.filter(function (p) { return p.status === 'Cancelled' && inScope(p.branch); }).sort(function (a, b) { return new Date(when(b)) - new Date(when(a)); });
    var tot = ps.reduce(function (a, p) { return a + toAED(p.amt, p.cur); }, 0);
    var cols = [
      { h: 'Cancelled', s: when, f: function (p) { return fDT(when(p)) + '<div class="muted xs">by ' + esc((p.cancel || {}).by || '—') + '</div>'; } },
      { h: 'Receipt', f: function (p) { return '<a data-act="receipt" data-id="' + esc(p.id) + '" class="mono">' + esc(p.rc) + '</a><div class="mono muted xs">' + esc(p.id) + '</div>'; } },
      { h: 'Student', f: function (p) { var s = stuById(p.stu); return s ? '<a ' + sgo(s.id) + '>' + esc(s.first + ' ' + s.last) + '</a>' : esc(p.stu); } },
      { h: 'Branch / enrolment', f: function (p) { return esc(branchName(p.branch)) + '<div class="mono muted xs">' + esc(p.enr) + '</div>'; } },
      { h: 'Amount', r: 1, s: function (p) { return toAED(p.amt, p.cur); }, f: function (p) { return money(p.amt, p.cur); } },
      { h: 'Originally paid', f: function (p) { return fDT(p.at) + '<div class="muted xs">' + esc(p.method) + (p.ref && p.ref !== '—' ? ' · ' + esc(p.ref) : '') + '</div>'; } },
      { h: "Parent's knowledge", f: function (p) { var a = (p.cancel || {}).parentAware; return a ? bdg(a, a === 'Yes' ? 'ok' : 'warn') : '—'; } },
      { h: 'Reason', f: function (p) { return '<div style="min-width:200px">' + esc((p.cancel || {}).reason || '') + '</div>'; } },
    ];
    return ph('Cancelled transactions', 'Payments cancelled instead of deleted – receipt numbers are kept, the amounts are left out of every total', '<button class="btn" data-act="payCancelCsv">' + ic('download') + ' Export CSV</button>') +
      '<div class="sum"><div class="it"><small>Cancelled transactions</small><b>' + ps.length + '</b></div><div class="it"><small>Amount cancelled (AED equivalent)</small><b>' + Math.round(tot).toLocaleString('en-US') + '</b></div><div class="it muted xs">Not counted in Total collected, reports, dashboards or the enrolment balance</div></div>' +
      card('', table('pcan', cols, ps, { ps: 15, et: 'No cancelled transactions', ed: 'Use Cancel payment on Payments → Records when a payment was taken by mistake.' }), { np: 1 });
  };
  var _payRecCan = PAGES.payRecords;
  PAGES.payRecords = function (rt) {
    var h = _payRecCan(rt);
    var n = S.pay.filter(function (p) { return p.status === 'Cancelled' && inScope(p.branch); }).length;
    return n ? h.replace('<div class="it muted xs">INR converted at', '<div class="it"><small>Cancelled</small><b><a data-act="go" data-page="payCancelled" tabindex="0">' + n + '</a></b></div><div class="it muted xs">INR converted at') : h;
  };

  // ---------------- Communication remarks (lead → Communications)
  // Every call, WhatsApp and e-mail with the family is listed with its date and time. Remarks can be written or
  // changed until 24 hours after the communication (the server enforces the window). After a user's own call or
  // message, the remarks window opens by itself.
  var REMARK_HOURS = 24;
  function canRemark() { return can('leads', 'E') || can('leads', 'C'); }
  function remarkLeft(r) { return REMARK_HOURS * 36e5 - (Date.now() - Date.parse(r.at)); }
  function timeLeft(ms) { var h = Math.floor(ms / 36e5), m = Math.floor((ms % 36e5) / 6e4); return h ? h + ' h ' + m + ' min' : m + ' min'; }
  function commType(kind, r) {
    if (kind === 'call') return ic('phone') + ' Call · ' + (r.dir === 'Incoming' ? 'incoming' : 'outgoing');
    return ic(r.ch === 'WhatsApp' ? 'chat' : 'mail') + ' ' + (r.ch === 'Email' ? 'E-mail' : esc(r.ch)) + ' · ' + (r.inbound ? 'received' : 'sent');
  }
  function clip(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }
  function commDetail(kind, r, l) {
    if (kind === 'call') {
      return esc(r.status || '') + (r.outcome ? ' · ' + esc(r.outcome) : '') + ' · ' + (+r.dur || 0) + ' min' +
        (r.notes ? '<div class="muted xs">' + esc(clip(r.notes, 200)) + '</div>' : '') + (r.rec ? '<div class="xs"><a href="' + esc(r.rec) + '" target="_blank" rel="noopener">Recording</a></div>' : '');
    }
    return ((r.subj || r.subject) ? '<b class="sm">' + esc(r.subj || r.subject) + '</b>' : '') + '<div title="' + esc(clip(r.text, 1500)) + '">' + esc(clip(r.text, 240)) + '</div>' +
      (l && window.mailReplyBtn ? window.mailReplyBtn('lead', l.id, r) : '');
  }
  window.remarkCell = function (kind, r) {
    var left = remarkLeft(r), open = left > 0, mine = canRemark();
    var btn = function (label, primary) { return '<button class="btn sm' + (primary ? ' primary' : '') + '" data-act="remarkOpen" data-k="' + kind + '" data-id="' + esc(r.id) + '">' + label + '</button>'; };
    if (r.remark) {
      return '<div class="sm" style="white-space:pre-wrap;min-width:180px">' + esc(r.remark.text) + '</div><div class="muted xs">' + esc(r.remark.by) + ' · ' + fDT(r.remark.at) + (r.remark.edited ? ' · edited' : '') + '</div>' +
        (open && mine ? '<div style="margin-top:4px">' + btn('Edit') + '</div>' : '');
    }
    if (open) return mine ? btn('Add remarks', true) + '<div class="muted xs" style="margin-top:3px">' + timeLeft(left) + ' left</div>' : '<span class="muted xs">Awaiting remarks</span>';
    return '<span class="faint xs">No remarks – 24-hour window closed</span>';
  };
  function leadCommRows(l) {
    return (S.calls || []).filter(function (c) { return c.lead === l.id; }).map(function (c) { return { kind: 'call', r: c }; })
      .concat((S.comms || []).filter(function (c) { return c.lead === l.id; }).map(function (c) { return { kind: 'comm', r: c }; }))
      .sort(function (a, b) { return new Date(b.r.at) - new Date(a.r.at); });
  }
  window.commTable = function (l) {
    var rows = leadCommRows(l);
    var due = rows.filter(function (x) { return !x.r.remark && remarkLeft(x.r) > 0; }).length;
    var by = function (x) {
      if (x.kind === 'call') return esc(staffName(x.r.by) || x.r.by || '—');
      return bdg(x.r.status, String(x.r.status).indexOf('Blocked') === 0 ? 'crit' : x.r.inbound ? 'ok' : 'info') + '<div class="muted xs">' + esc(x.r.by || '') + '</div>';
    };
    return (due && canRemark() ? '<div class="banner" style="margin:12px 14px 0">' + ic('alert') + '<span><b>' + due + '</b> communication' + (due === 1 ? '' : 's') + ' still need' + (due === 1 ? 's' : '') + ' remarks. Remarks can be written up to 24 hours after each call or message.</span></div>' : '') +
      table('lcommAll', [
        { h: 'Date & time', f: function (x) { return fDT(x.r.at) + '<div class="muted xs">' + rel(x.r.at) + '</div>'; } },
        { h: 'Type', f: function (x) { return '<span style="white-space:nowrap">' + commType(x.kind, x.r) + '</span>'; } },
        { h: 'Details', f: function (x) { return commDetail(x.kind, x.r, l); } },
        { h: 'Status / by', f: by },
        { h: 'Remarks', f: function (x) { return window.remarkCell(x.kind, x.r); } },
      ], rows, { all: 1, et: 'No communication yet', ed: 'Calls, WhatsApp messages and e-mails with this family appear here.' });
  };
  function findRec(k, id) { return ((k === 'call' ? S.calls : S.comms) || []).find(function (x) { return x.id === id; }); }
  ACT.remarkOpen = function (d) { openModal('remark', { k: d.k, id: d.id }); };
  MODALS.remark = function (m) {
    var r = findRec(m.k, m.id);
    if (!r) return { title: 'Communication not found', body: '' };
    var l = leadById(r.lead), left = remarkLeft(r), until = new Date(Date.parse(r.at) + REMARK_HOURS * 36e5).toISOString();
    return {
      title: (r.remark ? 'Edit remarks' : 'Add remarks') + (l ? ' – ' + l.student : ''), form: 'remark', size: 'sm2',
      body: '<input type="hidden" name="k" value="' + esc(m.k) + '"><input type="hidden" name="id" value="' + esc(m.id) + '">' +
        (m.auto ? '<p class="sm" style="margin-top:0">Add your remarks on this ' + (m.k === 'call' ? 'call' : 'message') + ' while it is fresh.</p>' : '') +
        '<div class="card" style="margin-bottom:12px"><div class="bd">' + dl([['Communication', commType(m.k, r)], ['When', fDT(r.at)], ['With', l ? esc(l.parent) + ' · <span class="mono">' + esc(l.phone) + '</span>' : '—'], ['Details', commDetail(m.k, r, null)]]) + '</div></div>' +
        (left <= 0 ? '<div class="banner" style="background:var(--crit-bg);color:var(--crit)">The 24-hour window for remarks on this communication has closed.</div>' :
          '<div class="f"><label for="rmText">Remarks *</label><textarea id="rmText" name="text" rows="5" maxlength="1000" placeholder="What was discussed, what the parent said, the next step…">' + esc(r.remark ? r.remark.text : '') + '</textarea></div>' +
          '<p class="muted xs">Remarks can be written or changed until <b>' + fDT(until) + '</b> (24 hours after the communication).</p>'),
      foot: '<button class="btn" data-act="closeModal">' + (m.auto ? 'Later' : 'Cancel') + '</button>' + (left > 0 ? '<button class="btn primary" type="submit" form="mform">Save remarks</button>' : ''),
    };
  };
  SUB.remark = function (d) {
    var r = findRec(d.k, d.id);
    if (!r) return;
    var text = String(d.text || '').trim();
    if (text.length < 3) { toast('Write the remarks first (at least 3 characters)', 'err'); return; }
    var btn = document.querySelector('.modal button[type=submit]');
    if (btn) btn.disabled = true;
    flush().then(function () { return req('POST', '/leads/' + encodeURIComponent(r.lead) + '/remarks', { kind: d.k, rec: d.id, text: text }); })
      .then(function (res) {
        mergeDocs([{ coll: d.k === 'call' ? 'calls' : 'comms', doc: res.rec }, { coll: 'leads', doc: res.lead }]);
        closeModal();
        toast('Remarks saved', 'ok');
        render();
      })
      .catch(function (e) { if (btn) btn.disabled = false; toast(e.message, 'err'); });
  };
  // After the user's own call or message, open the remarks window (once per record). Calls through Exotel arrive with
  // the next refresh; a bulk e-mail is not a conversation, so its copies are not prompted one by one.
  var RM_SINCE = Date.now() - 2 * 60 * 1000, rmSeen = {};
  try { JSON.parse(LS.get('lof_rm_prompted') || '[]').forEach(function (k) { rmSeen[k] = 1; }); } catch (e) { /* ignore */ }
  function rmMark(k) { rmSeen[k] = 1; try { LS.set('lof_rm_prompted', JSON.stringify(Object.keys(rmSeen).slice(-300))); } catch (e) { /* ignore */ } }
  function remarkPrompt() {
    if (!S || !S.user || S.modal || userIsTyping() || !canRemark() || document.visibilityState !== 'visible') return;
    var u = me();
    if (!u) return;
    var fresh = function (r) { return !r.remark && Date.parse(r.at) >= RM_SINCE && remarkLeft(r) > 0; };
    var cands = [];
    (S.calls || []).forEach(function (c) { if (c.by === u.id && fresh(c) && !rmSeen['call:' + c.id]) cands.push({ k: 'call', r: c }); });
    var groups = {};
    (S.comms || []).forEach(function (c) {
      if (c.inbound || c.by !== u.name || !fresh(c) || rmSeen['comm:' + c.id]) return;
      var g = c.ch + '|' + (c.subj || '') + '|' + String(c.at).slice(0, 16);
      (groups[g] = groups[g] || []).push(c);
    });
    Object.keys(groups).forEach(function (g) {
      if (groups[g].length > 1) groups[g].forEach(function (c) { rmMark('comm:' + c.id); });
      else cands.push({ k: 'comm', r: groups[g][0] });
    });
    if (!cands.length) return;
    cands.sort(function (a, b) { return new Date(a.r.at) - new Date(b.r.at); });
    var x = cands[0];
    rmMark(x.k + ':' + x.r.id);
    openModal('remark', { k: x.k, id: x.r.id, auto: true });
  }
  setInterval(function () { try { remarkPrompt(); } catch (e) { /* never block the screens */ } }, 2500);

  // ---------------- Bulk lead import (Leads → Import leads)
  // Excel (.xlsx) or CSV, one lead per row. The file is read here (no library: .xlsx is a zip of XML), every row is
  // checked on the server first, and only then created – with the normal routing, duplicate check and first-call task.
  var IMP_COLS = [
    ['student', 'Student name *', ['studentname', 'student', 'childname', 'child', 'name', 'studentfullname']],
    ['parent', 'Parent name *', ['parentname', 'parent', 'guardianname', 'guardian', 'fathername', 'mothername', 'parentguardian', 'parentguardianname']],
    ['phone', 'Mobile *', ['mobile', 'phone', 'mobilenumber', 'phonenumber', 'contact', 'contactnumber', 'parentmobile', 'mobileno', 'phoneno', 'whatsappnumber', 'parentphone']],
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
  var hdrKey = function (h) { return String(h == null ? '' : h).toLowerCase().replace(/[^a-z]/g, ''); };
  function xmlEsc(v) { return String(v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function saveBlob(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // --- .xlsx reader (first sheet)
  function readXlsx(buf) {
    var dv = new DataView(buf), u8 = new Uint8Array(buf), td = new TextDecoder();
    var eocd = buf.byteLength - 22;
    while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
    if (eocd < 0) return Promise.reject(new Error('This is not an Excel .xlsx file – save it as .xlsx or CSV'));
    var n = dv.getUint16(eocd + 10, true), p = dv.getUint32(eocd + 16, true), files = {};
    for (var i = 0; i < n; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      var nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      files[td.decode(u8.subarray(p + 46, p + 46 + nl))] = { method: dv.getUint16(p + 10, true), size: dv.getUint32(p + 20, true), at: dv.getUint32(p + 42, true) };
      p += 46 + nl + el + cl;
    }
    function text(name) {
      var f = files[name];
      if (!f) return Promise.resolve(null);
      var start = f.at + 30 + dv.getUint16(f.at + 26, true) + dv.getUint16(f.at + 28, true), data = u8.slice(start, start + f.size);
      if (f.method === 0) return Promise.resolve(td.decode(data));
      if (f.method !== 8 || typeof DecompressionStream === 'undefined') return Promise.reject(new Error('This browser cannot read the file – save it as CSV and upload that'));
      return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
    }
    var parse = function (s) { return new DOMParser().parseFromString(s, 'application/xml'); };
    var all = function (node, tag) { return Array.prototype.slice.call(node.getElementsByTagNameNS('*', tag)); };
    return Promise.all([text('xl/workbook.xml'), text('xl/_rels/workbook.xml.rels'), text('xl/sharedStrings.xml')]).then(function (x) {
      if (!x[0]) throw new Error('This is not an Excel .xlsx file – save it as .xlsx or CSV');
      var sheet = all(parse(x[0]), 'sheet')[0];
      var rid = sheet && (sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || sheet.getAttribute('r:id'));
      var rel = x[1] && all(parse(x[1]), 'Relationship').filter(function (r) { return r.getAttribute('Id') === rid; })[0];
      var target = rel ? rel.getAttribute('Target').replace(/^\/?(xl\/)?/, '') : 'worksheets/sheet1.xml';
      var shared = x[2] ? all(parse(x[2]), 'si').map(function (si) { return all(si, 't').map(function (t) { return t.textContent; }).join(''); }) : [];
      return text('xl/' + target).then(function (s) {
        if (!s) throw new Error('The first sheet of the workbook is empty');
        var out = [];
        all(parse(s), 'row').forEach(function (r) {
          var rn = +r.getAttribute('r') || out.length + 1, cells = [];
          all(r, 'c').forEach(function (c, k) {
            var ref = c.getAttribute('r') || '', col = 0, m = ref.match(/^[A-Z]+/);
            if (m) { for (var j = 0; j < m[0].length; j++) col = col * 26 + (m[0].charCodeAt(j) - 64); } else col = k + 1;
            var t = c.getAttribute('t'), v = all(c, 'v')[0], val = '';
            if (t === 's') val = shared[+(v ? v.textContent : -1)] || '';
            else if (t === 'inlineStr') val = all(c, 't').map(function (x2) { return x2.textContent; }).join('');
            else if (t === 'b') val = v && v.textContent === '1' ? 'Yes' : 'No';
            else val = v ? v.textContent : '';
            cells[col - 1] = val;
          });
          out.push({ n: rn, cells: cells });
        });
        return out;
      });
    });
  }
  // --- CSV reader (comma, semicolon or tab; quoted fields)
  function readCsv(s) {
    s = s.replace(/^﻿/, '');
    var first = s.split(/\r?\n/)[0] || '', d = [',', ';', '\t'].sort(function (a, b) { return first.split(b).length - first.split(a).length; })[0];
    var rows = [], row = [], f = '', q = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (q) { if (ch === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
      else if (ch === '"') q = true;
      else if (ch === d) { row.push(f); f = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += ch;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows.map(function (cells, k) { return { n: k + 1, cells: cells }; });
  }
  /** Sheet rows → lead rows (by header names), with Excel date numbers turned into dates. */
  function sheetToLeads(rows) {
    rows = rows.filter(function (r) { return r.cells.some(function (c) { return String(c == null ? '' : c).trim(); }); });
    if (!rows.length) throw new Error('The sheet is empty');
    var head = rows[0].cells.map(hdrKey), map = {}, unknown = [];
    head.forEach(function (h, i) {
      if (!h) return;
      var col = IMP_COLS.filter(function (c) { return c[2].indexOf(h) >= 0; })[0];
      if (col && map[col[0]] === undefined) map[col[0]] = i; else unknown.push(rows[0].cells[i]);
    });
    var missing = ['student', 'parent', 'phone'].filter(function (k) { return map[k] === undefined; });
    if (missing.length) throw new Error('The first row must have the column names. Missing: ' + missing.map(function (k) { return IMP_COLS.filter(function (c) { return c[0] === k; })[0][1].replace(' *', ''); }).join(', ') + ' – download the template to see them');
    var leads = rows.slice(1).map(function (r) {
      var o = { row: r.n };
      Object.keys(map).forEach(function (k) { var v = r.cells[map[k]]; o[k] = v == null ? '' : String(v).trim(); });
      if (/^\d{4,6}(\.\d+)?$/.test(o.dob || '')) o.dob = new Date(Date.UTC(1899, 11, 30) + Math.floor(+o.dob) * 864e5).toISOString().slice(0, 10);
      return o;
    });
    return { leads: leads, unknown: unknown };
  }

  // --- .xlsx template (stored zip, no compression)
  function crc32(u8) {
    var t = crc32.t || (crc32.t = (function () { var t2 = new Uint32Array(256); for (var n2 = 0; n2 < 256; n2++) { var c = n2; for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t2[n2] = c >>> 0; } return t2; })());
    var c2 = 0xffffffff;
    for (var i = 0; i < u8.length; i++) c2 = t[(c2 ^ u8[i]) & 255] ^ (c2 >>> 8);
    return (c2 ^ 0xffffffff) >>> 0;
  }
  function zipStore(files) {
    var enc = new TextEncoder(), parts = [], cd = [], off = 0;
    files.forEach(function (f) {
      var nm = enc.encode(f.name), d = enc.encode(f.text), crc = crc32(d);
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(12, 0x21, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, d.length, true); lh.setUint32(22, d.length, true); lh.setUint16(26, nm.length, true);
      parts.push(new Uint8Array(lh.buffer), nm, d);
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(14, 0x21, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, d.length, true); ch.setUint32(24, d.length, true); ch.setUint16(28, nm.length, true); ch.setUint32(42, off, true);
      cd.push(new Uint8Array(ch.buffer), nm);
      off += 30 + nm.length + d.length;
    });
    var size = cd.reduce(function (a, b) { return a + b.length; }, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
    return new Blob(parts.concat(cd, [new Uint8Array(e.buffer)]), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  function sheetXml(rows, widths) {
    var L = function (i) { var s = ''; i++; while (i) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>' +
      widths.map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('') + '</cols><sheetData>' +
      rows.map(function (r, ri) { return '<row r="' + (ri + 1) + '">' + r.map(function (v, ci) { return v === '' || v == null ? '' : '<c r="' + L(ci) + (ri + 1) + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>'; }).join('') + '</row>'; }).join('') +
      '</sheetData></worksheet>';
  }
  /** Workbook parts for the template (also used by the test of the reader). */
  window.lofLeadTemplate = function () {
    var brs = optBranches(), progs = (S.programs || []).filter(function (p) { return p.active !== false; });
    var srcs = ((S.cfg && S.cfg.sources) || []).filter(function (s) { return s.en; }).map(function (s) { return s.n; });
    var cs = (S.staff || []).filter(function (s) { return s.role === 'Counsellor' && s.status !== 'Inactive' && brs.some(function (b) { return b[0] === s.branch; }); });
    var cats = ['Hot', 'Warm', 'Cold'], yn = ['Yes', 'No'];
    var lists = [['Branch', 'Programme', 'Category', 'Source', 'Counsellor (branch)', 'Consent']];
    for (var i = 0; i < Math.max(brs.length, progs.length, cats.length, srcs.length, cs.length, 2); i++) {
      lists.push([brs[i] ? brs[i][1] : '', progs[i] ? progs[i].name : '', cats[i] || '', srcs[i] || '', cs[i] ? cs[i].name + ' (' + branchName(cs[i].branch) + ')' : '', yn[i] || '']);
    }
    var notes = [['How to fill in the Leads sheet'], ['One lead per row. Keep the first row (column names) as it is.'],
      ['Required: Student name, Parent name, Mobile (with country code, e.g. +971 50 123 4567).'],
      ['Branch, Programme, Source and Category can be left empty – the values chosen in the import window are used.'],
      ['Date of birth as 31/05/2014. Consent columns: Yes or No (empty = Yes).'],
      ['Counsellor is optional – leads without one are assigned by the routing rules. Write the name only, e.g. Priya Nair.'],
      ['Valid names are on the "Valid values" sheet. At most 500 rows per file.']];
    var M = 'http://schemas.openxmlformats.org/', ws = M + 'officeDocument/2006/relationships/worksheet', sh = 'application/vnd.openxmlformats-officedocument.spreadsheetml.';
    return zipStore([
      { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="' + M + 'package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="' + sh + 'sheet.main+xml"/>' + [1, 2, 3].map(function (k) { return '<Override PartName="/xl/worksheets/sheet' + k + '.xml" ContentType="' + sh + 'worksheet+xml"/>'; }).join('') + '</Types>' },
      { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + M + 'package/2006/relationships"><Relationship Id="rId1" Type="' + M + 'officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="' + M + 'spreadsheetml/2006/main" xmlns:r="' + M + 'officeDocument/2006/relationships"><sheets><sheet name="Leads" sheetId="1" r:id="rId1"/><sheet name="Valid values" sheetId="2" r:id="rId2"/><sheet name="How to fill" sheetId="3" r:id="rId3"/></sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + M + 'package/2006/relationships">' + [1, 2, 3].map(function (k) { return '<Relationship Id="rId' + k + '" Type="' + ws + '" Target="worksheets/sheet' + k + '.xml"/>'; }).join('') + '</Relationships>' },
      { name: 'xl/worksheets/sheet1.xml', text: sheetXml([IMP_COLS.map(function (c) { return c[1]; })], IMP_COLS.map(function (c) { return Math.max(14, c[1].length + 4); })) },
      { name: 'xl/worksheets/sheet2.xml', text: sheetXml(lists, [22, 28, 12, 14, 34, 10]) },
      { name: 'xl/worksheets/sheet3.xml', text: sheetXml(notes, [110]) },
    ]);
  };
  window.lofReadSheet = function (buf, isCsv) { return (isCsv ? Promise.resolve(readCsv(new TextDecoder().decode(buf))) : readXlsx(buf)).then(sheetToLeads); };
  ACT.impTemplate = function () { saveBlob(window.lofLeadTemplate(), 'lead-import-template.xlsx'); };

  // --- the import window: choose file → check every row → import
  function impState() {
    if (!S.imp) {
      var brs = optBranches();
      S.imp = { opts: { branch: brs.length === 1 ? brs[0][0] : '', prog: '', src: 'Manual', cat: 'Warm', send: false, dups: false } };
    }
    return S.imp;
  }
  ACT.openLeadImport = function () { S.imp = null; impState(); openModal('leadImport', { step: 'pick' }); };
  MODALS.leadImport = function (m) {
    var st = impState(), o = st.opts;
    var sel = function (k, label, v, opts, blank) {
      return '<div class="f"><label for="imp_' + k + '">' + label + '</label><select id="imp_' + k + '" data-change="impOpt" data-k="' + k + '">' + (blank ? '<option value="">' + esc(blank) + '</option>' : '') +
        opts.map(function (x) { return '<option value="' + esc(x[0]) + '"' + (x[0] === v ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join('') + '</select></div>';
    };
    if (m.step === 'check' || m.step === 'done') {
      var res = st.res || { results: [], summary: {} }, s = res.summary, done = m.step === 'done';
      // problem rows first, so a few errors are not buried under hundreds of ready rows
      var ord = { error: 0, duplicate: 1, ready: 2, created: 3 };
      var show = (done ? res.results.filter(function (r) { return r.status !== 'created'; }) : res.results.slice()).sort(function (a, b) { return (ord[a.status] - ord[b.status]) || (a.row - b.row); });
      var badge = function (r) {
        var k = { ready: ['Ready', 'ok'], created: ['Created', 'ok'], duplicate: [o.dups && !done ? 'Duplicate – will import' : 'Duplicate – skipped', 'warn'], error: ['Error', 'crit'] }[r.status] || [r.status, ''];
        return bdg(k[0], k[1]) + ' <span class="muted xs">' + esc(r.message) + '</span>';
      };
      var tbl = show.length ? '<div style="max-height:52vh;overflow:auto;border:1px solid var(--line);border-radius:8px"><table class="tbl"><thead><tr><th>Row</th><th>Student</th><th>Parent</th><th>Mobile</th><th>Branch</th><th>Programme</th><th>Check</th></tr></thead><tbody>' +
        show.map(function (r) { return '<tr><td class="mono">' + r.row + '</td><td>' + esc(r.student) + '</td><td>' + esc(r.parent) + '</td><td class="mono xs">' + esc(r.phone) + '</td><td>' + esc(r.branch) + '</td><td>' + esc(r.prog) + '</td><td>' + badge(r) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '';
      var head = done
        ? '<div class="banner" style="background:var(--ok-bg);color:var(--ok);display:block;margin-bottom:12px"><b>' + s.created + ' lead' + (s.created === 1 ? '' : 's') + ' created</b> from ' + esc(st.file) + '.' + (show.length ? ' The rows below were not imported – fix them in the sheet and import just those rows again.' : '') + '</div>'
        : '<p class="sm" style="margin-top:0"><b>' + esc(st.file) + '</b>: ' + s.total + ' row' + (s.total === 1 ? '' : 's') + ' – <b>' + s.ready + ' ready</b>' + (s.duplicates ? ', ' + s.duplicates + ' already in the CRM (' + (o.dups ? 'imported anyway' : 'skipped') + ')' : '') + (s.errors ? ', <b style="color:var(--crit)">' + s.errors + ' with errors</b> (skipped)' : '') + '. Nothing has been created yet.</p>' +
          (st.unknown && st.unknown.length ? '<p class="muted xs">Columns not used: ' + esc(st.unknown.join(', ')) + '</p>' : '');
      return {
        title: done ? 'Import finished' : 'Check the leads before importing', size: 'lg', body: head + tbl,
        foot: done
          ? (show.length ? '<button class="btn" data-act="impErrCsv">' + ic('download') + ' Rows not imported (CSV)</button>' : '') + '<button class="btn primary" data-act="impClose">Close</button>'
          : '<button class="btn" data-act="impBack">Back</button><button class="btn primary" data-act="impGo"' + (s.ready ? '' : ' disabled') + '>Import ' + s.ready + ' lead' + (s.ready === 1 ? '' : 's') + '</button>',
      };
    }
    var srcs = ((S.cfg && S.cfg.sources) || []).filter(function (x) { return x.en; }).map(function (x) { return [x.n, x.n]; });
    var progs = (S.programs || []).filter(function (p) { return p.active !== false; }).map(function (p) { return [p.id, p.name]; });
    return {
      title: 'Import leads from Excel', size: 'lg',
      body: '<p class="sm" style="margin-top:0">Upload an Excel (<b>.xlsx</b>) or <b>CSV</b> file with one lead per row – up to 500 at a time. <b>Student name</b>, <b>Parent name</b> and <b>Mobile</b> are required. Every row is checked first; nothing is created until you confirm.</p>' +
        '<p><button class="btn" data-act="impTemplate">' + ic('download') + ' Download Excel template</button></p>' +
        '<div class="sec">When a row leaves these empty, use</div><div class="fgrid">' +
        sel('branch', 'Branch', o.branch, optBranches(), 'Must be in the sheet') + sel('prog', 'Programme', o.prog, progs, 'Must be in the sheet') +
        sel('src', 'Source', o.src, srcs) + sel('cat', 'Category', o.cat, [['Hot', 'Hot'], ['Warm', 'Warm'], ['Cold', 'Cold']]) + '</div>' +
        '<div class="f" style="margin-top:10px"><label style="display:flex;gap:8px;align-items:center;font-weight:400"><input type="checkbox" data-change="impOpt" data-k="send"' + (o.send ? ' checked' : '') + '> Send the automatic welcome WhatsApp / e-mail to these parents</label>' +
        '<label style="display:flex;gap:8px;align-items:center;font-weight:400;margin-top:6px"><input type="checkbox" data-change="impOpt" data-k="dups"' + (o.dups ? ' checked' : '') + '> Also import rows whose mobile or e-mail is already in the CRM</label></div>' +
        '<div class="f" style="margin-top:12px"><label for="impFile">Excel or CSV file</label><input type="file" id="impFile" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" data-change="impFile"></div>' +
        (st.leads ? '<p class="muted xs">' + esc(st.file) + ' is loaded (' + st.leads.length + ' rows). <a href="#" data-act="impCheck">Check it again</a> with these settings, or choose another file.</p>' : ''),
      foot: '<button class="btn" data-act="closeModal">Close</button>',
    };
  };
  CHG.impOpt = function (el) {
    var o = impState().opts, k = el.getAttribute('data-k');
    o[k] = el.type === 'checkbox' ? el.checked : el.value;
  };
  CHG.impFile = function (el) {
    var f = el.files && el.files[0], st = impState();
    if (!f) return;
    var isCsv = /\.csv$/i.test(f.name) || f.type === 'text/csv';
    if (!isCsv && !/\.xlsx$/i.test(f.name)) { toast('Use an .xlsx or .csv file (older .xls files: open in Excel and save as .xlsx)', 'err'); el.value = ''; return; }
    f.arrayBuffer().then(function (buf) { return window.lofReadSheet(buf, isCsv); }).then(function (x) {
      if (!x.leads.length) throw new Error('The sheet has column names but no leads below them');
      if (x.leads.length > 500) throw new Error('The sheet has ' + x.leads.length + ' rows – at most 500 per file, split it');
      st.leads = x.leads; st.unknown = x.unknown; st.file = f.name;
      ACT.impCheck();
    }).catch(function (e) { el.value = ''; toast(e.message || 'The file could not be read', 'err'); });
  };
  function impBody(dry) {
    var st = impState(), o = st.opts;
    return { rows: st.leads, defaults: { branch: o.branch, prog: o.prog, src: o.src, cat: o.cat }, sendMessages: !!o.send, allowDuplicates: !!o.dups, dryRun: dry };
  }
  ACT.impCheck = function () {
    var st = impState();
    if (!st.leads) return;
    req('POST', '/leads/import', impBody(true)).then(function (r) { st.res = r; openModal('leadImport', { step: 'check' }); }).catch(function (e) { toast(e.message, 'err'); });
  };
  ACT.impBack = function () { openModal('leadImport', { step: 'pick' }); };
  ACT.impGo = function () {
    var st = impState(), btn = document.querySelector('[data-act="impGo"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Importing…'; }
    req('POST', '/leads/import', impBody(false)).then(function (r) {
      st.res = r;
      return reload(true).then(function () { openModal('leadImport', { step: 'done' }); });
    }).catch(function (e) { if (btn) btn.disabled = false; toast(e.message, 'err'); });
  };
  ACT.impClose = function () { S.imp = null; closeModal(); go('leads'); };
  ACT.impErrCsv = function () {
    var st = impState(), q = function (v) { v = String(v == null ? '' : v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var bad = st.res.results.filter(function (r) { return r.status !== 'created'; }), byRow = {};
    st.leads.forEach(function (l) { byRow[l.row] = l; });
    var lines = [IMP_COLS.map(function (c) { return c[1].replace(' *', ''); }).concat(['Problem'])].concat(bad.map(function (r) { var l = byRow[r.row] || {}; return IMP_COLS.map(function (c) { return l[c[0]] || ''; }).concat([r.message]); }));
    saveBlob(new Blob(['﻿' + lines.map(function (l) { return l.map(q).join(','); }).join('\r\n')], { type: 'text/csv' }), 'leads-not-imported.csv');
  };
  var _leadsImp = PAGES.leads;
  PAGES.leads = function (rt) {
    var h = _leadsImp(rt);
    return can('leads', 'C') ? h.replace('<button class="btn primary" data-act="openNewLead">', '<button class="btn" data-act="openLeadImport">' + ic('list') + ' Import leads</button><button class="btn primary" data-act="openNewLead">') : h;
  };

  // ---------------- Transaction cancellation
  // A payment taken by mistake is cancelled, never deleted: two questions (parent's knowledge, reason), then a final
  // "cannot be undone" confirmation. The receipt number stays, marked Cancelled; the amount leaves every total.
  function canCancelPay() { return can('payments', 'C') || can('payments', 'E'); }
  window.payCancelBtn = function (p) {
    return p && p.status !== 'Cancelled' && canCancelPay() ? '<button class="btn sm danger" data-act="payCancel" data-id="' + esc(p.id) + '">Cancel payment</button>' : '';
  };
  ACT.payCancel = function (d) { closeModal(); openModal('payCancel', { id: d.id, step: 1 }); };
  MODALS.payCancel = function (m) {
    var p = S.pay.find(function (x) { return x.id === m.id; });
    if (!p) return { title: 'Payment not found', body: '' };
    var s = stuById(p.stu), who = s ? s.first + ' ' + s.last : p.stu;
    var summary = '<div class="card" style="margin-bottom:12px"><div class="bd">' + dl([['Receipt', '<span class="mono">' + esc(p.rc) + '</span>'], ['Student', esc(who)], ['Amount', '<b>' + money(p.amt, p.cur) + '</b>'], ['Paid', esc(fDT(p.at)) + ' · ' + esc(p.method) + (p.ref && p.ref !== '—' ? ' · ' + esc(p.ref) : '')], ['Enrolment', '<span class="mono">' + esc(p.enr) + '</span>']]) + '</div></div>';
    if (m.step === 2) {
      return {
        title: 'Cancel this transaction?', size: 'sm2',
        body: summary + '<div class="banner" style="background:var(--crit-bg,#fdecec);color:var(--crit,#b42318);display:block"><b>This cannot be undone.</b> Once cancelled, the transaction cannot be restored. Receipt <span class="mono">' + esc(p.rc) + '</span> stays in the records marked Cancelled, and ' + money(p.amt, p.cur) + ' is removed from the paid amount and from all totals.</div>' +
          '<p class="sm" style="margin-top:10px">With the parent’s knowledge: <b>' + esc(m.aware) + '</b><br>Reason: ' + esc(m.reason) + '</p>',
        foot: '<button class="btn" data-act="closeModal">Don’t cancel</button><button class="btn danger" data-act="payCancelGo">OK, cancel the transaction</button>',
      };
    }
    var radio = function (v) { return '<label style="display:inline-flex;gap:6px;align-items:center;margin-right:18px"><input type="radio" name="aware" value="' + v + '"' + (m.aware === v ? ' checked' : '') + '> ' + v + '</label>'; };
    return {
      title: 'Cancel transaction ' + p.rc, form: 'payCancel', ok: 'Continue', danger: 1, size: 'sm2',
      foot: '<button class="btn" data-act="closeModal">Keep the transaction</button><button class="btn danger" type="submit" form="mform">Continue</button>',
      body: summary + '<input type="hidden" name="id" value="' + esc(p.id) + '">' +
        '<div class="f"><label>1. Is this transaction being cancelled with the parent’s knowledge? *</label><div style="padding:6px 0">' + radio('Yes') + radio('No') + '</div></div>' +
        '<div class="f"><label for="pcReason">2. Reason for the cancellation *</label><textarea id="pcReason" name="reason" rows="4" maxlength="500" placeholder="e.g. Wrong course selected – parent wanted Robotics, not AI">' + esc(m.reason || '') + '</textarea></div>' +
        '<p class="muted xs">Refunds are handled separately.</p>',
    };
  };
  SUB.payCancel = function (d) {
    var reason = String(d.reason || '').replace(/\s+/g, ' ').trim();
    if (d.aware !== 'Yes' && d.aware !== 'No') { toast('Answer question 1: is the parent aware of the cancellation?', 'err'); return; }
    if (reason.length < 10) { toast('Describe the reason for the cancellation (at least 10 characters)', 'err'); return; }
    openModal('payCancel', { id: d.id, step: 2, aware: d.aware, reason: reason });
  };
  ACT.payCancelGo = function () {
    var m = S.modal || {};
    var btn = document.querySelector('[data-act="payCancelGo"]');
    if (btn) btn.disabled = true;
    req('POST', '/payments/' + encodeURIComponent(m.id) + '/cancel', { parentAware: m.aware, reason: m.reason, confirm: true }).then(function (r) {
      mergeDocs([{ coll: 'pay', doc: r.payment }].concat(r.enrollment ? [{ coll: 'enr', doc: r.enrollment }] : []));
      closeModal();
      toast('Transaction ' + r.payment.rc + ' cancelled', 'ok');
      render();
    }).catch(function (e) { if (btn) btn.disabled = false; toast(e.message, 'err'); });
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
        '<div class="sm" style="padding:14px;white-space:pre-wrap;line-height:1.55">' + esc(etSample(t.body || '')) + '</div>' + etReceiptExtras(t) + '</div>'
    };
  };
  // The template used for receipt confirmations is sent with the receipt (in the e-mail) and two PDF attachments
  function etReceiptExtras(t) {
    var a = S.cfg.mailAuto || {}, tpl = (a.receipt && a.receipt.tpl) || 'Fee receipt';
    if (t.n !== tpl) return '';
    var rc = etSample('{receipt_no}'), inv = 'INV-26-0042';
    var chip = function (n) { return '<span class="badge" style="display:inline-flex;gap:6px;align-items:center;padding:5px 10px">' + ic('download') + esc(n) + '</span>'; };
    return '<div style="padding:12px 14px;border-top:1px solid var(--bd);background:var(--bg2,rgba(127,127,127,.06))">' +
      '<div class="sm" style="margin-bottom:8px"><b>Sent with this message</b> <span class="muted xs">– automatically, after each payment (Email Automation → Receipt confirmations' + (a.receipt && a.receipt.on ? ', on' : ', currently off') + ')</span></div>' +
      '<div class="xs muted" style="margin-bottom:8px">Below the message: the receipt in the Lab of Future layout – amount paid, items, VAT, totals and payment history.</div>' +
      '<div class="row" style="gap:8px;flex-wrap:wrap">' + chip('Invoice-' + inv + '.pdf') + chip('Receipt-' + rc + '.pdf') + '</div></div>';
  }

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
      ['Sending through', st.smtp && st.smtp.host ? '<span class="mono sm">' + esc(st.smtp.host + ':' + st.smtp.port) + '</span> · ' + (st.smtp.security === 'ssl' ? 'SSL' : 'STARTTLS') : esc(st.provider)],
      ['Mode', st.mode === 'live' ? bdg('Live – e-mails are delivered', 'ok') : bdg('Mock – nothing is delivered', 'warn')],
      ['Sending address', '<span class="mono sm">' + esc(st.from || 'not set') + '</span>'],
      ['Still to fill in', st.missing.length ? '<span class="mono xs" style="color:var(--crit)">' + st.missing.map(esc).join(', ') + '</span>' : bdg('None', 'ok')],
    ]) + (o.on === false ? '<div class="banner" style="margin-top:12px">' + ic('alert') + '<span><b>Sending is paused.</b> E-mails are not sent until you turn sending back on.</span></div>' : '');
    var form = cfgForm('mailOut',
      swRow('Send e-mails', 'on', o.on !== false, 'Turn off to pause every e-mail the CRM sends (messages are marked Failed and can be sent again).') +
      '<div class="fgrid" style="margin-top:12px">' +
      F('Sender name', 'fromName', { v: o.fromName, req: 1, help: 'Shown to parents as the sender, e.g. Lab of Future' }) +
      F('Reply-to address', 'replyTo', { v: o.replyTo, ph: 'ranjith@laboffuture.com', help: 'Where parent replies go. Leave empty to use the sending address.' }) +
      F('Send a copy (BCC) to', 'bcc', { v: o.bcc, ph: 'optional', help: 'Keeps a copy of every e-mail in this mailbox' }) +
      F('Daily sending limit', 'dailyLimit', { t: 'number', min: 0, max: 10000, v: o.dailyLimit, help: 'Stops sending for the day above this number (0 = no limit). Gmail allows about 2,000 a day.' }) +
      F('Signature', 'signature', { t: 'textarea', rows: 4, v: o.signature, full: 1, ph: 'Lab of Future\n+971 4 000 0000 · laboffuture.com', help: 'Added to the end of every e-mail' }) + '</div>');
    var test = '<form data-submit="mailTest" class="row" novalidate style="flex-wrap:wrap;gap:8px"><input type="email" name="to" placeholder="your.name@laboffuture.com" aria-label="Send test e-mail to" style="min-width:min(100%,280px)"><button class="btn primary" type="submit">Send test e-mail</button></form>' +
      '<p class="muted xs">Uses the saved settings above. In mock mode the e-mail is only written to the Integration log.</p>';
    var sm = o.smtp || {};
    var smtpForm = '<form data-submit="smtpSave" novalidate autocomplete="off"><div class="fgrid">' +
      F('SMTP server', 'host', { v: sm.host || 'smtp.gmail.com', req: 1, help: 'Google Workspace: smtp.gmail.com · Microsoft 365: smtp.office365.com' }) +
      F('Security', 'security', { v: sm.security || 'ssl', opts: [['ssl', 'SSL/TLS – port 465'], ['starttls', 'STARTTLS – port 587']], chg: 'smtpSec' }) +
      F('Port', 'port', { t: 'number', min: 1, max: 65535, v: sm.port || 465, req: 1, help: '465 for SSL/TLS, 587 for STARTTLS' }) +
      F('Username', 'user', { v: sm.user, req: 1, ph: 'ranjith@laboffuture.com', help: 'The full mailbox address' }) +
      F('Password', 'pass', { t: 'password', ph: sm.passSet ? '•••••••• saved – leave empty to keep' : 'App password', req: !sm.passSet, help: 'Google Workspace: a 16-character <b>app password</b> (not the normal password). Stored encrypted on the server and never shown again.' }) +
      F('From address', 'from', { t: 'email', v: sm.from, req: 1, ph: 'ranjith@laboffuture.com', help: 'The mailbox, or an alias it is allowed to send as' }) +
      '</div><div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap"><button class="btn primary" type="submit">Save SMTP server</button>' +
      (sm.passSet ? '<button class="btn" type="button" data-act="smtpVerify">Check connection</button>' : '') + '</div></form>';
    var smtpHelp = '<details style="margin-top:14px"><summary class="sm" style="cursor:pointer"><b>How to set up Google Workspace (ranjith@laboffuture.com)</b></summary><ol class="sm" style="line-height:1.7;margin:8px 0 0 18px;padding:0">' +
      '<li>Sign in to <b>myaccount.google.com</b> as ranjith@laboffuture.com.</li>' +
      '<li>Security → turn on <b>2-Step Verification</b> (needed for app passwords).</li>' +
      '<li>Security → <b>App passwords</b> → name it “LOF CRM” → copy the 16-character password.</li>' +
      '<li>Here: server <span class="mono">smtp.gmail.com</span>, SSL/TLS, port <span class="mono">465</span>, username and From address <span class="mono">ranjith@laboffuture.com</span>, paste the app password, Save.</li>' +
      '<li>Click <b>Check connection</b>, then send a test e-mail below.</li></ol>' +
      '<p class="muted xs" style="margin-top:8px">If “App passwords” is missing, the Workspace administrator must allow 2-Step Verification for the account (Admin console → Security → Authentication). Google limits a mailbox to about 2,000 e-mails a day.</p></details>';
    var smtpView = mailKV([['SMTP server', esc((sm.host || '—') + ':' + (sm.port || ''))], ['Security', sm.security === 'starttls' ? 'STARTTLS' : 'SSL/TLS'], ['Username', esc(sm.user || '—')], ['From address', esc(sm.from || '—')], ['Password', sm.passSet ? 'Saved' : 'Not set']]);
    return card('Connection', status, { act: '<button class="btn sm ghost" data-act="mailRefresh">Refresh</button>' }) + '<div style="height:14px"></div>' +
      card('SMTP server', (edit ? smtpForm + smtpHelp : smtpView)) + '<div style="height:14px"></div>' +
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
  CHG.smtpSec = function (el) {
    var p = el.form && el.form.querySelector('[name=port]');
    if (p && (p.value === '465' || p.value === '587' || !p.value)) p.value = el.value === 'ssl' ? '465' : '587';
  };
  SUB.smtpSave = function (d, f) {
    clearErrs(f);
    var sm = (S.cfg.mailOut || {}).smtp || {};
    if (!need(f, d, sm.passSet ? ['host', 'port', 'user', 'from'] : ['host', 'port', 'user', 'pass', 'from'])) return;
    if (!MAIL_RE.test(String(d.from).trim())) { setErr(f, 'from', 'Enter a valid e-mail address'); return; }
    var body = { host: String(d.host).trim(), port: Number(d.port), security: d.security, user: String(d.user).trim(), from: String(d.from).trim(), pass: d.pass || '' };
    req('PUT', '/mail/smtp', body).then(function (r) {
      S.cfg.mailOut = Object.assign({}, S.cfg.mailOut || {}, { smtp: r.smtp });
      MAIL.status = null; mailLoad();
      toast(r.mode === 'live' ? 'SMTP server saved – e-mails will now be delivered' : (r.missing.length ? 'Saved – still to fill in: ' + r.missing.join(', ') : 'Saved – this server runs in mock mode, so nothing is delivered'), r.mode === 'live' ? 'ok' : 'warn');
    }).catch(function (e) { toast(e.message, 'err'); });
  };
  ACT.smtpVerify = function () {
    toast('Connecting to the mail server…');
    req('POST', '/mail/smtp/verify', {}).then(function (r) {
      toast(r.mode === 'live' ? 'Connected and signed in to ' + r.server : 'Settings complete, but this server runs in mock mode (INTEGRATION_MODE=mock) – no connection made', r.mode === 'live' ? 'ok' : 'warn');
    }).catch(function (e) { toast(e.message, 'err'); });
  };
  ACT.mailRefresh = function () { MAIL.status = null; MAIL.inbox = null; MAIL.error = null; mailLoad(); render(); };

  CFG.mailIn = function () {
    var r = S.cfg.mailIn || {}, edit = can('configuration', 'E'), ready = mailReady();
    var brs = (S.branches || []).map(function (b) { return [b.id, b.name]; });
    var progs = (S.programs || []).map(function (p) { return [p.id, p.name]; });
    // Mailbox connection: the mailbox signed in under Email Outgoing (same username and app password), read over IMAP
    var inc = (ready && MAIL.status.incoming) || {};
    var incState = !inc.on ? bdg('Off – switch on “Import incoming e-mail” below', 'warn')
      : inc.mode !== 'live' ? bdg('Mock – the mailbox is not read on this server', 'warn')
      : inc.lastError ? bdg('Cannot read the mailbox', 'crit')
      : inc.connected ? bdg('Connected – checked every 5 minutes', 'ok') : bdg('Not checked yet – click Check now', 'info');
    var connBody = !ready ? emptyBox(MAIL.error ? 'Could not load' : 'Loading…', MAIL.error || '') : mailKV([
      ['Mailbox', inc.mailbox ? '<span class="mono sm">' + esc(inc.mailbox) + '</span><div class="muted xs">The mailbox signed in under Email Outgoing (same app password)</div>' : '<span class="sm" style="color:var(--crit)">Set up the SMTP server under Email Outgoing first</span>'],
      ['Server', inc.host ? '<span class="mono sm">' + esc(inc.host) + ':993</span> · IMAP over SSL' : '—'],
      ['Status', incState],
      ['Last check', inc.lastCheck ? fDT(inc.lastCheck) : '—'],
      ['Imported', inc.since ? inc.imported + ' e-mail' + (inc.imported === 1 ? '' : 's') + ' since ' + fDT(inc.since) : '—'],
    ].concat(inc.lastError ? [['Last error', '<span class="sm" style="color:var(--crit)">' + esc(inc.lastError) + '</span>']] : []));
    var conn = card('Mailbox connection', connBody, { act: edit && inc.on && inc.mailbox ? '<button class="btn sm" data-act="mailInCheck">' + ic('mail') + ' Check now</button>' : '' }) + '<div style="height:14px"></div>';
    var form = cfgForm('mailIn',
      swRow('Import incoming e-mail', 'on', !!r.on, 'Read new e-mails from the mailbox every 5 minutes and file them in the CRM') +
      swRow('Notify staff when an e-mail arrives', 'notify', r.notify !== false, 'The counsellor (leads) or the branch team (students) gets a CRM notification') +
      '<div class="fgrid" style="margin-top:12px">' +
      '<input type="hidden" name="mailbox" value="' + esc(inc.mailbox || r.mailbox || '') + '">' +
      F('E-mail from an unknown sender', 'unknown', { v: r.unknown || 'review', opts: [['review', 'Hold for review – notify the Admissions Head'], ['lead', 'Create a new lead'], ['ignore', 'Ignore']] }) +
      F('Branch for new leads', 'branch', { v: r.branch, opts: brs, blank: '— choose —', help: 'Used when unknown senders create a lead' }) +
      F('Programme for new leads', 'prog', { v: r.prog, opts: progs, blank: '— choose —' }) +
      F('Blocked senders', 'block', { t: 'textarea', rows: 4, v: (r.block || []).join('\n'), full: 1, ph: 'spam@example.com\n@marketing-company.com', help: 'One address or domain per line. E-mails from these senders are never filed.' }) + '</div>');
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
      (edit ? '<div style="height:14px"></div>' + card('Simulate an incoming e-mail', sim) : '') +
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
  ACT.mailInCheck = function () {
    toast('Checking the mailbox…');
    req('POST', '/mail/inbound/check', {})
      .then(function (r) {
        toast(r.message, r.status === 'error' ? 'err' : (r.status === 'ok' || r.status === 'started') ? 'ok' : 'warn');
        MAIL.inbox = null; MAIL.status = null; mailLoad();
        return r.imported ? reload(false) : null;
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

  // ------------------------------------------------------------------ E-mail: individual, bulk and automated
  // Send e-mail (Lead / Opportunity / Student pages), Bulk e-mail (Leads, Opportunities, Admissions, Students) and
  // Configuration → Email Automation. The server personalises each e-mail, checks branch access and consent,
  // records it on the history and sends it with the Email Outgoing rules.
  var MS = {};
  var MAIL_RES = { lead: 'leads', opp: 'opportunities', student: 'students' };
  var canMail = function (res) { return can(res, 'E') || can(res, 'C'); };
  var uniq = function (a) { return a.filter(function (x, i) { return x && a.indexOf(x) === i; }); };
  var latestEnr = function (stuId) { return (S.enr || []).filter(function (e) { return e.stu === stuId; }).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); })[0]; };
  var leadOf = function (id) { return (S.leads || []).find(function (l) { return l.id === id; }); };
  var MS_SRC = {
    leads: { label: 'Leads', type: 'lead', res: 'leads', list: function () { return S.leads || []; }, st: function (x) { return x.status; }, prog: function (x) { return x.prog; }, def: 'Open', stLabel: 'Status' },
    opps: { label: 'Opportunities', type: 'opp', res: 'opportunities', list: function () { return S.opps || []; }, st: function (x) { return x.stage; }, prog: function (x) { return x.prog; }, def: '', stLabel: 'Stage' },
    adm: { label: 'Admissions', type: 'opp', res: 'opportunities', list: function () { return (S.opps || []).filter(function (o) { return o.stage === 'Admission Decision'; }); }, st: function (x) { return x.decision || 'Pending'; }, prog: function (x) { return x.prog; }, def: '', stLabel: 'Decision' },
    students: { label: 'Students', type: 'student', res: 'students', list: function () { return S.students || []; }, st: function (x) { return x.status; }, prog: function (x) { var e = latestEnr(x.id); return e && e.prog; }, def: 'Active', stLabel: 'Status' },
  };
  // address the server will use, or '' (the server checks again, including consent and branch access)
  function msAddress(type, rec) {
    if (type === 'student') return ((rec.parents || [])[0] || {}).email || '';
    var l = type === 'opp' ? leadOf(rec.lead) : rec;
    if (!l || !l.email) return '';
    return (S.cfg.consentReq || {}).em && !l.em ? '' : l.email;
  }
  function msRecipients() {
    var recs;
    if (MS.fixed) recs = MS.fixed.map(function (t) { return { type: t.type, rec: t.type === 'lead' ? leadOf(t.id) : t.type === 'opp' ? (S.opps || []).find(function (o) { return o.id === t.id; }) : (S.students || []).find(function (s) { return s.id === t.id; }) }; }).filter(function (x) { return x.rec; });
    else {
      var src = MS_SRC[MS.src];
      recs = src.list().filter(function (x) { return (!MS.branch || x.branch === MS.branch) && (!MS.prog || src.prog(x) === MS.prog) && (!MS.status || src.st(x) === MS.status) && !x.test; })
        .map(function (x) { return { type: src.type, rec: x }; });
    }
    var ok = recs.filter(function (r) { return msAddress(r.type, r.rec); });
    return { targets: ok.map(function (r) { return { type: r.type, id: r.rec.id }; }), total: recs.length, noMail: recs.length - ok.length, recs: recs };
  }
  var recName = function (r) { return r.type === 'student' ? (r.rec.first + ' ' + r.rec.last) : (r.rec.student || r.rec.parent || r.rec.id); };
  function msOpen(o) {
    MS = Object.assign({ src: 'students', branch: '', prog: '', status: '', tpl: '', subject: '', body: '' }, o);
    if (!MS.fixed && MS_SRC[MS.src]) MS.status = MS_SRC[MS.src].def;
    openModal('mailSend', { noFocus: true });
  }
  ACT.mailOne = function (d) { msOpen({ fixed: [{ type: d.t, id: d.id }] }); };
  ACT.mailBulk = function (d) { msOpen({ src: d.src || 'students' }); };
  ACT.mailSel = function () { msOpen({ fixed: Object.keys(S_sel || {}).map(function (id) { return { type: 'lead', id: id }; }) }); };
  // Reply to a received e-mail (lead or student communication history): same conversation in the parent's mailbox
  window.mailReplyBtn = function (type, id, c, i) {
    if (!c || !c.inbound || c.ch !== 'Email' || !canMail(MAIL_RES[type])) return '';
    return '<div style="margin-top:6px"><button class="btn sm" type="button" data-act="mailReply" data-t="' + type + '" data-id="' + esc(id) + '"' +
      (type === 'student' ? ' data-i="' + i + '"' : ' data-c="' + esc(c.id) + '"') + '>' + ic('mail') + ' Reply</button>' +
      (c.repliedAt ? ' <span class="muted xs">Replied ' + fDT(c.repliedAt) + (c.repliedBy ? ' by ' + esc(c.repliedBy) : '') + '</span>' : '') + '</div>';
  };
  ACT.mailReply = function (d) {
    var c = null;
    if (d.t === 'student') { var s = (S.students || []).find(function (x) { return x.id === d.id; }); c = s && (s.comm || [])[+d.i]; }
    else c = (S.comms || []).find(function (x) { return x.id === d.c; });
    if (!c) { toast('That e-mail was not found – refresh the page', 'err'); return; }
    // braces would be read as placeholders, so the parent's own text keeps them as ( )
    var safe = function (x) { return String(x || '').replace(/[{}]/g, function (m) { return m === '{' ? '(' : ')'; }); };
    var subj = safe(c.subject || c.subj || '');
    var quoted = safe(c.text).split('\n').map(function (l) { return '> ' + l; }).join('\n');
    msOpen({
      fixed: [{ type: d.t, id: d.id }], subject: /^re:/i.test(subj) ? subj : 'Re: ' + subj,
      body: '\n\n\nOn ' + fDT(c.at) + ', ' + safe(c.from || '') + ' wrote:\n' + quoted,
      reply: { type: d.t, id: d.id, comm: d.t === 'lead' ? d.c : undefined, index: d.t === 'student' ? +d.i : undefined }, replyTo: c.from || '',
    });
  };
  CHG.msAud = function (el) { MS[el.name] = el.value; if (el.name === 'src') { MS.status = MS_SRC[el.value].def; MS.prog = ''; } render(); };
  CHG.msTpl = function (el) {
    var t = (S.cfg.emailTpls || []).find(function (x) { return x.id === el.value; });
    MS.tpl = el.value; if (t) { MS.subject = t.subject; MS.body = t.body; }
    render();
  };
  INP.msSubj = function (el) { MS.subject = el.value; };
  INP.msBody = function (el) { MS.body = el.value; };
  MODALS.mailSend = function () {
    var r = msRecipients(), meta = SERVER.emailTemplates || { placeholders: {} };
    var opt = function (v, label, cur) { return '<option value="' + esc(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + esc(label) + '</option>'; };
    var sel = function (name, label, cur, opts, chg) { return '<div class="f"><label for="ms_' + name + '">' + label + '</label><select id="ms_' + name + '" name="' + name + '" data-change="' + (chg || 'msAud') + '">' + opts.map(function (o) { return opt(o[0], o[1], cur); }).join('') + '</select></div>'; };
    var who;
    if (MS.fixed) {
      who = '<div class="f full"><label>To</label><div class="sm">' + (r.recs.length === 1
        ? esc(recName(r.recs[0])) + ' <span class="muted">· ' + esc((MS.reply && MS.replyTo) || msAddress(r.recs[0].type, r.recs[0].rec) || 'no e-mail address') + '</span>'
        : r.recs.length + ' selected ' + (r.recs[0] && r.recs[0].type === 'lead' ? 'leads' : 'records')) + '</div></div>';
    } else {
      var src = MS_SRC[MS.src], all = src.list();
      who = sel('src', 'Send to', MS.src, Object.keys(MS_SRC).filter(function (k) { return canMail(MS_SRC[k].res); }).map(function (k) { return [k, MS_SRC[k].label]; })) +
        sel('branch', 'Branch', MS.branch, [['', 'All branches']].concat((S.branches || []).filter(function (b) { return !isArchived(b); }).map(function (b) { return [b.id, b.name]; }))) +
        sel('prog', 'Programme', MS.prog, [['', 'All programmes']].concat((S.programs || []).map(function (p) { return [p.id, p.name]; }))) +
        sel('status', src.stLabel, MS.status, [['', 'Any']].concat(uniq(all.map(src.st)).sort().map(function (s) { return [s, s]; })));
    }
    var count = '<div class="banner" style="margin:4px 0 0">' + ic('mail') + '<span><b>' + r.targets.length + ' recipient' + (r.targets.length === 1 ? '' : 's') + '</b>' +
      (r.noMail ? ' · ' + r.noMail + ' without an e-mail address or consent will be skipped' : '') + '. Each person gets their own copy with their details filled in.</span></div>';
    var tpls = (S.cfg.emailTpls || []).filter(function (t) { return t.active; });
    var chips = Object.keys(meta.placeholders || {}).map(function (k) { return '<a class="chip" data-act="etIns" data-k="' + k + '" tabindex="0" title="' + esc(meta.placeholders[k].label) + '">{' + k + '}</a>'; }).join('');
    return { title: MS.reply ? 'Reply' : MS.fixed && r.recs.length === 1 ? 'Send e-mail' : 'Bulk e-mail', size: 'lg', form: 'mailSend',
      foot: '<button class="btn" type="button" data-act="closeModal">Cancel</button><button class="btn primary" type="submit" form="mform"' + (r.targets.length ? '' : ' disabled') + '>' + ic('mail') + ' Send to ' + r.targets.length + '</button>',
      body: '<div class="fgrid">' + who + '<div class="f full">' + count + '</div>' +
        sel('tpl', 'Template', MS.tpl, [['', 'No template – write your own']].concat(tpls.map(function (t) { return [t.id, t.cat + ' · ' + t.n]; })), 'msTpl') +
        F('Subject', 'subject', { v: MS.subject, req: 1, full: 1, inp: 'msSubj' }) +
        F('Message', 'body', { t: 'textarea', rows: 10, v: MS.body, req: 1, full: 1, inp: 'msBody', help: 'Placeholders such as {student_name} are filled in for each recipient.' }) +
        '<div class="f full"><label>Placeholders – click to insert at the cursor</label><div class="chips">' + chips + '</div></div></div>' };
  };
  SUB.mailSend = function (d, f) {
    if (!need(f, d, ['subject', 'body'])) return;
    var r = msRecipients();
    if (!r.targets.length) { toast('No recipients with an e-mail address', 'err'); return; }
    var t = (S.cfg.emailTpls || []).find(function (x) { return x.id === MS.tpl; });
    var btn = document.querySelector('.modal .mf .primary'); if (btn) btn.disabled = true;
    flush().then(function () { return req('POST', '/mail/compose', { targets: r.targets, template: t ? t.n : 'Composed e-mail', subject: d.subject, body: d.body, reply: MS.reply || undefined }); })
      .then(function (res) {
        closeModal();
        toast('E-mail sent to ' + res.queued + (res.skipped.length ? ' · ' + res.skipped.length + ' skipped (' + uniq(res.skipped.map(function (s) { return s.reason; })).join(', ') + ')' : ''), res.skipped.length ? 'warn' : 'ok');
        if (MS.fixed && MS.fixed[0] && MS.fixed[0].type === 'lead') S_sel = {};
        return reload(true);
      })
      .catch(function (e) { if (btn) btn.disabled = false; toast(e.message, 'err'); });
  };
  // Buttons on the record and list pages
  function mailButtons() {
    if (!S || !S.route) return;
    var rt = S.route, head = document.querySelector('#main .ph > .row') || document.querySelector('.ph > .row');
    var one = { lead: 'lead', opp: 'opp', student: 'student' }[rt.page];
    if (one && rt.id && canMail(MAIL_RES[one]) && !document.querySelector('[data-act=mailOne]')) {
      var btn = '<button class="btn" data-act="mailOne" data-t="' + one + '" data-id="' + esc(rt.id) + '">' + ic('mail') + ' Send e-mail</button>';
      // record pages without a page header (student, opportunity): at the end of the "List / ID" breadcrumb line
      var crumb = !head && Array.prototype.find.call(document.querySelectorAll('#main .muted.sm'), function (x) { return x.querySelector('a[data-act=go]') && x.textContent.indexOf(rt.id) >= 0; });
      if (head) head.insertAdjacentHTML('afterbegin', btn);
      else if (crumb) { crumb.style.cssText += ';display:flex;align-items:center;gap:8px'; crumb.insertAdjacentHTML('beforeend', '<span style="margin-left:auto">' + btn + '</span>'); }
    }
    if (head && !head.querySelector('[data-act=mailBulk]')) {
      var bulk = { leads: 'leads', opps: 'opps', admPipeline: 'adm', admDecisions: 'adm', students: 'students' }[rt.page];
      if (bulk && canMail(MS_SRC[bulk].res)) head.insertAdjacentHTML('afterbegin', '<button class="btn" data-act="mailBulk" data-src="' + bulk + '">' + ic('mail') + ' Bulk e-mail</button>');
    }
    if (rt.page === 'leads' && canMail('leads')) {
      var bar = Array.prototype.find.call(document.querySelectorAll('#main .tb'), function (x) { var b = x.querySelector('b'); return b && / selected$/.test(b.textContent); });
      if (bar && !bar.querySelector('[data-act=mailSel]')) bar.querySelector('b').insertAdjacentHTML('afterend', '<button class="btn sm" data-act="mailSel">' + ic('mail') + ' Send e-mail</button>');
    }
  }
  var _renderMail = window.render;
  window.render = function () { _renderMail.apply(this, arguments); try { mailButtons(); } catch (e) { /* buttons are optional */ } };

  // ---------------- Configuration → Email Automation
  CTABS.splice(CTABS.findIndex(function (t) { return t[0] === 'mailIn'; }) + 1, 0, ['mailAuto', 'Email Automation']);
  var MA = { log: null, loading: false };
  var MA_KINDS = [
    ['payRemind', 'Payment reminders', 'E-mails the parent before each instalment is due, and once when an instalment becomes overdue.'],
    ['birthday', 'Birthdays', 'Sends birthday wishes to the parents of active students on the birthday.'],
    ['welcome', 'Welcome', 'Welcomes the family after each new enrolment.'],
    ['quotation', 'Quotations', 'Sends the fee quotation (programme, package, total, valid 14 days) when an admission decision is Accepted.'],
    ['receipt', 'Receipt confirmations', 'Confirms each payment with the receipt in the e-mail and the invoice and receipt attached as PDFs (Lab of Future layout).'],
  ];
  function maLoad() {
    if (MA.loading) return; MA.loading = true;
    req('GET', '/mail/automation/log').then(function (r) { MA.log = r.items; }).catch(function (e) { MA.log = []; MA.error = e.message; }).then(function () { MA.loading = false; safeRender(); });
  }
  CFG.mailAuto = function () {
    var a = S.cfg.mailAuto || {}, edit = can('configuration', 'E');
    if (!MA.log && !MA.loading) maLoad();
    var names = uniq((S.cfg.emailTpls || []).filter(function (t) { return t.active; }).map(function (t) { return t.n; }));
    var tplSel = function (name, cur) { return F('Template', name, { v: cur, opts: uniq([cur].concat(names)) }); };
    var hours = []; for (var h = 0; h < 24; h++) hours.push([h, (h < 10 ? '0' : '') + h + ':00']);
    var blocks = MA_KINDS.map(function (k) {
      var v = a[k[0]] || {};
      var since = v.on && v.since ? ' Sending since ' + fDT(v.since) + '.' : '';
      return '<div class="sec" style="margin-top:14px">' + esc(k[1]) + '</div>' + swRow('Switched on', 'on_' + k[0], !!v.on, esc(k[2]) + since) +
        '<div class="fgrid" style="margin-top:8px">' + tplSel('tpl_' + k[0], v.tpl) +
        (k[0] === 'payRemind' ? F('Days before the due date', 'days', { v: (v.days || [3]).join(', '), help: 'Up to 5 values, for example 7, 3, 1' }) +
          '</div>' + swRow('Also send an overdue notice', 'overdue', v.overdue !== false, 'Once per instalment, after the payment term’s grace days') + '<div class="fgrid" style="margin-top:8px">' + tplSel('overdueTpl', v.overdueTpl) : '') + '</div>';
    }).join('');
    var form = cfgForm('mailAuto', '<div class="fgrid">' + F('Daily send time (Asia/Dubai)', 'hour', { v: a.hour, opts: hours, help: 'Payment reminders and birthday e-mails go out once a day from this time. Welcome, quotation and receipt e-mails go out within about 5 minutes.' }) + '</div>' + blocks);
    var log = !MA.log ? emptyBox(MA.error ? 'Could not load' : 'Loading…', MA.error || '') : MA.log.length ? table('maLog', [
      { h: 'When', f: function (i) { return fDT(i.at || i.receivedAt); }, s: function (i) { return i.at || i.receivedAt; } },
      { h: 'Automation', f: function (i) { return esc((MA_KINDS.find(function (k) { return k[0] === i.kind; }) || [0, i.kind])[1]); } },
      { h: 'Record', f: function (i) { return '<span class="mono xs">' + esc(i.ref || '') + '</span>'; } },
      { h: 'To', f: function (i) { return esc(i.to || '—'); } },
      { h: 'Template', f: function (i) { return esc(i.template || ''); } },
      { h: 'Result', f: function (i) { return bdg(i.status, i.status === 'Queued' ? 'ok' : /^Skipped/.test(i.status) ? 'warn' : ''); } },
    ], MA.log, { ps: 10 }) : emptyBox('No automated e-mails yet', 'Switch an automation on; what it sends appears here.');
    return '<div class="banner">' + ic('mail') + '<span>Automations start switched off. When you switch one on it only covers new events from that moment, so nothing older is sent. Each e-mail goes out once, uses the template you choose (Email Templates) and follows Email Outgoing.</span></div>' +
      card('Automated e-mails', edit ? form : emptyBox('View only', 'You need configuration edit access to change automations.')) + '<div style="height:14px"></div>' +
      card('Recent automated e-mails', log, { np: MA.log && MA.log.length ? 1 : 0, act: (edit ? '<button class="btn sm" data-act="mailAutoRun">Run now</button>' : '') + '<button class="btn sm ghost" data-act="mailAutoRefresh">Refresh</button>' });
  };
  SUB.cfg_mailAuto = function (d, f) {
    clearErrs(f);
    var days = String(d.days || '').split(/[,\s]+/).filter(Boolean).map(Number);
    if (!days.length || days.length > 5 || days.some(function (x) { return !Number.isInteger(x) || x < 0 || x > 60; })) { setErr(f, 'days', 'Up to 5 whole numbers from 0 to 60'); return; }
    var prev = S.cfg.mailAuto || {}, next = { hour: +d.hour };
    MA_KINDS.forEach(function (k) { next[k[0]] = Object.assign({}, prev[k[0]] || {}, { on: !!d['on_' + k[0]], tpl: d['tpl_' + k[0]] }); });
    Object.assign(next.payRemind, { days: days, overdue: !!d.overdue, overdueTpl: d.overdueTpl });
    var note = '';
    if (next.welcome.on) {
      // the automation replaces the Communication welcome e-mail, so families get one welcome, not two
      var t4 = (S.cfg.comms || []).find(function (t) { return t.id === 'T4' && t.ch === 'Email'; });
      if (t4 && t4.auto) { t4.auto = false; note = ' – the Communication “Enrolment welcome” e-mail is switched off so families get one welcome'; }
    }
    S.cfg.mailAuto = next;
    cfgSave('Email Automation', MA_KINDS.filter(function (k) { return next[k[0]].on; }).map(function (k) { return k[1]; }).join(', ') || 'all off');
    if (note) toast('Saved' + note, 'ok');
    flush().then(function () { return reload(true); });
  };
  ACT.mailAutoRefresh = function () { MA.log = null; MA.error = null; maLoad(); render(); };
  ACT.mailAutoRun = function () {
    flush().then(function () { return req('POST', '/mail/automation/run', {}); })
      .then(function (r) { toast(r.queued ? r.queued + ' automated e-mail' + (r.queued === 1 ? '' : 's') + ' sent' : 'Nothing to send right now', r.queued ? 'ok' : 'warn'); MA.log = null; maLoad(); })
      .catch(function (e) { toast(e.message, 'err'); });
  };


  // ------------------------------------------------------------------ conversation log (lead → Activities & Calls)
  // Staff record the context of any conversation with the family – a call, WhatsApp chat, walk-in visit, e-mail or
  // meeting: when, how, who they spoke with, what was discussed and the agreed next step (optionally with a follow-up
  // date, which becomes a follow-up task). Entries are lead timeline events (type "conv"), kept with the lead's history.
  (function () {
    var CH = ['Phone call', 'WhatsApp', 'Walk-in / visit', 'E-mail', 'Video meeting', 'Other'];
    var WITH = ['Parent', 'Student', 'Parent and student', 'Other family member', 'Other'];
    function nowLocal() { return new Date(Date.now() + 4 * 36e5).toISOString().slice(0, 16); } // Gulf time, as locIso() reads it
    function convs(l) { return (l.events || []).filter(function (e) { return e.type === 'conv' && e.conv; }).sort(function (a, b) { return new Date(b.conv.when || b.at) - new Date(a.conv.when || a.at); }); }
    window.convCard = function (l) {
      var rows = convs(l);
      var list = rows.length ? rows.map(function (e) {
        var c = e.conv;
        return '<div class="conv-it"><div class="conv-hd"><b>' + esc(c.ch) + '</b><span class="muted">with ' + esc(c.with) + '</span><span class="muted sm" style="margin-left:auto">' + fDT(c.when || e.at) + ' · ' + esc(e.by || '') + '</span></div>' +
          '<div class="conv-tx">' + esc(c.ctx) + '</div>' +
          (c.next ? '<div class="conv-nx"><span class="badge info">Next step</span> ' + esc(c.next) + (c.fu ? ' <span class="muted sm">· follow-up ' + fDT(c.fu) + '</span>' : '') + '</div>' : '') + '</div>';
      }).join('') : '<div class="empty"><b>No conversations logged yet</b><div class="muted">Use <b>Log conversation</b> to record what was discussed with the family.</div></div>';
      return card('Conversation log', '<div class="conv-list">' + list + '</div>', { act: '<button class="btn sm primary" data-act="convNew" data-id="' + esc(l.id) + '">' + ic('plus') + ' Log conversation</button>' }) + '<div style="height:14px"></div>';
    };
    ACT.convNew = function (d) { openModal('convLog', { id: d.id }); };
    MODALS.convLog = function (m) {
      var l = leadById(m.id);
      return { title: 'Log conversation – ' + l.student, form: 'convLog', ok: 'Save conversation', body:
        '<input type="hidden" name="id" value="' + esc(l.id) + '"><div class="row" style="margin-bottom:12px"><span class="mono">' + esc(l.phone) + '</span><span class="muted sm">' + esc(l.parent) + '</span></div>' +
        '<div class="fgrid">' + F('How did you talk?', 'ch', { opts: CH, v: 'Phone call', req: 1 }) + F('Spoke with', 'with', { opts: WITH, v: 'Parent', req: 1 }) +
        F('When', 'when', { t: 'datetime-local', v: nowLocal(), req: 1 }) +
        F('Context of the conversation', 'ctx', { t: 'textarea', full: 1, req: 1, help: 'What was discussed – the family’s needs, questions, concerns, interest level and anything agreed.' }) +
        F('Next step (optional)', 'next', { full: 1, help: 'e.g. Send fee details on WhatsApp, book a trial class on Saturday.' }) +
        F('Follow-up date (optional)', 'fu', { t: 'datetime-local', help: 'Creates a follow-up call on the calendar.' }) + '</div>' };
    };
    SUB.convLog = function (d, f) {
      if (!need(f, d, ['ch', 'with', 'when', 'ctx'])) return;
      var ctx = String(d.ctx).trim(), next = String(d.next || '').trim();
      if (ctx.length < 5) { setErr(f, 'ctx', 'Please describe the conversation'); return; }
      if (ctx.length > 4000) { setErr(f, 'ctx', 'Keep it under 4,000 characters'); return; }
      var when = locIso(d.when);
      if (!when || isNaN(new Date(when)) || new Date(when) > new Date(Date.now() + 5 * 6e4)) { setErr(f, 'when', 'The conversation date cannot be in the future'); return; }
      var fu = d.fu ? locIso(d.fu) : null;
      if (fu && new Date(fu) < new Date()) { setErr(f, 'fu', 'The follow-up must be in the future'); return; }
      var l = leadById(d.id);
      l.events.push({ at: nowIso(), type: 'conv', by: me().name, text: 'Conversation (' + d.ch + ', with ' + d['with'] + '): ' + ctx + (next ? ' · Next step: ' + next : ''),
        conv: { ch: d.ch, with: d['with'], when: when, ctx: ctx, next: next, fu: fu } });
      l.last = nowIso();
      if (fu) { S.tasks.push({ id: 'T-' + (S.seq.task++), lead: l.id, cslr: fuOwner(l), due: fu, type: 'Follow-up call', status: 'Pending', remarks: next ? 'From conversation: ' + next : 'From conversation log', outcome: '', next: '' }); syncNext(l); }
      addAudit('Conversation logged', l.id, d.ch + ' with ' + d['with']);
      closeModal(); toast('Conversation logged' + (fu ? ' – follow-up added to the calendar' : ''), 'ok');
    };
  })();

  // ------------------------------------------------------------------ page motion (LOF style guide)
  // Like the Student Learning Hub: when the page (or a record tab) changes, the blocks of the new page rise into place
  // one after another (direction follows the sidebar order), KPI figures count up, and the sidebar highlight glides
  // from the old item to the new one. Ordinary re-renders (typing, filters) do not animate. Off with reduced motion.
  (function () {
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var lastKey = null, lastIdx = -1, lastTop = null;
    function routeKey() { return S && S.route ? JSON.stringify(S.route) + '|' + (S.tab || '') + '|' + (S.stuTab || '') : null; }
    function glide(nav, animate) {
      var on = nav.querySelector('a.it.on');
      var ind = document.createElement('div'); ind.className = 'nav-ind'; nav.insertBefore(ind, nav.firstChild); nav.classList.add('glide');
      if (!on) { ind.style.opacity = 0; lastTop = null; return; }
      var top = on.offsetTop, h = on.offsetHeight;
      ind.style.height = h + 'px';
      if (animate && lastTop !== null && lastTop !== top) {
        ind.style.transition = 'none'; ind.style.transform = 'translateY(' + lastTop + 'px)';
        requestAnimationFrame(function () { requestAnimationFrame(function () { ind.style.transition = ''; ind.style.transform = 'translateY(' + top + 'px)'; }); });
      } else ind.style.transform = 'translateY(' + top + 'px)';
      lastTop = top;
    }
    function countUp(el) {
      var node = [].slice.call(el.childNodes).find(function (n) { return n.nodeType === 3 && /\d/.test(n.textContent); });
      if (!node) return; var raw = node.textContent, m = raw.match(/^(\D*)([\d,]+(?:\.\d+)?)(.*)$/); if (!m) return;
      var target = parseFloat(m[2].replace(/,/g, '')); if (!isFinite(target) || target === 0) return;
      var dec = (m[2].split('.')[1] || '').length, start = performance.now(), dur = 700;
      (function step(t) {
        if (!document.body.contains(node)) return;
        var p = Math.min((t - start) / dur, 1), e = 1 - Math.pow(1 - p, 3), v = target * e;
        node.textContent = m[1] + (dec ? v.toFixed(dec) : Math.round(v).toLocaleString('en-IN')) + m[3];
        if (p < 1) requestAnimationFrame(step); else node.textContent = raw;
      })(start);
    }
    var _renderMotion = window.render;
    window.render = function () {
      _renderMotion.apply(this, arguments);
      try {
        var nav = document.querySelector('.shell .nav'); if (!nav) { lastKey = null; return; }
        var key = routeKey(), changed = key !== lastKey && lastKey !== null, first = lastKey === null; lastKey = key;
        var items = [].slice.call(nav.querySelectorAll('a.it')), idx = items.findIndex(function (a) { return a.classList.contains('on'); });
        glide(nav, changed && !reduce);
        if ((!changed && !first) || reduce) { lastIdx = idx; return; }
        var main = document.getElementById('main'); if (!main) return;
        main.style.setProperty('--dir', idx >= 0 && lastIdx >= 0 && idx < lastIdx ? -1 : 1); lastIdx = idx;
        var i = 0;
        main.querySelectorAll('.tabs, .ph, .banner, .kpis > *, .grid > *, #main > .card, .content > .card, .tbl tbody tr').forEach(function (el) {
          if (el.closest('.tbl') && i > 14) return; // long tables: only the first rows take part
          el.style.setProperty('--d', Math.min(i++, 14)); el.classList.add('lof-enter');
        });
        main.querySelectorAll('.kpi .v').forEach(countUp);
      } catch (e) { /* motion is decoration only */ }
    };
  })();

  // ------------------------------------------------------------------ appreciation (LOF style guide, like the Hub's XP award)
  // A short celebration card – rocket lift-off, progress ring, count-up and stardust – when a student is enrolled, and a
  // bigger one when a counsellor reaches the monthly enrolment target or a receptionist reaches the monthly collections
  // target. Click or wait ~2.5 s to close; a "+1" chip then flies to the user's avatar. Reduced motion: a toast instead.
  (function () {
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var C = 263.9, layer = null, queue = [], busy = false;
    var ROCKET = '<svg class="xc-rocket" viewBox="0 0 60 122" aria-hidden="true"><path d="M30 4C42 16 46 34 46 56v28H14V56C14 34 18 16 30 4z"/><circle cx="30" cy="42" r="7"/><path d="M14 70h32M14 62 4 84v12l10-8M46 62l10 22v12l-10-8M22 84l2 8h12l2-8M26 98l-2 14M30 98v20M34 98l2 14"/></svg>';
    function fmt(n) { return Math.round(n).toLocaleString('en-IN'); }
    function countTo(el, from, to, dur, f) { var s = performance.now(); (function step(t) { var p = Math.min((t - s) / dur, 1), e = 1 - Math.pow(1 - p, 3); el.textContent = (f || fmt)(from + (to - from) * e); if (p < 1) requestAnimationFrame(step); })(s); }
    function stardust(canvas, cx, cy, big) {
      var dpr = window.devicePixelRatio || 1, ctx = canvas.getContext('2d');
      canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var colors = ['#D53A28', '#D53A28', '#E8604F', '#3A66C4', '#7BA2EA', '#FFFFFF'];
      var parts = [];
      for (var i = 0; i < (big ? 160 : 90); i++) { var a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * (big ? 9 : 7); parts.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.2, r: 1 + Math.random() * 2.2, c: colors[i % colors.length], streak: Math.random() < .35, life: 1, decay: .010 + Math.random() * .012 }); }
      (function frame() {
        ctx.clearRect(0, 0, innerWidth, innerHeight); var alive = 0;
        parts.forEach(function (p) {
          if (p.life <= 0) return; alive++;
          p.x += p.vx; p.y += p.vy; p.vx *= .955; p.vy = p.vy * .955 + .06; p.life -= p.decay;
          ctx.globalAlpha = Math.max(0, p.life); ctx.strokeStyle = ctx.fillStyle = p.c;
          if (p.streak) { ctx.lineWidth = p.r * .9; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 3, p.y - p.vy * 3); ctx.stroke(); }
          else { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
        });
        ctx.globalAlpha = 1; if (alive) requestAnimationFrame(frame); else ctx.clearRect(0, 0, innerWidth, innerHeight);
      })();
    }
    // o: { label, num, numFrom, unit, title, sub, from, to (ring %), ringText, big, chip }
    function show(o) {
      if (reduceMotion) { toast(o.label + ' – ' + o.title, 'ok'); next(); return; }
      if (!layer) {
        layer = document.createElement('div'); layer.className = 'xc-layer';
        layer.innerHTML = '<div class="xc-scrim"></div><canvas class="xc-dust"></canvas><div class="xc-card" role="status" aria-live="polite">' + ROCKET +
          '<div class="xc-ring"><svg viewBox="0 0 96 96"><circle class="t" cx="48" cy="48" r="42"/><circle class="f" cx="48" cy="48" r="42"/></svg><b class="xc-pct"></b></div>' +
          '<div class="xc-label"></div><div class="xc-amount"><span class="xc-pre"></span><span class="xc-num">0</span><small class="xc-unit"></small></div><div class="xc-sub"></div></div>';
        document.body.appendChild(layer);
      }
      var L = layer, ring = L.querySelector('.f');
      L.classList.toggle('big', !!o.big);
      L.querySelector('.xc-label').textContent = o.label;
      L.querySelector('.xc-pre').textContent = o.pre || '';
      L.querySelector('.xc-unit').textContent = o.unit || '';
      L.querySelector('.xc-sub').innerHTML = '<div style="font-weight:600;color:#fff">' + esc(o.title) + '</div>' + (o.sub ? '<div style="margin-top:2px">' + esc(o.sub) + '</div>' : '');
      ring.style.transition = 'none'; ring.style.strokeDashoffset = C * (1 - o.from / 100);
      var pctEl = L.querySelector('.xc-pct'); pctEl.textContent = o.ringText ? '' : Math.round(o.from) + '%';
      L.querySelector('.xc-num').textContent = fmt(o.numFrom || 0);
      L.classList.remove('on', 'out'); void L.offsetWidth; L.classList.add('on');
      setTimeout(function () {
        ring.style.transition = ''; ring.style.strokeDashoffset = C * (1 - Math.min(100, o.to) / 100);
        countTo(L.querySelector('.xc-num'), o.numFrom || 0, o.num, 650);
        if (o.ringText) pctEl.textContent = o.ringText;
        else { var s0 = performance.now(); (function step(t) { var p = Math.min((t - s0) / 1200, 1), e = 1 - Math.pow(1 - p, 3); pctEl.textContent = Math.round(o.from + (Math.min(100, o.to) - o.from) * e) + '%'; if (p < 1) requestAnimationFrame(step); })(s0); }
        var r = L.querySelector('.xc-card').getBoundingClientRect();
        stardust(L.querySelector('.xc-dust'), r.left + r.width / 2, r.top + 74, o.big);
        if (o.big) setTimeout(function () { stardust(L.querySelector('.xc-dust'), r.left + r.width / 2, r.top + 74, true); }, 700);
      }, 260);
      var done = false, timer;
      function close() {
        if (done) return; done = true; clearTimeout(timer);
        var av = document.querySelector('.shell .avatar');
        if (av && o.chip) {
          var card = L.querySelector('.xc-card').getBoundingClientRect(), to = av.getBoundingClientRect();
          var chip = document.createElement('div'); chip.className = 'xc-fly'; chip.textContent = o.chip; document.body.appendChild(chip);
          var cw = chip.offsetWidth, ch = chip.offsetHeight, sx = card.left + card.width / 2 - cw / 2, sy = card.top + card.height / 2 - ch / 2, ex = to.left + to.width / 2 - cw / 2, ey = to.top + to.height / 2 - ch / 2;
          chip.style.left = sx + 'px'; chip.style.top = sy + 'px';
          chip.animate([{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: 'translate(' + (ex - sx) * .55 + 'px,' + ((ey - sy) * .35 - 40) + 'px) scale(1.05)', opacity: 1, offset: .5 }, { transform: 'translate(' + (ex - sx) + 'px,' + (ey - sy) + 'px) scale(.6)', opacity: .2 }],
            { duration: 700, easing: 'cubic-bezier(.5,0,.25,1)' }).onfinish = function () { chip.remove(); av.classList.remove('xc-pulse'); void av.offsetWidth; av.classList.add('xc-pulse'); };
        }
        L.classList.add('out');
        setTimeout(function () { L.classList.remove('on', 'out'); next(); }, 420);
      }
      timer = setTimeout(close, o.big ? 3400 : 2600);
      L.onclick = close;
    }
    function next() { if (queue.length) { busy = true; show(queue.shift()); } else busy = false; }
    window.lofCelebrate = function (o) { queue.push(o); if (!busy) next(); };

    // ---- reception targets (collections recorded by the receptionist, in their branch currency, excluding cancelled)
    function recFor(c, m) { return (S.cfg.recTargets || []).find(function (t) { return t.c === c && t.m === m; }); }
    function recAch(c, m) {
      var st = S.staff.find(function (s) { return s.id === c; }), cur = st ? brCur(st.branch) : 'AED';
      return r2(S.pay.filter(function (p) { return p.by === c && p.status !== 'Cancelled' && p.cur === cur && String(p.at).slice(0, 7) === m; }).reduce(function (a, p) { return a + (+p.amt || 0); }, 0));
    }
    window.recFor = recFor; window.recAch = recAch;
    var _cfgTargets = CFG.targets;
    CFG.targets = function () {
      var html = _cfgTargets.apply(this, arguments);
      var m = S.tgtMonth || curMonth(), rs = S.staff.filter(function (s) { return s.role === 'Reception' && s.status === 'Active'; });
      var rows = rs.map(function (s) {
        var t = recFor(s.id, m), a = recAch(s.id, m), cur = brCur(s.branch);
        return '<tr><td><b>' + esc(s.name) + '</b><div class="muted xs">' + esc(branchName(s.branch)) + '</div></td><td><input name="c_' + s.id + '" type="number" min="0" step="1" value="' + (t ? t.col : '') + '" aria-label="Collections target ' + esc(s.name) + '" style="width:120px"> <span class="muted xs">' + cur + '</span></td>' +
          '<td class="r num">' + money(a, cur) + ' ' + (t && t.col ? achB(a, t.col) : '') + '</td></tr>';
      }).join('') || '<tr><td colspan="3" class="muted">No active receptionists</td></tr>';
      return html + '<div style="height:14px"></div>' + card('Reception targets – ' + esc(monthName(m)),
        cfgForm('recTargets', '<input type="hidden" name="m" value="' + m + '"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Receptionist</th><th>Collections target</th><th class="r">Collected</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
          '<p class="muted xs">Achievement: payments the receptionist recorded in the month, in their branch currency (cancelled payments excluded). Reaching the target shows an appreciation on their screen.</p>', { ok: 'Save reception targets' }));
    };
    SUB.cfg_recTargets = function (d) {
      var m = d.m, T = S.cfg.recTargets || (S.cfg.recTargets = []);
      var rs = S.staff.filter(function (s) { return s.role === 'Reception' && s.status === 'Active'; });
      for (var i = 0; i < rs.length; i++) { var v = d['c_' + rs[i].id]; if (v !== '' && v != null && !(+v >= 0)) { toast('Check the collections target for ' + rs[i].name, 'err'); return; } }
      rs.forEach(function (s) {
        var v = d['c_' + s.id], k = T.findIndex(function (t) { return t.m === m && t.c === s.id; });
        if (v === '' || v == null) { if (k >= 0) T.splice(k, 1); return; }
        var row = { m: m, c: s.id, col: +v }; if (k >= 0) T[k] = row; else T.push(row);
      });
      cfgSave('Reception targets', monthName(m));
    };

    function progName(id) { var p = (S.programs || []).find(function (x) { return x.id === id; }); return p ? p.name : ''; }
    function receptionTargetCheck(before) {
      var u = me(); if (!u || u.role !== 'Reception') return;
      var m = curMonth(), t = recFor(u.id, m); if (!t || !t.col) return;
      var after = recAch(u.id, m), cur = brCur(u.branch);
      if (before < t.col && after >= t.col) lofCelebrate({ big: 1, label: 'Target achieved', pre: '', num: after, numFrom: before, unit: ' ' + cur, title: 'Collections target reached for ' + monthName(m), sub: money(after, cur) + ' of ' + money(t.col, cur) + ' – brilliant work!', from: Math.min(100, before / t.col * 100), to: 100, ringText: '100%', chip: 'Target!' });
    }

    // ---- student enrolled: from "Complete enrolment"
    var _wizFin = SUB.wizFinish;
    SUB.wizFinish = function (d, f) {
      var n0 = S.enr.length, u = me(), m = curMonth();
      var ct = u && u.role === 'Counsellor' ? tgtFor(u.id, m) : null, a0 = ct ? tgtAch(u.id, m).enr : 0;
      var rb = u && u.role === 'Reception' ? recAch(u.id, m) : 0;
      var r = _wizFin.apply(this, arguments);
      try {
        if (S.enr.length > n0) {
          var e = S.enr[S.enr.length - 1], s = stuById(e.stu), name = s ? s.first + ' ' + s.last : e.stu;
          if (ct && ct.enr) {
            var a1 = tgtAch(u.id, m).enr;
            lofCelebrate({ label: 'Enrolment complete', pre: '+', num: 1, unit: ' student', title: name + ' – ' + progName(e.prog), sub: a1 + ' of ' + ct.enr + ' enrolments this month', from: Math.min(100, a0 / ct.enr * 100), to: a1 / ct.enr * 100, chip: '+1 enrolment' });
            if (a0 < ct.enr && a1 >= ct.enr) lofCelebrate({ big: 1, label: 'Target achieved', num: a1, numFrom: a0, unit: ' / ' + ct.enr, title: 'Enrolment target reached for ' + monthName(m), sub: 'Every enquiry, from first call to first class – brilliant work!', from: Math.min(100, a0 / ct.enr * 100), to: 100, ringText: '100%', chip: 'Target!' });
          } else {
            lofCelebrate({ label: 'Enrolment complete', pre: '+', num: 1, unit: ' student', title: name + ' – ' + progName(e.prog), sub: 'Welcome to Lab of Future!', from: 0, to: 100, ringText: '✓', chip: '+1 enrolment' });
          }
          receptionTargetCheck(rb);
        }
      } catch (x) { /* appreciation is decoration only */ }
      return r;
    };
    // ---- payment recorded at the front desk: celebrate when a receptionist reaches the collections target
    var _payF = SUB.pay;
    SUB.pay = function () {
      var u = me(), rb = u && u.role === 'Reception' ? recAch(u.id, curMonth()) : 0, n0 = S.pay.length;
      var r = _payF.apply(this, arguments);
      try { if (S.pay.length > n0) receptionTargetCheck(rb); } catch (x) { /* decoration only */ }
      return r;
    };
  })();

  // ------------------------------------------------------------------ go
  var _closeModal = window.closeModal;
  window.closeModal = function () { _closeModal(); if (deferredRender) { deferredRender = false; render(); } };
  req('GET', '/auth/session').then(function (r) { if (r.signedIn) afterAuth(r.stage); else loginScreen(); }).catch(function () { loginScreen(); });
})();
