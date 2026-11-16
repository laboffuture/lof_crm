// Invoice and receipt for a payment: the layout parents receive after paying (PDF attachments and the e-mail body)
// and the printable copy staff open from Payments. The invoice covers the enrolment (fee lines, tax, paid, due);
// the receipt confirms one payment with the payment history up to it. Both carry the Lab of Future logo.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Repo } from '../lib/db';
import { r2 } from './core';
import { instStatus } from './terms';
import { LOF_LOGO_PNG_B64, LOF_LOGO_SIZE } from '../assets/lof-logo';

export interface DocLine { desc: string; sub?: string; qty: number; unit: number; amount: number }
export interface BillingDoc {
  invoiceNo: string; receiptNo: string; issued: string; paidAt: string; due: string | null;
  cur: string; lines: DocLine[]; subtotal: number; taxLabel: string; tax: number; total: number;
  amountPaid: number; paidToDate: number; amountDue: number;
  from: { name: string; lines: string[] }; billTo: { name: string; lines: string[] };
  history: { method: string; at: string; amount: number; receiptNo: string }[];
  student: string; studentId: string; enrolmentId: string; paymentId: string;
}

const day = (iso: string) => new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Dubai' });
export const docMoney = (n: number, cur: string) => `${cur || 'AED'} ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const real = (s: unknown) => { const v = clean(s); return v && v !== '—' && v !== '-' ? v : ''; };

/** Everything the invoice and receipt show for one payment (as it stood when that payment was made). */
export async function loadBillingDoc(repo: Repo, paymentId: string): Promise<BillingDoc | null> {
  const p = await repo.get<any>('payment', paymentId);
  if (!p) return null;
  const [e, s, b, programs, cfg] = await Promise.all([
    p.enr ? repo.get<any>('enrollment', p.enr) : null, p.stu ? repo.get<any>('student', p.stu) : null,
    repo.get<any>('branch', p.branch), repo.many<any>('program'), repo.setting<any>('cfg'),
  ]);
  const cur = p.cur || e?.cur || 'AED';
  const progName = (programs.find((x) => x.id === e?.prog) || { name: e?.prog || 'Programme' }).name;
  const enrolLine = [real(e?.pkg), e?.id ? 'Enrolment ' + e.id : ''].filter(Boolean).join(' · ');

  // Fee lines from the enrolment; an enrolment without a breakdown is one line for its total before tax
  const total = r2(+e?.total || +p.amt || 0), tax = r2(+e?.tax || 0);
  const lines: DocLine[] = [];
  if (e && +e.fee > 0) {
    lines.push({ desc: progName, sub: enrolLine, qty: 1, unit: r2(+e.fee), amount: r2(+e.fee) });
    if (+e.reg > 0) lines.push({ desc: 'Registration fee', sub: 'New students', qty: 1, unit: r2(+e.reg), amount: r2(+e.reg) });
    if (+e.disc > 0) {
      const d = e.discInfo || {};
      lines.push({ desc: 'Discount', sub: real(d.name || d.reason) || (d.type === '%' ? `${d.value}%` : ''), qty: 1, unit: -r2(+e.disc), amount: -r2(+e.disc) });
    }
  } else {
    lines.push({ desc: progName, sub: enrolLine, qty: 1, unit: r2(total - tax), amount: r2(total - tax) });
  }
  const subtotal = r2(lines.reduce((a, l) => a + l.amount, 0));
  const country = String(b?.country || '').toLowerCase();
  const rate = subtotal > 0 && tax > 0 ? Math.round((tax / subtotal) * 1000) / 10 : 0;
  const taxLabel = `${country.startsWith('ind') || cur === 'INR' ? 'GST' : 'VAT'}${rate ? ' ' + rate + '%' : ''}`;

  // Payments on this enrolment up to and including this one
  const all = e ? await repo.many<any>('payment', 'ref1=?', [e.id]) : [p];
  const upto = all.filter((x) => (x.at || '') < (p.at || '') || (x.at === p.at && x.id <= p.id) || x.id === p.id)
    .sort((a, c) => String(a.at).localeCompare(String(c.at)) || String(a.id).localeCompare(String(c.id)));
  const paidToDate = r2(upto.reduce((a, x) => a + (+x.amt || 0), 0));
  const amountDue = Math.max(0, r2(total - paidToDate));

  // Next instalment due after this payment (or the enrolment date when there is no schedule)
  let due: string | null = null;
  if (amountDue > 0.005 && e) {
    const term = (cfg?.payTerms || []).find((t: any) => t.id === e.term);
    const next = instStatus({ ...e, paid: paidToDate }, term, new Date().toISOString().slice(0, 10)).find((i: any) => i.bal > 0.005);
    due = next?.due || e.date || null;
  }

  const parent = (s?.parents || [])[0] || {};
  const studentName = s ? clean(`${s.first || ''} ${s.last || ''}`) : '';
  const cityLine = [real(b?.city), real(b?.country)].filter(Boolean).join(', ');
  return {
    invoiceNo: e?.id ? 'INV-' + String(e.id).replace(/^EN-/, '') : 'INV-' + p.id, receiptNo: p.rc || p.id,
    issued: e?.date || p.at, paidAt: p.at, due, cur, lines, subtotal, taxLabel, tax, total,
    amountPaid: r2(+p.amt || 0), paidToDate, amountDue,
    from: { name: 'Lab of Future', lines: [real(b?.name) ? clean(b.name) + ' branch' : '', real(b?.address), cityLine !== real(b?.address) ? cityLine : '', real(b?.phone), real(b?.email)].filter(Boolean) },
    billTo: { name: real(parent.name) || studentName || 'Parent / guardian', lines: [real(parent.email), real(parent.mobile), studentName ? `Student: ${studentName} (${s.id})` : ''].filter(Boolean) },
    history: upto.map((x) => ({ method: clean(x.method) + (real(x.ref) && !/^(cash)$/i.test(clean(x.method)) ? ' · ' + clean(x.ref) : ''), at: x.at, amount: r2(+x.amt || 0), receiptNo: x.rc || x.id })),
    student: studentName, studentId: s?.id || p.stu || '', enrolmentId: e?.id || '', paymentId: p.id,
  };
}

// ------------------------------------------------------------------------------------------------ PDF
const INK = rgb(0.06, 0.09, 0.16), MUTED = rgb(0.38, 0.42, 0.48), RULE = rgb(0.86, 0.88, 0.91);
const W = 595.28, H = 841.89, L = 48, R = W - 48;

/** Draws one invoice or receipt page in the agreed layout. */
async function renderPdf(d: BillingDoc, kind: 'invoice' | 'receipt'): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${kind === 'invoice' ? 'Invoice ' + d.invoiceNo : 'Receipt ' + d.receiptNo} – Lab of Future`);
  pdf.setAuthor('Lab of Future'); pdf.setCreator('Lab of Future CRM'); pdf.setProducer('Lab of Future CRM');
  const page = pdf.addPage([W, H]);
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(Uint8Array.from(atob(LOF_LOGO_PNG_B64), (ch) => ch.charCodeAt(0)));

  // Standard PDF fonts cover Western characters only; anything else prints as "?"
  const ok = new Map<string, boolean>();
  const fit = (f: PDFFont, s: string) => [...s].map((ch) => {
    if (!ok.has(ch)) { try { f.widthOfTextAtSize(ch, 10); f.encodeText(ch); ok.set(ch, true); } catch { ok.set(ch, false); } }
    return ok.get(ch) ? ch : '?';
  }).join('');
  const text = (p: PDFPage, s: string, x: number, y: number, o: { f?: PDFFont; size?: number; color?: any; right?: boolean; max?: number } = {}) => {
    const f = o.f || reg, size = o.size || 9.5;
    let t = fit(f, s);
    if (o.max) while (t.length > 1 && f.widthOfTextAtSize(t, size) > o.max) t = t.slice(0, -2) + '…';
    p.drawText(t, { x: o.right ? x - f.widthOfTextAtSize(t, size) : x, y, size, font: f, color: o.color || INK });
  };
  const rule = (y: number, x1 = L, x2 = R, t = 0.6, color = RULE) => page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: t, color });

  // Title and logo
  text(page, kind === 'invoice' ? 'Invoice' : 'Receipt', L, H - 78, { f: bold, size: 24 });
  const lw = 170, lh = (lw * LOF_LOGO_SIZE.h) / LOF_LOGO_SIZE.w;
  page.drawImage(logo, { x: R - lw, y: H - 60 - lh, width: lw, height: lh });

  // Number and date block
  const meta: [string, string][] = kind === 'invoice'
    ? [['Invoice number', d.invoiceNo], ['Date of issue', day(d.issued)], ['Date due', d.amountDue > 0.005 && d.due ? day(d.due) : 'Paid in full']]
    : [['Invoice number', d.invoiceNo], ['Receipt number', d.receiptNo], ['Date paid', day(d.paidAt)]];
  let y = H - 112;
  for (const [k, v] of meta) { text(page, k, L, y, { f: bold, size: 9.5 }); text(page, v, L + 92, y, { f: bold, size: 9.5 }); y -= 15; }

  // From / Bill to
  y -= 22;
  const col = (x: number, head: string, name: string, lines: string[]) => {
    let yy = y; text(page, head, x, yy, { f: bold }); yy -= 17;
    if (name) { text(page, name, x, yy, { max: 230 }); yy -= 14; }
    for (const l of lines) { text(page, l, x, yy, { max: 230 }); yy -= 14; }
    return yy;
  };
  y = Math.min(col(L, d.from.name, '', d.from.lines), col(L + 270, 'Bill to', d.billTo.name, d.billTo.lines)) - 22;

  // Headline amount
  const headline = kind === 'invoice'
    ? d.amountDue > 0.005 ? `${docMoney(d.amountDue, d.cur)} due${d.due ? ' ' + day(d.due) : ''}` : `${docMoney(d.total, d.cur)} paid in full`
    : `${docMoney(d.amountPaid, d.cur)} paid on ${day(d.paidAt)}`;
  text(page, headline, L, y, { f: bold, size: 15 });
  y -= 40;

  // Items
  const cQty = 380, cUnit = 470;
  text(page, 'Description', L, y, { size: 8, color: MUTED }); text(page, 'Qty', cQty, y, { size: 8, color: MUTED, right: true });
  text(page, 'Unit price', cUnit, y, { size: 8, color: MUTED, right: true }); text(page, 'Amount', R, y, { size: 8, color: MUTED, right: true });
  y -= 7; rule(y, L, R, 0.9, INK); y -= 16;
  for (const l of d.lines) {
    text(page, l.desc, L, y, { max: 300 }); text(page, String(l.qty), cQty, y, { right: true });
    text(page, docMoney(l.unit, d.cur), cUnit, y, { right: true }); text(page, docMoney(l.amount, d.cur), R, y, { right: true });
    y -= 14;
    if (l.sub) { text(page, l.sub, L, y, { color: MUTED, max: 300 }); y -= 14; }
    y -= 6;
  }

  // Totals
  y -= 6;
  const tot: [string, string, boolean][] = [['Subtotal', docMoney(d.subtotal, d.cur), false]];
  if (d.tax > 0) tot.push([d.taxLabel, docMoney(d.tax, d.cur), false]);
  tot.push(['Total', docMoney(d.total, d.cur), false]);
  if (kind === 'invoice') { tot.push(['Amount paid', docMoney(d.paidToDate, d.cur), false]); tot.push(['Amount due', docMoney(d.amountDue, d.cur), true]); }
  else tot.push(['Amount paid', docMoney(d.amountPaid, d.cur), true]);
  const tx = 318;
  for (const [k, v, strong] of tot) {
    rule(y + 12, tx, R);
    text(page, k, tx, y, { f: strong ? bold : reg }); text(page, v, R, y, { f: strong ? bold : reg, right: true });
    y -= 19;
  }

  // Receipt: payment history
  if (kind === 'receipt' && d.history.length) {
    y -= 26;
    text(page, 'Payment history', L, y, { f: bold, size: 15 }); y -= 30;
    const hDate = 285, hAmt = 455;
    text(page, 'Payment method', L, y, { size: 8, color: MUTED }); text(page, 'Date', hDate, y, { size: 8, color: MUTED });
    text(page, 'Amount paid', hAmt, y, { size: 8, color: MUTED, right: true }); text(page, 'Receipt number', R, y, { size: 8, color: MUTED, right: true });
    y -= 7; rule(y, L, R, 0.9, INK); y -= 16;
    for (const h of d.history) {
      if (y < 90) break;
      text(page, h.method || '—', L, y, { max: 270 }); text(page, day(h.at), hDate, y);
      text(page, docMoney(h.amount, d.cur), hAmt, y, { right: true }); text(page, h.receiptNo, R, y, { right: true });
      y -= 18;
    }
  }

  // Footer
  const foot = kind === 'invoice'
    ? `Student ${d.student} (${d.studentId}) · ${d.enrolmentId}. Payments are confirmed with a receipt.`
    : `This receipt confirms payment received for ${d.student} (${d.studentId}). Payment ID ${d.paymentId}.`;
  rule(70); text(page, foot, L, 54, { size: 8, color: MUTED, max: R - L });
  text(page, 'Lab of Future · Be Curious', L, 40, { size: 8, color: MUTED });
  return pdf.save();
}

