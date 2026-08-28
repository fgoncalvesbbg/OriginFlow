/**
 * Builds the scannable QR code embedded via the "SKU QR code" chip (see
 * QR_SKU_PLACEHOLDER_ID in im-resolver.ts). Returns a self-contained inline `<svg>` string —
 * the same technique the ISO callout icons use (im-resolver.ts's ISO_W001 etc.) — so it
 * renders identically in the live viewer, the template preview, and the PDF (PDFShift), with
 * no image upload/hosting involved.
 */

import qrcode from 'qrcode-generator';
import { QR_SKU_URL_BASE, QR_ROOT_URL } from '../../config/im.constants';

/**
 * The scannable value: `use.berlin/<skuNumber>`, or the bare root `use.berlin` when there's
 * no specific SKU to link to — e.g. a Warning Leaflet template assigned to every item in a
 * category rather than to one bound SKU.
 */
export const skuQrUrl = (skuNumber?: string): string =>
  skuNumber ? `${QR_SKU_URL_BASE}${skuNumber}` : QR_ROOT_URL;

/**
 * An inline, scalable SVG QR code for `skuQrUrl(skuNumber)` — always renders, falling back
 * to the site root when `skuNumber` is absent, so the code is never blank. Error correction
 * level 'M' (~15% recoverable) so a folded/creased leaflet still scans. `sizeMm` sets the
 * printed size directly, since the print pipeline works in mm.
 */
export const buildSkuQrSvg = (skuNumber?: string, sizeMm = 22): string => {
  const qr = qrcode(0, 'M');
  qr.addData(skuQrUrl(skuNumber));
  qr.make();
  const svg = qr.createSvgTag({ scalable: true });
  return svg.replace(
    '<svg ',
    `<svg style="display:inline-block;width:${sizeMm}mm;height:${sizeMm}mm;vertical-align:middle;" `,
  );
};
