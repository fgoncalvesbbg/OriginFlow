import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { IMSection, IMTemplate } from '../../types';

interface RenderProjectIMPdfParams {
  previewElement: HTMLDivElement | null;
  projectName: string;
  language: string;
  template: IMTemplate | null;
  sections: IMSection[];
  formData: Record<string, string>;
  conditions: Record<string, boolean>;
  useLegacyHtml2Canvas?: boolean;
}

const MM_TO_PX = 3.7795275591;

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const processSectionHtml = (
  html: string,
  formData: Record<string, string>,
  conditions: Record<string, boolean>
) => {
  if (!html) return '';

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const conditionNodes = doc.querySelectorAll('.im-condition');
  conditionNodes.forEach((node) => {
    const el = node as HTMLElement;
    const id = el.getAttribute('data-id');
    const contentEncoded = el.getAttribute('data-content');

    if (id && conditions[id] && contentEncoded) {
      try {
        const content = decodeURIComponent(contentEncoded);
        const textNode = doc.createTextNode(content);
        el.replaceWith(textNode);
      } catch {
        el.remove();
      }
    } else {
      el.remove();
    }
  });

  const placeholderNodes = doc.querySelectorAll('.im-placeholder');
  placeholderNodes.forEach((node) => {
    const el = node as HTMLElement;
    const id = el.getAttribute('data-id');
    const type = el.getAttribute('data-type');

    if (!id || !type) return;

    const value = formData[id];

    if (type === 'image') {
      if (value) {
        const img = doc.createElement('img');
        img.src = value;
        img.className = 'im-inline-image';
        el.replaceWith(img);
      } else {
        el.remove();
      }
      return;
    }

    const span = doc.createElement('span');
    span.textContent = value || '';
    el.replaceWith(span);
  });

  return doc.body.innerHTML;
};

