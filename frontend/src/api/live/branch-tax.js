// ---------------- Branch GST (Configuration → Branches) – GSTIN, PAN, CGST %, SGST % for the tax invoice
// Only those who can edit configuration (System Administrator by default) can change a branch. When CGST and
// SGST are set, new fees for that branch are charged at CGST + SGST (calcFee) and the invoice shows both lines.
function branchGst(b) {
  var has = function (v) {
    return v !== undefined && v !== null && v !== '' && isFinite(Number(v));
  };
  if (!b || !has(b.cgst) || !has(b.sgst) || Number(b.cgst) + Number(b.sgst) <= 0) return null;
  return { cgst: Number(b.cgst), sgst: Number(b.sgst) };
}
var brOf = function (f) {
  return (
    f &&
    (S.branches || []).find(function (b) {
      return b.id === f.branch;
    })
  );
};
window.feeTaxPct = function (f) {
  var g = branchGst(brOf(f));
  return g ? Math.round((g.cgst + g.sgst) * 100) / 100 : Number(f.tax) || 0;
};
window.feeTaxLabel = function (f) {
  var g = branchGst(brOf(f));
  return g ? 'GST ' + window.feeTaxPct(f) + '% (CGST ' + g.cgst + '% + SGST ' + g.sgst + '%)' : 'Tax (' + f.tax + '%)';
};
function gstProblemUi(d) {
  var gstin = String(d.gstin || '')
      .trim()
      .toUpperCase(),
    pan = String(d.pan || '')
      .trim()
      .toUpperCase();
  if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin))
    return ['gstin', 'GSTIN must be 15 characters, e.g. 29ABCDE1234F1Z5'];
  if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) return ['pan', 'PAN must be 10 characters, e.g. ABCDE1234F'];
  if (gstin && pan && gstin.slice(2, 12) !== pan)
    return ['pan', 'Does not match the PAN inside the GSTIN (characters 3–12)'];
  var c = String(d.cgst == null ? '' : d.cgst).trim(),
    s = String(d.sgst == null ? '' : d.sgst).trim();
  if ((c === '') !== (s === '')) return [c === '' ? 'cgst' : 'sgst', 'Enter both CGST and SGST, or neither'];
  if (c !== '' && !(+c >= 0 && +c <= 50)) return ['cgst', 'A percentage from 0 to 50'];
  if (s !== '' && !(+s >= 0 && +s <= 50)) return ['sgst', 'A percentage from 0 to 50'];
  return null;
}
var _brModal = MODALS.branch;
MODALS.branch = function (m) {
  var x = _brModal(m),
    b = m.id
      ? (S.branches || []).find(function (y) {
          return y.id === m.id;
        }) || {}
      : {};
  var num = function (v) {
    return v === undefined || v === null ? '' : v;
  };
  var gst =
    '<div class="sec">GST – printed on the tax invoice (India)</div>' +
    F('GSTIN', 'gstin', { v: b.gstin || '', ph: '29ABCDE1234F1Z5', help: '15-character GST number' }) +
    F('PAN', 'pan', { v: b.pan || '', ph: 'ABCDE1234F', help: '10-character PAN' }) +
    '<div></div>' +
    F('Central GST – CGST %', 'cgst', { t: 'number', min: 0, max: 50, step: '0.01', v: num(b.cgst), help: 'e.g. 9' }) +
    F('State GST – SGST %', 'sgst', { t: 'number', min: 0, max: 50, step: '0.01', v: num(b.sgst), help: 'e.g. 9' }) +
    '<div></div>' +
    '<div class="f full"><p class="muted xs" style="margin:0">When CGST and SGST are set, new fees at this branch are charged at CGST + SGST and the invoice shows both lines with the GSTIN and PAN. Enrolments already made keep the tax they were charged. Leave empty for branches without GST (UAE VAT keeps using the fee\'s tax %).</p></div>';
  x.body = x.body.replace(
    '<div class="sec">Programmes offered</div>',
    gst + '<div class="sec">Programmes offered</div>',
  );
  return x;
};
var _brSub = SUB.branch;
SUB.branch = function (d, f) {
  var bad = gstProblemUi(d);
  if (bad) {
    clearErrs(f);
    setErr(f, bad[0], bad[1]);
    return;
  }
  var id = String(d.oid || d.id || '').toUpperCase();
  _brSub(d, f);
  var b = (S.branches || []).find(function (y) {
    return y.id === id;
  });
  if (!b || S.modal) return; // the form is still open: the branch was not saved
  var n = function (v) {
    v = String(v == null ? '' : v).trim();
    return v === '' ? null : Math.round(Number(v) * 100) / 100;
  };
  b.gstin = String(d.gstin || '')
    .trim()
    .toUpperCase();
  b.pan = String(d.pan || '')
    .trim()
    .toUpperCase();
  b.cgst = n(d.cgst);
  b.sgst = n(d.sgst);
  render();
};