export const invoicePdf = (d: BillingDoc) => renderPdf(d, 'invoice');
export const receiptPdf = (d: BillingDoc) => renderPdf(d, 'receipt');

/** File names for the two attachments. */
export const docFileNames = (d: BillingDoc) => ({
  invoice: `Invoice-${d.invoiceNo}.pdf`.replace(/[^\w.-]+/g, '-'),
  receipt: `Receipt-${d.receiptNo}.pdf`.replace(/[^\w.-]+/g, '-'),
});

// ------------------------------------------------------------------------------------------------ HTML
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const logoDataUri = () => 'data:image/png;base64,' + LOF_LOGO_PNG_B64;

/** The invoice or receipt as HTML (e-mail-safe: tables and inline styles only). `logo` is a URL or data URI. */
export function docHtml(d: BillingDoc, kind: 'invoice' | 'receipt', logo: string) {
  const td = 'padding:8px 0;font-size:14px;color:#0f1729;vertical-align:top';
  const th = 'padding:0 0 6px;font-size:12px;color:#5f6b7a;font-weight:400;border-bottom:1px solid #0f1729';
  const meta = (kind === 'invoice'
    ? [['Invoice number', d.invoiceNo], ['Date of issue', day(d.issued)], ['Date due', d.amountDue > 0.005 && d.due ? day(d.due) : 'Paid in full']]
    : [['Invoice number', d.invoiceNo], ['Receipt number', d.receiptNo], ['Date paid', day(d.paidAt)]])
    .map(([k, v]) => `<tr><td style="padding:1px 18px 1px 0;font-size:13px;font-weight:700">${esc(k)}</td><td style="padding:1px 0;font-size:13px;font-weight:700">${esc(v)}</td></tr>`).join('');
  const block = (head: string, name: string, lines: string[]) =>
    `<div style="font-size:13px;font-weight:700;margin-bottom:6px">${esc(head)}</div>${name ? `<div style="font-size:13px;line-height:1.6">${esc(name)}</div>` : ''}${lines.map((l) => `<div style="font-size:13px;line-height:1.6">${esc(l)}</div>`).join('')}`;
  const headline = kind === 'invoice'
    ? d.amountDue > 0.005 ? `${docMoney(d.amountDue, d.cur)} due${d.due ? ' ' + day(d.due) : ''}` : `${docMoney(d.total, d.cur)} paid in full`
    : `${docMoney(d.amountPaid, d.cur)} paid on ${day(d.paidAt)}`;
  const items = d.lines.map((l) => `<tr><td style="${td}">${esc(l.desc)}${l.sub ? `<div style="color:#5f6b7a;font-size:13px">${esc(l.sub)}</div>` : ''}</td><td style="${td};text-align:right;white-space:nowrap;padding-left:10px">${l.qty}</td><td style="${td};text-align:right;white-space:nowrap;padding-left:10px">${esc(docMoney(l.unit, d.cur))}</td><td style="${td};text-align:right;white-space:nowrap;padding-left:10px">${esc(docMoney(l.amount, d.cur))}</td></tr>`).join('');
  const tot: [string, string, boolean][] = [['Subtotal', docMoney(d.subtotal, d.cur), false]];
  if (d.tax > 0) tot.push([d.taxLabel, docMoney(d.tax, d.cur), false]);
  tot.push(['Total', docMoney(d.total, d.cur), false]);
  if (kind === 'invoice') { tot.push(['Amount paid', docMoney(d.paidToDate, d.cur), false]); tot.push(['Amount due', docMoney(d.amountDue, d.cur), true]); }
  else tot.push(['Amount paid', docMoney(d.amountPaid, d.cur), true]);
  const totals = tot.map(([k, v, s]) => `<tr><td style="padding:5px 0;border-top:1px solid #e3e6eb;font-size:14px;${s ? 'font-weight:700' : ''}">${esc(k)}</td><td style="padding:5px 0;border-top:1px solid #e3e6eb;font-size:14px;text-align:right;white-space:nowrap;${s ? 'font-weight:700' : ''}">${esc(v)}</td></tr>`).join('');
  const history = kind === 'receipt' && d.history.length
    ? `<div style="font-size:20px;font-weight:700;margin:32px 0 14px">Payment history</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr><th align="left" style="${th}">Payment method</th><th align="left" style="${th}">Date</th><th align="right" style="${th}">Amount paid</th><th align="right" style="${th}">Receipt number</th></tr>${d.history.map((h) => `<tr><td style="${td}">${esc(h.method || '—')}</td><td style="${td};white-space:nowrap;padding-left:8px">${esc(day(h.at))}</td><td style="${td};text-align:right;white-space:nowrap;padding-left:10px">${esc(docMoney(h.amount, d.cur))}</td><td style="${td};text-align:right;white-space:nowrap;padding-left:10px">${esc(h.receiptNo)}</td></tr>`).join('')}</table>`
    : '';
  return `<div style="max-width:720px;margin:0 auto;background:#fff;padding:32px;font-family:Inter,Arial,Helvetica,sans-serif;color:#0f1729">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-size:30px;font-weight:700;vertical-align:top">${kind === 'invoice' ? 'Invoice' : 'Receipt'}</td><td align="right" style="vertical-align:top"><img src="${esc(logo)}" alt="Lab of Future" width="190" style="display:block;width:190px;max-width:45vw;height:auto;border:0"></td></tr></table>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:22px">${meta}</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px"><tr><td width="50%" style="vertical-align:top;padding-right:12px">${block(d.from.name, '', d.from.lines)}</td><td width="50%" style="vertical-align:top">${block('Bill to', d.billTo.name, d.billTo.lines)}</td></tr></table>
<div style="font-size:20px;font-weight:700;margin:30px 0 26px">${esc(headline)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr><th align="left" style="${th}">Description</th><th align="right" style="${th}">Qty</th><th align="right" style="${th}">Unit price</th><th align="right" style="${th}">Amount</th></tr>${items}</table>
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:14px 0 0 auto;width:100%;max-width:370px">${totals}</table>
${history}</div>`;
}

/** The payment e-mail: the template's message, the receipt, and a note that the PDFs are attached. */
export function paymentEmailHtml(message: string, d: BillingDoc, logo: string) {
  const msg = esc(message).replace(/\r?\n/g, '<br>');
  return `<div style="background:#f3f5f9;padding:24px 8px;font-family:Inter,Arial,Helvetica,sans-serif">
<div style="max-width:720px;margin:0 auto 16px;font-size:14px;line-height:1.6;color:#1b2633">${msg}</div>
${docHtml(d, 'receipt', logo)}
<div style="max-width:720px;margin:14px auto 0;font-size:12px;color:#5f6b7a">Your invoice and receipt are attached as PDF files.</div></div>`;
}
