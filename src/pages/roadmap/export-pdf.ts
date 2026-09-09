/**
 * Roadmap Creator — PDF export.
 *
 * A roadmap board is one very wide, very tall grid with no sane page break in it, so this
 * rasterises the whole thing onto a single page sized to the board's own proportions.
 *
 * Every guard here is load-bearing:
 *   • ONE uniform scale for both axes, so the aspect ratio cannot drift and product photos
 *     cannot come out horizontally squashed.
 *   • Caps on the longest rendered edge AND total pixel area — browsers silently return a BLANK
 *     canvas past their limits rather than erroring, so the cap is the only warning you get.
 *   • Timeouts around both image loading and rasterisation, with a half-scale retry: a stalled
 *     remote thumbnail must not hang the export forever.
 *
 * `html2canvas` and `jspdf` are imported DYNAMICALLY so neither lands in the app's initial chunk.
 * They are only needed the moment somebody clicks Export.
 */
import { slugify } from './format';

const IMAGE_TIMEOUT_MS = 8000;
const RENDER_TIMEOUT_MS = 45000;
const MAX_EDGE = 12000; // px, longest rendered side
const MAX_AREA = 90e6; // px², total pixels
const MAX_PT = 14000; // jsPDF's own page-size ceiling is ~14400pt

/**
 * Resolve once every image has loaded or failed — or once the timeout expires, whichever comes
 * first. NEVER rejects: a missing thumbnail should cost a gap, not the whole export.
 */
function waitForImages(el: HTMLElement, timeoutMs = IMAGE_TIMEOUT_MS): Promise<unknown> {
  const imgs = [...el.querySelectorAll('img')];
  const settled = imgs.map(img =>
    img.complete
      ? Promise.resolve()
      : new Promise<void>(res => {
          img.addEventListener('load', () => res(), { once: true });
          img.addEventListener('error', () => res(), { once: true });
        }),
  );
  return Promise.race([Promise.all(settled), new Promise(res => setTimeout(res, timeoutMs))]);
}

async function renderCanvas(
  html2canvas: typeof import('html2canvas').default,
  el: HTMLElement,
  w: number,
  h: number,
  scale: number,
): Promise<HTMLCanvasElement> {
  const opts = {
    useCORS: true,
    allowTaint: false,
    backgroundColor: '#ffffff',
    width: w,
    height: h,
    windowWidth: w,
    windowHeight: h,
    scrollX: 0,
    scrollY: 0,
    x: 0,
    y: 0,
    logging: false,
    imageTimeout: IMAGE_TIMEOUT_MS,
  };
  const attempt = (s: number) =>
    Promise.race([
      html2canvas(el, { ...opts, scale: s }),
      new Promise<HTMLCanvasElement>((_, rej) =>
        setTimeout(() => rej(new Error('render timed out')), RENDER_TIMEOUT_MS),
      ),
    ]);
  // One retry at half scale — a board too big at 2x often succeeds at 1x.
  return attempt(scale).catch(() => attempt(Math.max(0.5, scale / 2)));
}

/**
 * Rasterise `el` into a single-page PDF and save it.
 *
 * `kind` only shapes the filename. Presentation mode needs no special handling here: whatever is
 * on screen is what gets rasterised, so a board with the metrics hidden exports with them hidden.
 */
export async function exportRoadmapPdf(
  el: HTMLElement,
  { category, kind = 'Roadmap' }: { category: string; kind?: 'Roadmap' | 'StepUpChart' },
): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  await waitForImages(el);

  const w = Math.ceil(el.scrollWidth);
  const h = Math.ceil(el.scrollHeight);
  if (!w || !h) throw new Error('Nothing to export yet.');
  const boardRatio = w / h;

  const edgeScale = MAX_EDGE / Math.max(w, h);
  const areaScale = Math.sqrt(MAX_AREA / (w * h));
  const scale = Math.max(0.5, Math.min(2, edgeScale, areaScale));

  const canvas = await renderCanvas(html2canvas, el, w, h, scale);

  // Size the page from the board's TRUE ratio, not the canvas pixel dimensions: if html2canvas
  // produced a slightly off-ratio canvas, the page still comes out correctly proportioned and
  // the image is fitted into it.
  let pw: number;
  let ph: number;
  if (boardRatio >= 1) {
    pw = Math.min(MAX_PT, w);
    ph = pw / boardRatio;
    if (ph > MAX_PT) {
      ph = MAX_PT;
      pw = ph * boardRatio;
    }
  } else {
    ph = Math.min(MAX_PT, h);
    pw = ph * boardRatio;
    if (pw > MAX_PT) {
      pw = MAX_PT;
      ph = pw / boardRatio;
    }
  }

  const pdf = new jsPDF({
    orientation: pw >= ph ? 'landscape' : 'portrait',
    unit: 'pt',
    format: [pw, ph],
    compress: true,
  });

  // Contain, never stretch: if the canvas ratio drifted it letterboxes on white rather than
  // distorting the product images.
  const cRatio = canvas.width / canvas.height;
  let iw = pw;
  let ih = pw / cRatio;
  if (ih > ph) {
    ih = ph;
    iw = ph * cRatio;
  }
  const ox = (pw - iw) / 2;
  const oy = (ph - ih) / 2;

  pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', ox, oy, iw, ih, undefined, 'FAST');
  pdf.save(`Klarstein_${kind}_${slugify(category)}.pdf`);
}
