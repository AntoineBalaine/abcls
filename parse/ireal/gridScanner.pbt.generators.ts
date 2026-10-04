import * as fc from "fast-check";
import { GridTT } from "./gridTokens";

/**
 * Generators for property-based testing of `gridScanner.ts`.
 *
 * Following the pattern of `../analyzers/info-line-analyzer.pbt.generators.ts`,
 * a generator returns both the rendered text and the expectation it was
 * rendered from, so the properties in `gridScanner.pbt.spec.ts` can compare
 * the scanner against an independent expectation rather than only against
 * itself.
 *
 * Every lexeme here is written in iReal Pro's own chord dialect, not
 * ABC's: minor seventh is `D-7`, major seventh is `C^7`, half-diminished
 * is `Ch7`.
 */

/** One construct of the grammar, as the text that spells it and the type it must scan to. */
export interface TokenSpec {
  text: string;
  type: GridTT;
}

/** A generated grid, as the text handed to the scanner and the types it must produce. */
export interface GeneratedGrid {
  text: string;
  expectedTypes: GridTT[];
}

function specs(type: GridTT, texts: string[]): TokenSpec[] {
  return texts.map((text) => ({ text, type }));
}

export const CHORD_SPECS: TokenSpec[] = specs(GridTT.CHORD, [
  "C",
  "C7",
  "C-7",
  "C^7",
  "Ch7",
  "Co7",
  "C+",
  "C6",
  "C69",
  "C7alt",
  "C-^7",
  "Csus",
  "G7sus",
  "A9sus",
  "Cadd9",
  "Bb7",
  "F#-7",
  "Ab^9",
  "Eb7sus",
  "Bb7#11",
  "G7b9",
  "C-7/F",
  "Bb-7/Ab",
  "F6/A",
]);

/**
 * Every non-chord construct of section 4 of the plan. The texts are chosen
 * so that no two of them, written with no space between them, spell a
 * third, longer construct; the glued-cell generator below relies on that.
 */
export const OTHER_SPECS: TokenSpec[] = [
  ...specs(GridTT.BAR, ["|"]),
  ...specs(GridTT.NO_CHORD, ["n"]),
  ...specs(GridTT.REPEAT_ONE_BAR, ["x"]),
  ...specs(GridTT.REPEAT_TWO_BARS, ["r"]),
  ...specs(GridTT.SAME_CHORD, ["p"]),
  ...specs(GridTT.PAD, [","]),
  ...specs(GridTT.SECTION_OPEN, ["["]),
  ...specs(GridTT.SECTION_CLOSE, ["]"]),
  ...specs(GridTT.REPEAT_OPEN, ["{"]),
  ...specs(GridTT.REPEAT_CLOSE, ["}"]),
  ...specs(GridTT.ENDING, ["N1", "N2", "N3"]),
  ...specs(GridTT.SECTION_LABEL, ["*A", "*B", "*C", "*D", "*i", "*v"]),
  ...specs(GridTT.TIME_SIGNATURE, ["T44", "T34", "T68", "T24"]),
  ...specs(GridTT.ANNOTATION, ["<Solos>", "<*64Open Feel>", "<Even 8's>", "<Arturo LLedó>", "<rit.....>", "<D.C. al Coda>", "<Fine>", "<3x>"]),
  ...specs(GridTT.ALTERNATIVE_CHORD, ["(D7)", "(Gb7)", "(C-^7)"]),
  ...specs(GridTT.SEGNO, ["S"]),
  ...specs(GridTT.CODA, ["Q"]),
  ...specs(GridTT.PART_MARKER, ["U"]),
  ...specs(GridTT.FERMATA, ["f"]),
  ...specs(GridTT.SMALL, ["s"]),
  ...specs(GridTT.LAYOUT, ["l"]),
  ...specs(GridTT.SPACER, ["Y"]),
  ...specs(GridTT.END, ["Z"]),
];

export const ALL_SPECS: TokenSpec[] = [...CHORD_SPECS, ...OTHER_SPECS];

export const genChordSpec: fc.Arbitrary<TokenSpec> = fc.constantFrom(...CHORD_SPECS);
export const genTokenSpec: fc.Arbitrary<TokenSpec> = fc.constantFrom(...ALL_SPECS);

/**
 * A separator between two cells: either nothing, because real charts glue
 * labels, time signatures and chords together, or one run of spaces.
 *
 * A run rather than a single space is what real charts hold, and it must
 * stay a single run: two adjacent runs would scan as one whitespace token
 * and the expectation would no longer match.
 */
export const genSeparator: fc.Arbitrary<string> = fc.oneof(fc.constant(""), fc.constant(" "), fc.constant("  "), fc.constant("   "));

function renderGrid(cells: TokenSpec[], separators: string[]): GeneratedGrid {
  let text = "";
  const expectedTypes: GridTT[] = [];
  for (let i = 0; i < cells.length; i++) {
    const separator = separators[i] ?? "";
    if (separator.length > 0) {
      text += separator;
      expectedTypes.push(GridTT.WHITESPACE);
    }
    text += cells[i].text;
    expectedTypes.push(cells[i].type);
  }
  const trailing = separators[cells.length] ?? "";
  if (trailing.length > 0) {
    text += trailing;
    expectedTypes.push(GridTT.WHITESPACE);
  }
  return { text, expectedTypes };
}

/** A grid built from any construct of the grammar, with varying gluing and spacing. */
export const genGrid: fc.Arbitrary<GeneratedGrid> = fc
  .tuple(fc.array(genTokenSpec, { minLength: 1, maxLength: 24 }), fc.array(genSeparator, { minLength: 25, maxLength: 25 }))
  .map(([cells, separators]) => renderGrid(cells, separators));

/** A grid shaped like a real chart: a label, a time signature, then bars of chords. */
export const genChartLikeGrid: fc.Arbitrary<GeneratedGrid> = fc
  .tuple(
    fc.constantFrom(...OTHER_SPECS.filter((s) => s.type === GridTT.SECTION_LABEL)),
    fc.constantFrom(...OTHER_SPECS.filter((s) => s.type === GridTT.TIME_SIGNATURE)),
    fc.array(fc.array(genChordSpec, { minLength: 1, maxLength: 3 }), { minLength: 1, maxLength: 8 }),
    fc.array(genSeparator, { minLength: 64, maxLength: 64 })
  )
  .map(([label, meter, bars, separators]) => {
    const cells: TokenSpec[] = [{ text: "{", type: GridTT.REPEAT_OPEN }, label, meter];
    for (const bar of bars) {
      cells.push(...bar);
      cells.push({ text: "|", type: GridTT.BAR });
    }
    cells.push({ text: "}", type: GridTT.REPEAT_CLOSE }, { text: "Z", type: GridTT.END });
    return renderGrid(cells, separators);
  });

/**
 * Printable ASCII, for the termination property. This deliberately
 * includes characters the grammar does not know, since the scanner has to
 * be a total function over arbitrary text rather than only over valid
 * grids.
 */
export const genPrintableAscii: fc.Arbitrary<string> = fc.string({ unit: fc.constantFrom(...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i))), maxLength: 120 });
