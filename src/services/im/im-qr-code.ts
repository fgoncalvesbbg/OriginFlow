/**
 * Builds the scannable QR code embedded via the "SKU QR code" chip (see
 * QR_SKU_PLACEHOLDER_ID in im-resolver.ts). Returns a self-contained inline `<svg>` string —
 * the same technique the ISO callout icons use (im-resolver.ts's ISO_W001 etc.) — so it
 * renders identically in the live viewer, the template preview, and the PDF (PDFShift), with
 * no image upload/hosting involved.
 */

import qrcode from 'qrcode-generator';
import { QR_SKU_URL_BASE } from '../../config/im.constants';

/** The scannable value: use.berlin/<skuNumber>. */
export const skuQrUrl = (skuNumber: string): string => `${QR_SKU_URL_BASE}${skuNumber}`;

/**
 * An inline, scalable SVG QR code for `skuQrUrl(skuNumber)`. Error correction level 'M'
 * (~15% recoverable) so a folded/creased leaflet still scans. `sizeMm` sets the printed
 * size directly, since the print pipeline works in mm.
 */
export const buildSkuQrSvg = (skuNumber: string, sizeMm = 22): string => {
  const qr = qrcode(0, 'M');
  qr.addData(skuQrUrl(skuNumber));
  qr.make();
  const svg = qr.createSvgTag({ scalable: true });
  return svg.replace(
    '<svg ',
    `<svg style="display:inline-block;width:${sizeMm}mm;height:${sizeMm}mm;vertical-align:middle;" `,
  );
};
