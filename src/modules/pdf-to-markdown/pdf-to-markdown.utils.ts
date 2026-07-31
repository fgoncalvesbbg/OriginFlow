/**
 * Reading-order reconstruction for pdf.js text content.
 *
 * pdf.js hands back text items with no guaranteed reading order — a naive
 * `items.map(i => i.str).join(' ')` scrambles multi-column layouts. These
 * functions rebuild lines from y-coordinates, join items on a line using
 * their actual horizontal gaps (so words don't run together or get split),
 * and optionally detect side-by-side columns from the x-position histogram
 * of line starts so columns are emitted sequentially instead of interleaved.
 *
 * Kept independent of pdfjs-dist so it can be unit-tested with plain fixtures
 * and reused as-is from the parsing worker.
 */

import { ConversionMeta, IMAGE_ONLY_CHAR_THRESHOLD, PageMeta, TextItemLike } from './types';

interface Line {
  y: number;
  /** x of the leftmost item on the line — used for column clustering. */
  x: number;
  text: string;
}

/** Groups text items into lines by y-coordinate, tolerating ~half an item's height (min 3pt). */
export function groupIntoLines(items: TextItemLike[]): { y: number; items: TextItemLike[] }[] {
  const lines: { y: number; items: TextItemLike[] }[] = [];

  for (const item of items) {
    if (!item.str) continue;
    const tolerance = Math.max(item.height * 0.5, 3);
    const line = lines.find((l) => Math.abs(l.y - item.y) <= tolerance);
    if (line) {
      line.items.push(item);
    } else {
      lines.push({ y: item.y, items: [item] });
    }
  }

  return lines;
}

/**
 * Joins items on a single line into text, inserting a space wherever the
 * horizontal gap to the previous item exceeds ~30% of the line's mean
 * character width. Prevents both run-together words and spaces mid-word.
 */
export function joinLineItems(items: TextItemLike[]): string {
  const sorted = [...items].sort((a, b) => a.x - b.x);

  const charWidths = sorted
    .filter((i) => i.str.length > 0)
    .map((i) => i.width / i.str.length);
  const meanCharWidth =
    charWidths.length > 0 ? charWidths.reduce((sum, w) => sum + w, 0) / charWidths.length : 4;
  const gapThreshold = meanCharWidth * 0.3;

  let text = '';
  let prevEndX: number | null = null;
  for (const item of sorted) {
    if (prevEndX !== null) {
      const gap = item.x - prevEndX;
      if (gap > gapThreshold && !text.endsWith(' ')) {
        text += ' ';
      }
    }
    text += item.str;
    prevEndX = item.x + item.width;
  }

  return text.trim();
}

/**
 * Clusters lines into columns by the x-position of their leftmost item.
 * Splits wherever a gap between adjacent (sorted) x-positions exceeds
 * `gapRatio` of the page width, then folds any resulting group smaller than
 * `minLinesPerColumn` into its nearest neighbor — a single stray line (e.g. a
 * page number sitting in the margin) shouldn't be mistaken for its own column.
 * Returns line indices grouped left-to-right; a single group means "no columns detected".
 */
export function detectColumns(
  lines: { x: number }[],
  pageWidth: number,
  gapRatio = 0.15,
  minLinesPerColumn = 2,
): number[][] {
  if (pageWidth <= 0 || lines.length < minLinesPerColumn * 2) {
    return [lines.map((_, i) => i)];
  }

  const order = lines.map((_, i) => i).sort((a, b) => lines[a].x - lines[b].x);
  const threshold = pageWidth * gapRatio;

  const groups: number[][] = [[order[0]]];
  for (let k = 1; k < order.length; k++) {
    const gap = lines[order[k]].x - lines[order[k - 1]].x;
    if (gap > threshold) {
      groups.push([order[k]]);
    } else {
      groups[groups.length - 1].push(order[k]);
    }
  }

  let changed = true;
  while (changed && groups.length > 1) {
    changed = false;
    const smallIdx = groups.findIndex((g) => g.length < minLinesPerColumn);
    if (smallIdx === -1) break;

    const small = groups[smallIdx];
    const smallX = lines[small[0]].x;
    const leftDist = smallIdx > 0 ? Math.abs(smallX - lines[groups[smallIdx - 1][0]].x) : Infinity;
    const rightDist =
      smallIdx < groups.length - 1 ? Math.abs(smallX - lines[groups[smallIdx + 1][0]].x) : Infinity;
    const targetIdx = leftDist <= rightDist ? smallIdx - 1 : smallIdx + 1;

    groups[targetIdx] = [...groups[targetIdx], ...small].sort((a, b) => lines[a].x - lines[b].x);
    groups.splice(smallIdx, 1);
    changed = true;
  }

  return groups.length >= 2 ? groups : [lines.map((_, i) => i)];
}

