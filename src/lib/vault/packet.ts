import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { Dispute, EvidenceItem } from '../types';
import { getVaultEvidenceForDispute } from './vault';

export async function generateDisputePdfPacket(
  dispute: Dispute,
  evidenceItems: EvidenceItem[]
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`PayPal Dispute Evidence Packet - ${dispute.paypal_dispute_id}`);
  pdfDoc.setAuthor('Dispute Autopilot Evidence Vault');

  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([612, 792]); // Standard Letter size
  const { width, height } = page.getSize();
  let y = height - 50;

  // Header Banner
  page.drawRectangle({
    x: 40,
    y: y - 45,
    width: width - 80,
    height: 55,
    color: rgb(0, 0.44, 0.73), // PayPal Blue
  });

  page.drawText('DISPUTE AUTOPILOT EVIDENCE PACKET', {
    x: 55,
    y: y - 20,
    size: 16,
    font: helveticaBold,
    color: rgb(1, 1, 1),
  });

  page.drawText('OFFICIAL MERCHANT SUBMISSION & CRYPTOGRAPHIC PROOF', {
    x: 55,
    y: y - 36,
    size: 9,
    font: helvetica,
    color: rgb(0.9, 0.95, 1),
  });

  y -= 70;

  // Case Metadata Box
  page.drawRectangle({
    x: 40,
    y: y - 90,
    width: width - 80,
    height: 90,
    color: rgb(0.96, 0.97, 0.98),
    borderColor: rgb(0.85, 0.88, 0.92),
    borderWidth: 1,
  });

  const metadata = [
    { label: 'PayPal Dispute ID:', val: dispute.paypal_dispute_id },
    { label: 'Transaction ID:', val: dispute.transaction_id },
    { label: 'Dispute Reason:', val: dispute.reason },
    { label: 'Disputed Amount:', val: `$${(dispute.amount_cents / 100).toFixed(2)} ${dispute.currency}` },
    { label: 'Response Deadline:', val: new Date(dispute.response_deadline).toLocaleString() },
    { label: 'Evidence Score:', val: `${dispute.strength_score}/100 (${dispute.recommendation})` },
  ];

  let metaY = y - 20;
  for (let i = 0; i < metadata.length; i += 2) {
    const left = metadata[i];
    const right = metadata[i + 1];

    page.drawText(left.label, { x: 55, y: metaY, size: 9, font: helveticaBold, color: rgb(0.2, 0.25, 0.3) });
    page.drawText(left.val, { x: 170, y: metaY, size: 9, font: helvetica, color: rgb(0.1, 0.1, 0.1) });

    if (right) {
      page.drawText(right.label, { x: 320, y: metaY, size: 9, font: helveticaBold, color: rgb(0.2, 0.25, 0.3) });
      page.drawText(right.val, { x: 440, y: metaY, size: 9, font: helvetica, color: rgb(0.1, 0.1, 0.1) });
    }
    metaY -= 22;
  }

  y -= 110;

  // Evidence Items Section Header
  page.drawText(`VERIFIED EVIDENCE ITEMS (${evidenceItems.length})`, {
    x: 40,
    y: y,
    size: 12,
    font: helveticaBold,
    color: rgb(0.1, 0.15, 0.2),
  });

  page.drawLine({
    start: { x: 40, y: y - 5 },
    end: { x: width - 40, y: y - 5 },
    thickness: 1,
    color: rgb(0.8, 0.85, 0.9),
  });

  y -= 25;

  for (const item of evidenceItems) {
    // Check if new page is needed
    if (y < 120) {
      page = pdfDoc.addPage([612, 792]);
      y = height - 50;
    }

    // Evidence Box
    page.drawRectangle({
      x: 40,
      y: y - 75,
      width: width - 80,
      height: 75,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.8, 0.85, 0.9),
      borderWidth: 1,
    });

    page.drawText(`[${item.evidence_type}] ${item.title}`, {
      x: 52,
      y: y - 18,
      size: 10,
      font: helveticaBold,
      color: rgb(0.05, 0.25, 0.5),
    });

    page.drawText(`Source: ${item.source} | Captured: ${new Date(item.captured_at).toISOString()}`, {
      x: 52,
      y: y - 32,
      size: 8,
      font: helvetica,
      color: rgb(0.4, 0.45, 0.5),
    });

    // Truncate content display cleanly
    const cleanContent = item.content.replace(/\s+/g, ' ').substring(0, 110);
    page.drawText(`Data: ${cleanContent}...`, {
      x: 52,
      y: y - 48,
      size: 8,
      font: helvetica,
      color: rgb(0.2, 0.2, 0.2),
    });

    // SHA-256 Checksum badge
    page.drawText(`SHA-256: ${item.sha256_hash}`, {
      x: 52,
      y: y - 64,
      size: 7.5,
      font: helvetica,
      color: rgb(0.1, 0.5, 0.2),
    });

    y -= 88;
  }

  // Footer on current page
  page.drawLine({
    start: { x: 40, y: 50 },
    end: { x: width - 40, y: 50 },
    thickness: 0.5,
    color: rgb(0.8, 0.8, 0.8),
  });

  page.drawText('Generated deterministically by Dispute Autopilot Vault | Tamper-evident SHA-256 verified records', {
    x: 40,
    y: 35,
    size: 7.5,
    font: helvetica,
    color: rgb(0.5, 0.5, 0.5),
  });

  return await pdfDoc.save();
}
