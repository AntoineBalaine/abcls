/**
 * svg-chords.ts
 *
 * Sets the chord symbols of an SVG that abcjs drew in the way a chord chart prints them.
 *
 * Because the font of the chords (Times) has no glyph for the flat, the sharp or the major seventh triangle,
 * the system draws those characters with a fallback symbol font at the full size of the chord, and they come out
 * far larger than the letters. Therefore we cut each chord into segments: the letters keep their size, the
 * accidentals become a little smaller and sit slightly higher, and the triangle and the degree sign become small
 * superscripts, like the superscript seven that the font does draw.
 */

interface Segment {
  text: string;
  /** The font size, as a fraction of the size of the chord. */
  size: number;
  /** How far the baseline is raised, as a fraction of the size of the chord. */
  raise: number;
  /** True when the symbol must be drawn with the symbol fonts, because the font of the chords has no glyph for it. */
  symbol?: boolean;
}

/** The characters that print as accidentals. */
const ACCIDENTALS = new Set(["♭", "♯"]);

/** The characters that print as small superscripts. */
const SUPERSCRIPTS = new Set(["▵", "△", "Δ", "°", "ø", "Ø"]);

/**
 * The fonts that draw the symbols, in order of preference. Because the system picks the fallback font by itself
 * when we name none, and picks one with wide side bearings, we name fonts that set these glyphs closely.
 * Each is followed by the font of the chords, which is what the system falls back on when none is installed.
 */
export const SYMBOL_FONTS = "STIX Two Math, STIX Two Text, STIXGeneral, Times New Roman";

const PLAIN: Omit<Segment, "text"> = { size: 1, raise: 0 };
const ACCIDENTAL: Omit<Segment, "text"> = { size: 0.75, raise: 0.18, symbol: true };
const SUPERSCRIPT: Omit<Segment, "text"> = { size: 0.62, raise: 0.4, symbol: true };

/** Cuts a chord into runs of characters that share a style. */
export function segmentChord(text: string): Segment[] {
  const segments: Segment[] = [];
  for (const character of text) {
    const style = ACCIDENTALS.has(character) ? ACCIDENTAL : SUPERSCRIPTS.has(character) ? SUPERSCRIPT : PLAIN;
    const last = segments[segments.length - 1];
    if (last !== undefined && last.size === style.size && last.raise === style.raise && last.symbol === style.symbol) {
      last.text += character;
    } else {
      segments.push({ text: character, ...style });
    }
  }
  return segments;
}

function format(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * Rewrites the chord symbols of an SVG.
 *
 * @param svg The SVG that abcjs drew, as text
 * @returns The same SVG, with each chord that holds an accidental or a superscript symbol cut into sized segments
 */
export function styleChordSymbols(svg: string): string {
  return svg.replace(
    /(<text\b[^>]*\bdata-name="chord"[^>]*>)<tspan x="([^"]*)">([^<]*)<\/tspan>(<\/text>)/g,
    (whole: string, open: string, x: string, text: string, close: string) => {
      const segments = segmentChord(text);
      if (segments.length === 1 && segments[0].size === 1) return whole;

      const fontSize = parseFloat(/\bfont-size="([^"]*)"/.exec(open)?.[1] ?? "");
      if (!Number.isFinite(fontSize)) return whole;

      let currentRaise = 0;
      const parts = segments.map((segment, index) => {
        // Because dy moves the baseline relative to where the previous segment left it, we move by the difference.
        const dy = -(segment.raise - currentRaise) * fontSize;
        currentRaise = segment.raise;
        const attributes = [index === 0 ? `x="${x}"` : "", segment.symbol ? `font-family="${SYMBOL_FONTS}"` : "", segment.size !== 1 ? `font-size="${format(segment.size * fontSize)}"` : index > 0 ? `font-size="${format(fontSize)}"` : "", dy !== 0 ? `dy="${format(dy)}"` : ""]
          .filter((attribute) => attribute !== "")
          .join(" ");
        return `<tspan${attributes === "" ? "" : " " + attributes}>${segment.text}</tspan>`;
      });
      return `${open}${parts.join("")}${close}`;
    }
  );
}