export const buildIMPrintDocument = ({
  projectName,
  language,
  template,
  sections,
  formData,
  conditions,
}: Omit<RenderProjectIMPdfParams, 'previewElement' | 'useLegacyHtml2Canvas'>) => {
  const orderedSections = [...sections].sort((a, b) => a.order - b.order);
  const primaryColor = template?.metadata?.primaryColor || '#0f172a';

  const displayTitle =
    formData.__cover_title !== undefined ? formData.__cover_title : projectName;
  const displaySubtitle =
    formData.__cover_subtitle !== undefined
      ? formData.__cover_subtitle
      : 'INSTRUCTION MANUAL';
  const displayLogo = formData.__custom_logo || template?.metadata?.companyLogoUrl;
  const displayCoverImage =
    formData.__custom_cover_image || template?.metadata?.coverImageUrl;
  const displayFooter =
    formData.__custom_footer !== undefined
      ? formData.__custom_footer
      : template?.metadata?.footerText || '';

  const sectionPages = orderedSections
    .map((section) => {
      const sectionHtml = processSectionHtml(
        section.content[language] || '',
        formData,
        conditions
      );

      return `
        <section class="im-page-section im-page-content">
          <div class="im-running-header">${escapeHtml(projectName)} · ${language.toUpperCase()}</div>
          <div class="im-page-inner">
            <h2 class="im-section-title">${escapeHtml(section.title)}</h2>
            <div class="im-section-content">${sectionHtml}</div>
          </div>
          <div class="im-running-footer">${escapeHtml(displayFooter)}</div>
          <div class="im-page-number"></div>
        </section>
      `;
    })
    .join('');

  const endPage = template?.metadata?.backPageContent
    ? `
      <section class="im-page-section im-page-end">
        <div class="im-page-inner">
          <div class="im-end-content">${template.metadata.backPageContent}</div>
          <div class="im-end-copyright">© ${new Date().getFullYear()} ${escapeHtml(
            template.metadata.companyName || 'Company Name'
          )}. All rights reserved.</div>
        </div>
      </section>
    `
    : '';

  const coverImageBlock = displayCoverImage
    ? `<div class="im-cover-image" style="background-image:url('${displayCoverImage}')"></div>`
    : '';
  const logoBlock = displayLogo
    ? `<img src="${displayLogo}" alt="Logo" class="im-cover-logo" />`
    : '';

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <style>
          :root { color-scheme: light only; }
          * { box-sizing: border-box; }
          html, body { margin: 0; padding: 0; background: #ffffff; }
          body { font-family: Inter, Arial, sans-serif; }

          @page {
            size: A4;
            margin: 18mm 15mm 20mm 15mm;
            @top-center { content: element(im-print-header); }
            @bottom-left { content: element(im-print-footer); }
            @bottom-right { content: "Page " counter(page) " / " counter(pages); }
          }

          @page :first {
            margin: 0;
            @top-center { content: none; }
            @bottom-left { content: none; }
            @bottom-right { content: none; }
          }

          @page :last {
            @top-center { content: none; }
            @bottom-right { content: "End"; }
          }

          .im-page-section {
            position: relative;
            width: 210mm;
            min-height: 297mm;
            max-height: 297mm;
            page-break-after: always;
            overflow: hidden;
            background: #fff;
          }

          .im-page-section:last-of-type { page-break-after: auto; }
          .im-page-inner { padding: 22mm 16mm 26mm 16mm; }

          .im-running-header {
            position: running(im-print-header);
            display: block;
            border-bottom: 1px solid #e2e8f0;
            color: #475569;
            font-size: 10px;
            letter-spacing: 0.02em;
            padding-bottom: 6px;
            margin: 14mm 16mm 8mm 16mm;
          }

          .im-running-footer {
            position: running(im-print-footer);
            display: block;
            color: #64748b;
            font-size: 9px;
          }

          .im-page-number {
            position: absolute;
            bottom: 8mm;
            right: 12mm;
            font-size: 10px;
            color: #64748b;
          }

          .im-page-cover { padding: 0; }
          .im-cover-image { height: 110mm; background-size: cover; background-position: center; }
          .im-cover-content {
            min-height: 297mm;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            padding: 22mm 20mm;
          }
          .im-cover-logo { height: 18mm; object-fit: contain; margin-bottom: 20mm; }
          .im-cover-title { margin: 0 0 6mm; color: ${primaryColor}; font-size: 18mm; line-height: 1.1; }
          .im-cover-subtitle { margin: 0; color: #475569; font-size: 7mm; letter-spacing: 0.2em; text-transform: uppercase; }
          .im-cover-footer { border-top: 1.5mm solid ${primaryColor}; padding-top: 6mm; font-size: 3.4mm; color: #334155; }

          .im-section-title {
            margin: 0 0 5mm;
            padding-bottom: 2mm;
            border-bottom: 0.6mm solid ${primaryColor};
            color: ${primaryColor};
            font-size: 6.2mm;
          }
          .im-section-content {
            font-size: 3.8mm;
            line-height: 1.6;
            color: #1f2937;
          }

          .im-section-content ul { list-style: disc; margin: 0 0 4mm 6mm; padding-left: 0; }
          .im-section-content ol { list-style: decimal; margin: 0 0 4mm 6mm; padding-left: 0; }
          .im-section-content p { margin: 0 0 4mm; }
          .im-section-content img, .im-inline-image { max-width: 100%; height: auto; }

          .im-page-end {
            background: #f8fafc;
          }
          .im-end-content { font-size: 3.5mm; color: #1e293b; }
          .im-end-copyright { margin-top: 10mm; font-size: 3.2mm; color: #64748b; text-align: center; }
        </style>
      </head>
      <body>
        <section class="im-page-section im-page-cover">
          ${coverImageBlock}
          <div class="im-cover-content">
            <div>
              ${logoBlock}
              <h1 class="im-cover-title">${escapeHtml(displayTitle)}</h1>
              <p class="im-cover-subtitle">${escapeHtml(displaySubtitle)}</p>
            </div>
            <div class="im-cover-footer">
              <div><strong>${escapeHtml(
                template?.metadata?.companyName || 'Company Name'
              )}</strong></div>
              <div>Original Instructions</div>
            </div>
          </div>
        </section>

        ${sectionPages}
        ${endPage}
      </body>
    </html>
  `;
};

const renderLegacyPreviewPdf = async (previewElement: HTMLDivElement) => {
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.top = '0';
  container.style.left = '-9999px';
  container.style.width = '210mm';
  document.body.appendChild(container);

  const clone = previewElement.cloneNode(true) as HTMLElement;
  clone.style.transform = 'none';
  clone.style.height = 'auto';
  clone.style.width = '100%';
  clone.style.overflow = 'visible';
  clone.style.maxHeight = 'none';
  container.appendChild(clone);

  await new Promise((resolve) => setTimeout(resolve, 800));

  const canvas = await html2canvas(clone, {
    scale: 2,
    useCORS: true,
    logging: false,
    allowTaint: true,
    backgroundColor: '#ffffff',
    windowWidth: 210 * MM_TO_PX * 2,
  });

  document.body.removeChild(container);

  const imgData = canvas.toDataURL('image/jpeg', 0.95);
  const pdf = new jsPDF('p', 'mm', 'a4');
  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = pdf.internal.pageSize.getHeight();
  const imgProps = pdf.getImageProperties(imgData);
  const imgHeight = (imgProps.height * pdfWidth) / imgProps.width;

  let heightLeft = imgHeight;
  let position = 0;

  pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, imgHeight);
  heightLeft -= pdfHeight;

  while (heightLeft > 0) {
    position -= pdfHeight;
    pdf.addPage();
    pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, imgHeight);
    heightLeft -= pdfHeight;
  }

  return pdf.output('blob');
};

const waitForFrameReady = (frame: HTMLIFrameElement) =>
  new Promise<void>((resolve, reject) => {
    const onLoad = () => {
      frame.removeEventListener('load', onLoad);
      resolve();
    };

    frame.addEventListener('load', onLoad);
    setTimeout(() => reject(new Error('Timed out loading print frame.')), 10000);
  });

const waitForImages = async (doc: Document) => {
  const images = Array.from(doc.images);
  await Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
        })
    )
  );
};

export const renderProjectIMPdf = async ({
  previewElement,
  projectName,
  language,
  template,
  sections,
  formData,
  conditions,
  useLegacyHtml2Canvas,
}: RenderProjectIMPdfParams) => {
  if (useLegacyHtml2Canvas) {
    if (!previewElement) {
      throw new Error('Preview element is required when legacy renderer is enabled.');
    }
    return renderLegacyPreviewPdf(previewElement);
  }

  const htmlDoc = buildIMPrintDocument({
    projectName,
    language,
    template,
    sections,
    formData,
    conditions,
  });

  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.top = '0';
  frame.style.left = '-10000px';
  frame.style.width = '210mm';
  frame.style.height = '297mm';
  frame.style.border = '0';
  document.body.appendChild(frame);

  try {
    frame.srcdoc = htmlDoc;
    await waitForFrameReady(frame);

    const doc = frame.contentDocument;
    if (!doc) throw new Error('Unable to access print frame document.');

    await waitForImages(doc);
    await new Promise((resolve) => setTimeout(resolve, 250));

    const pages = Array.from(doc.querySelectorAll<HTMLElement>('.im-page-section'));
    if (pages.length === 0) {
      throw new Error('No printable pages were generated.');
    }

    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    pages.forEach((page, idx) => {
      const pageNumberEl = page.querySelector<HTMLElement>('.im-page-number');
      if (pageNumberEl) {
        pageNumberEl.textContent = `Page ${idx + 1} / ${pages.length}`;
      }
    });

    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      const canvas = await html2canvas(page, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        logging: false,
        backgroundColor: '#ffffff',
        width: Math.round(210 * MM_TO_PX),
        height: Math.round(297 * MM_TO_PX),
        windowWidth: Math.round(210 * MM_TO_PX),
        windowHeight: Math.round(297 * MM_TO_PX),
      });

      const imageData = canvas.toDataURL('image/jpeg', 0.96);
      if (index > 0) {
        pdf.addPage();
      }
      pdf.addImage(imageData, 'JPEG', 0, 0, pageWidth, pageHeight);
    }

    return pdf.output('blob');
  } finally {
    document.body.removeChild(frame);
  }
};