/**
 * Rebuilds a page's reading-order text from raw pdf.js text items.
 * PDF origin is bottom-left, so a larger y means higher on the page — lines
 * are emitted in descending-y order (top to bottom); items within a line in
 * ascending-x order (left to right). With column detection on, columns are
 * emitted left-to-right, each fully top-to-bottom, rather than interleaved.
 */
export function reconstructPageText(
  items: TextItemLike[],
  pageWidth: number,
  detectColumnsEnabled: boolean,
): string {
  const rawLines = groupIntoLines(items);
  const lines: Line[] = rawLines
    .map((l) => {
      const sortedItems = [...l.items].sort((a, b) => a.x - b.x);
      return { y: l.y, x: sortedItems[0].x, text: joinLineItems(sortedItems) };
    })
    .filter((l) => l.text.length > 0);

  const byTopToBottom = (a: Line, b: Line) => b.y - a.y;

  if (!detectColumnsEnabled) {
    return [...lines].sort(byTopToBottom).map((l) => l.text).join('\n');
  }

  const groups = detectColumns(lines, pageWidth);
  if (groups.length < 2) {
    return [...lines].sort(byTopToBottom).map((l) => l.text).join('\n');
  }

  const orderedGroups = groups
    .map((idxArr) => ({ idxArr, minX: Math.min(...idxArr.map((i) => lines[i].x)) }))
    .sort((a, b) => a.minX - b.minX);

  return orderedGroups
    .map((g) =>
      g.idxArr
        .map((i) => lines[i])
        .sort(byTopToBottom)
        .map((l) => l.text)
        .join('\n'),
    )
    .join('\n\n');
}

export function estimateTokens(charCount: number): number {
  return Math.ceil(charCount / 4);
}

export function buildPageMarker(pageNumber: number, isImageOnly: boolean, imageCount: number): string {
  let marker = `--- page ${pageNumber} ---`;
  if (isImageOnly) {
    marker += ' [NO TEXT LAYER — image only]';
  } else if (imageCount > 0) {
    marker += ` [${imageCount} image${imageCount === 1 ? '' : 's'}]`;
  }
  return marker;
}

export function isImageOnlyPage(charCount: number): boolean {
  return charCount < IMAGE_ONLY_CHAR_THRESHOLD;
}

export function buildFrontMatter(meta: ConversionMeta): string {
  return [
    '---',
    `source: ${meta.fileName}`,
    `pages: ${meta.pageCount}`,
    `characters: ${meta.charCount}`,
    `estimated_tokens: ${meta.estimatedTokens}`,
    `image_only_pages: ${meta.imageOnlyPageCount}`,
    `pages_with_images: ${meta.pagesWithImagesCount}`,
    '---',
  ].join('\n');
}

/** Assembles the final .md content from per-page text + markers and a computed front-matter block. */
export function assembleMarkdown(
  fileName: string,
  pageBodies: { pageNumber: number; text: string; imageCount: number }[],
): ConversionResult {
  const pages: PageMeta[] = pageBodies.map(({ pageNumber, text, imageCount }) => ({
    pageNumber,
    charCount: text.length,
    isImageOnly: isImageOnlyPage(text.length),
    imageCount,
  }));

  const charCount = pages.reduce((sum, p) => sum + p.charCount, 0);
  const meta: ConversionMeta = {
    fileName,
    pageCount: pages.length,
    charCount,
    estimatedTokens: estimateTokens(charCount),
    imageOnlyPageCount: pages.filter((p) => p.isImageOnly).length,
    pagesWithImagesCount: pages.filter((p) => p.imageCount > 0).length,
    pages,
  };

  const body = pageBodies
    .map(({ pageNumber, text }, idx) => {
      const marker = buildPageMarker(pageNumber, pages[idx].isImageOnly, pages[idx].imageCount);
      return text ? `${marker}\n\n${text}` : marker;
    })
    .join('\n\n');

  const markdown = `${buildFrontMatter(meta)}\n\n${body}\n`;
  return { meta, markdown };
}
