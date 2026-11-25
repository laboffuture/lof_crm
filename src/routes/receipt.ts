import { docHtml, logoDataUri, type BillingDoc } from '../domain/billing-docs';

/** Printable receipt and invoice for staff (browser "Save as PDF"), in the same layout parents receive. */
export function receiptPage(d: BillingDoc) {
  const logo = logoDataUri();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Receipt ${d.receiptNo.replace(/[<>&"]/g, '')}</title>
<style>
body{margin:0;background:#f3f5f9;font-family:Inter,Arial,Helvetica,sans-serif}
.doc{margin:24px auto;max-width:784px;border:1px solid #e1e6ee;border-radius:8px;overflow:hidden;background:#fff}
.n{max-width:784px;margin:0 auto 24px;font-size:12px;color:#5f6b7a;padding:0 8px}
@media print{body{background:#fff}.doc{border:0;margin:0;border-radius:0}.doc+.doc{break-before:page}.n{display:none}}
</style></head><body>
<div class="doc">${docHtml(d, 'receipt', logo)}</div>
<div class="doc">${docHtml(d, 'invoice', logo)}</div>
<p class="n">To print or save as PDF, use your browser's Print command (Ctrl+P / ⌘P). The receipt and invoice print on separate pages.</p>
</body></html>`;
}
