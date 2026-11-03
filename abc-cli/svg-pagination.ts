/**
 * svg-pagination.ts
 *
 * Arranges the SVG of the lines of music onto pages of a fixed size, so that an external tool
 * (such as rsvg-convert) can turn the pages into a PDF. Because a line of music must never be cut
 * by the end of a page, we measure each line and start a new page when the next line does not fit.
 */

/**
 * The geometry of a page, in the units of the SVG (pixels at 96 per inch).
 * The default is A4 portrait with a margin of about one centimetre.
 */
export interface PageGeometry {
  width: number;
  height: number;
  margin: number;
}

export const A4_PORTRAIT: PageGeometry = { width: 794, height: 1123, margin: 40 };

/** One line of music, with the size it was drawn at. */
interface Measured {
  /** The opening tag of the svg element, without the attributes that place it. */
  attributes: string;
  /** What lies between the opening and closing tags of the svg element. */
  inner: string;
  width: number;
  height: number;
  viewBox: string;
}

/** Reads one attribute of an opening tag. */
function readAttribute(attributes: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attributes);
  return match === null ? null : match[1];
}

/** Removes the attributes that we set ourselves, so they cannot appear twice in the opening tag. */
function withoutAttributes(attributes: string, names: string[]): string {
  let result = attributes;
  for (const name of names) {
    result = result.replace(new RegExp(`\\s${name}="[^"]*"`, "g"), "");
  }
  return result;
}

/**
 * Reads the size of an SVG that abcjs drew.
 *
 * @returns The measured line, or null when the text is not an svg element or has no readable size
 */
export function measureSvg(svg: string): Measured | null {
  const open = /^\s*<svg\b([^>]*)>/.exec(svg);
  const close = svg.lastIndexOf("</svg>");
  if (open === null || close < 0) return null;

  const attributes = open[1];
  let width = parseFloat(readAttribute(attributes, "width") ?? "");
  let height = parseFloat(readAttribute(attributes, "height") ?? "");
  let viewBox = readAttribute(attributes, "viewBox");

  // Because an svg may give only a view box, we fall back on its size.
  if (viewBox !== null && (!Number.isFinite(width) || !Number.isFinite(height))) {
    const parts = viewBox.split(/[\s,]+/).map(parseFloat);
    width = parts[2];
    height = parts[3];
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  if (viewBox === null) viewBox = `0 0 ${width} ${height}`;

  return {
    attributes: withoutAttributes(attributes, ["x", "y", "width", "height", "viewBox"]),
    inner: svg.slice(open[0].length, close),
    width,
    height,
    viewBox,
  };
}

/**
 * Places the lines of each tune on pages.
 *
 * Each tune starts on a new page, a line that does not fit in what is left of a page starts the next page,
 * and a line wider than the page is scaled down to fit its width (a narrower line keeps its size).
 *
 * @param tunes The SVG of the lines of each tune, in order
 * @returns One SVG per page
 */
export function paginateSvgs(tunes: string[][], geometry: PageGeometry = A4_PORTRAIT): string[] {
  const contentWidth = geometry.width - 2 * geometry.margin;
  const bottom = geometry.height - geometry.margin;
  const pages: string[] = [];

  for (const tune of tunes) {
    const page: PageInProgress = { body: [], y: geometry.margin };

    for (const svg of tune) {
      const line = measureSvg(svg);
      if (line === null) continue;
      const scale = Math.min(1, contentWidth / line.width);
      const height = line.height * scale;
      if (page.body.length > 0 && page.y + height > bottom) flushPage(page, geometry, pages);

      page.body.push(
        `<svg${line.attributes} x="${geometry.margin}" y="${page.y.toFixed(2)}" width="${(line.width * scale).toFixed(2)}" ` +
          `height="${height.toFixed(2)}" viewBox="${line.viewBox}">${line.inner}</svg>`
      );
      page.y += height;
    }
    flushPage(page, geometry, pages);
  }
  return pages;
}

/** The page being filled by paginateSvgs: the lines placed on it, and the height they reach. */
export interface PageInProgress {
  body: string[];
  y: number;
}

/**
 * Writes the page being filled, if it holds a line, and starts an empty page at the top margin.
 */
export function flushPage(page: PageInProgress, geometry: PageGeometry, pages: string[]): void {
  if (page.body.length > 0) {
    pages.push(
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${geometry.width}" height="${geometry.height}" ` +
        `viewBox="0 0 ${geometry.width} ${geometry.height}"><rect width="${geometry.width}" height="${geometry.height}" fill="white"/>${page.body.join("")}</svg>`
    );
  }
  page.body = [];
  page.y = geometry.margin;
}
