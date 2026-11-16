// Invoice and receipt (PDF + HTML) for a payment, and the receipt e-mail that carries them.
import { describe, it, expect, beforeEach } from 'vitest';
import { writeFileSync, readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { setup, USERS, type TestCtx } from '../helpers/app';
import { buildMime } from '../../src/integrations/smtp';
import { Repo } from '../../src/lib/db';
import { loadBillingDoc, invoicePdf, receiptPdf, docHtml, paymentEmailHtml, docFileNames } from '../../src/domain/billing-docs';

let t: TestCtx;
beforeEach(async () => { t = await setup(); });
const firstPaymentWithEnrolment = async () => {
  const rows = await t.sql<any>("SELECT id FROM docs WHERE type='payment' AND is_test=0 ORDER BY id LIMIT 50");
  const repo = new Repo(t.env.DB);
  for (const r of rows) { const p = await repo.get<any>('payment', r.id); if (p?.enr && (await repo.get<any>('enrollment', p.enr))?.fee) return p; }
  throw new Error('no seeded payment with an enrolment');
};

describe('invoice and receipt', () => {
  it('builds both documents from the enrolment and payment', async () => {
    const p = await firstPaymentWithEnrolment();
    const d = (await loadBillingDoc(new Repo(t.env.DB), p.id))!;
    expect(d.receiptNo).toBe(p.rc);
    expect(d.invoiceNo).toMatch(/^INV-26-\d{4}$/);
    expect(d.amountPaid).toBe(p.amt);
    expect(d.history.at(-1)!.receiptNo).toBe(p.rc);
    // lines + tax add up to the enrolment total
    expect(Math.round((d.subtotal + d.tax) * 100)).toBe(Math.round(d.total * 100));
    expect(d.amountDue).toBe(Math.max(0, Math.round((d.total - d.paidToDate) * 100) / 100));

    for (const [kind, bytes] of [['invoice', await invoicePdf(d)], ['receipt', await receiptPdf(d)]] as const) {
      expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(1);
      expect(doc.getTitle()).toContain(kind === 'invoice' ? d.invoiceNo : d.receiptNo);
      if (process.env.BILLING_PDF_OUT) writeFileSync(`${process.env.BILLING_PDF_OUT}/${docFileNames(d)[kind]}`, bytes);
    }
    const html = docHtml(d, 'receipt', 'https://crm.test/lof-logo.png');
    expect(html).toContain('Payment history');
    expect(html).toContain(d.receiptNo);
    if (process.env.BILLING_PDF_OUT) writeFileSync(`${process.env.BILLING_PDF_OUT}/email.html`, paymentEmailHtml('Dear parent,\n\nThank you for your payment.', d, 'lof-logo.png') + docHtml(d, 'invoice', 'lof-logo.png'));
  });

  it('builds an e-mail with the PDFs attached next to the text and HTML', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.7 test');
    const raw = buildMime({ from: 'a@lof.test', to: 'p@example.com', subject: 'Payment received', text: 'Thank you', html: '<p>Thank you</p>',
      attachments: [{ filename: 'Invoice-INV-26-0001.pdf', contentType: 'application/pdf', content: pdf }, { filename: 'Receipt "x"\r\n.pdf', contentType: 'bad type', content: pdf }] }, 'id@lof.test');
    const outer = raw.match(/Content-Type: multipart\/mixed; boundary="([^"]+)"/)![1];
    expect(raw).toMatch(/Content-Type: multipart\/alternative; boundary="lof_/);
    expect(raw).toContain('Content-Disposition: attachment; filename="Invoice-INV-26-0001.pdf"');
    expect(raw).toContain('Content-Type: application/octet-stream; name="Receipt _x_.pdf"'); // unsafe name and type are cleaned
    expect(raw).toContain(Buffer.from(pdf).toString('base64'));
    expect(raw.trimEnd().endsWith(`--${outer}--`)).toBe(true);
    // without attachments the message stays a plain multipart/alternative
    expect(buildMime({ from: 'a@lof.test', to: 'p@example.com', subject: 'Hi', text: 'Hi' }, 'id2@lof.test')).not.toContain('multipart/mixed');
  });

  it('lets staff download the invoice and receipt PDFs for a payment in their branch', async () => {
    const p = await firstPaymentWithEnrolment();
    const get = async (file: string, email = USERS.admin) => t.call('GET', `/api/v1/payments/${p.id}/${file}`, { token: await t.login(email) });
    for (const file of ['invoice.pdf', 'receipt.pdf']) {
      const r = await get(file);
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toBe('application/pdf');
      expect(r.headers.get('content-disposition')).toMatch(file === 'invoice.pdf' ? /filename="Invoice-INV-26-\d{4}\.pdf"/ : new RegExp(`filename="Receipt-${p.rc}\\.pdf"`));
    }
    expect((await get('other.pdf')).status).toBe(404);
    const page = await get('receipt');
    expect(page.status).toBe(200);
    expect(page.text).toContain('Payment history');
    expect(page.text).toContain('data:image/png;base64,'); // the logo is inside the page
  });

  it('updates saved receipt templates that still promise a separate tax invoice (migration 0006)', async () => {
    const OLD = 'Your tax invoice will be sent separately by our accounts team.';
    await t.setCfg((c) => { c.emailTpls = [
      { id: 'ET2', n: 'Fee receipt', branch: 'All', active: true, subject: 'Payment received', body: `Dear {parent_name},\n\n${OLD}\n\nKind regards` },
      { id: 'ET9', n: 'Fee receipt', branch: 'KRM', active: true, subject: 'Karama', body: `Hi\n${OLD}\nThanks – my own words` },
    ]; });
    const sql = readFileSync(new URL('../../migrations/0006_receipt_template_wording.sql', import.meta.url), 'utf8');
    await t.env.DB.exec(sql.replace(/^--.*$/gm, '').replace(/\s+/g, ' ').trim());
    const tpls = JSON.parse((await t.sql<any>("SELECT data FROM settings WHERE key='cfg'"))[0].data).emailTpls;
    expect(tpls[0].body).toBe('Dear {parent_name},\n\nYour invoice and receipt are attached to this e-mail.\n\nKind regards');
    expect(tpls[1].body).toBe('Hi\nYour invoice and receipt are attached to this e-mail.\nThanks – my own words');
  });

  it('prints characters the PDF fonts lack as "?" instead of failing', async () => {
    const p = await firstPaymentWithEnrolment();
    const d = (await loadBillingDoc(new Repo(t.env.DB), p.id))!;
    d.billTo.name = 'محمد Kumar ₹';
    const bytes = await receiptPdf(d);
    expect(bytes.length).toBeGreaterThan(1000);
  });
});
