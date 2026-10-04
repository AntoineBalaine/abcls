import * as fc from "fast-check";
import { ChordQuality, ParsedChord } from "../music-theory/types";
import { KeyAccidental, KeyRoot } from "../types/abcjs-ast";
import { irealChordTextRoundTrips } from "./chordShorthand";
import { Annotation, Bar, Cell, Ending, IrealChart, Navigation, Repeat, Section, TimeSignature } from "./gridAst";

/**
 * Generators of `IrealChart` trees, for the writer's fixpoint property.
 *
 * These build trees directly rather than generating grid text, because the
 * property under test runs the other way round: write a tree, parse what
 * was written, and compare. Generating text instead would only reach the
 * trees the parser happens to produce, where the point is to reach trees it
 * has never produced.
 *
 * Every tree generated here must be one the parser could have produced, or
 * the property fails for a reason that is about the generator rather than
 * about the writer. The constraints that enforce that are named where they
 * are applied.
 */

const rootArb = fc.constantFrom(KeyRoot.A, KeyRoot.B, KeyRoot.C, KeyRoot.D, KeyRoot.E, KeyRoot.F, KeyRoot.G);
const accidentalArb = fc.constantFrom(KeyAccidental.None, KeyAccidental.Sharp, KeyAccidental.Flat);

// Every quality the parser can produce. Power is included: a review
// measured that `C5` reads back as Power, the shorthand's own rule putting
// a digit 5 straight after the root ahead of the extension reading.
const qualityArb = fc.constantFrom(
  ChordQuality.Major,
  ChordQuality.Minor,
  ChordQuality.Dominant,
  ChordQuality.Diminished,
  ChordQuality.Augmented,
  ChordQuality.HalfDiminished,
  ChordQuality.Suspended2,
  ChordQuality.Suspended4,
  ChordQuality.Altered,
  ChordQuality.MinorMajor7,
  ChordQuality.DiminishedMajor7,
  ChordQuality.Power,
  ChordQuality.Add,
);

const alterationArb = fc.record({
  type: fc.constantFrom("flat" as const, "sharp" as const),
  degree: fc.constantFrom(5, 9, 11, 13),
});

export const chordArb: fc.Arbitrary<ParsedChord> = fc
  .record({
    root: rootArb,
    rootAccidental: accidentalArb,
    quality: qualityArb,
    extension: fc.constantFrom(null, 6, 7, 9, 11, 13),
    alterations: fc.uniqueArray(alterationArb, { maxLength: 2, selector: (a) => a.degree }),
    bass: fc.option(fc.record({ root: rootArb, accidental: accidentalArb }), { nil: null }),
  })
  .map((chord): ParsedChord => {
    // A power chord carrying an extension has no spelling, since the digit
    // 5 straight after the root is the quality itself; the parser cannot
    // produce one either. Extension 5 is left out of the arbitrary above
    // for the same reason: a dominant with a fifth and a power chord spell
    // the same text, which `ireal/KNOWN_GAPS.md` records.
    const extension = chord.quality === ChordQuality.Power ? null : chord.extension;
    // The dialect writes a quality symbol or nothing, and nothing means a
    // dominant, so only a dominant can be implicit.
    return { ...chord, extension, qualityExplicit: chord.quality !== ChordQuality.Dominant };
  })
  // Only chords the shorthand can spell unambiguously, which is what the
  // parser can produce. A flattened fifth with no extension writes `Ab5`
  // and reads back as an A flat power chord, for instance; the writer
  // reports such a chord, and the ambiguities themselves belong to
  // `chordShorthand.spec.ts` rather than to a property about structure.
  .filter(irealChordTextRoundTrips);

/**
 * A cell of any of the four kinds the parser can produce.
 *
 * Generating only chord cells left the writer's handling of the other
 * three reached by nothing but a handful of hand-written examples, which a
 * review found was the gap hiding a real defect. A back reference is
 * generated only in a leading position, since the parser leaves one
 * unresolved only when no chord was named before it; `leadingCellArb`
 * below is what may hold one.
 */
const chordCellArb: fc.Arbitrary<Cell> = fc
  .record({
    chord: chordArb,
    small: fc.boolean(),
    alternative: fc.option(chordArb, { nil: undefined }),
  })
  .map((cell): Cell => ({ kind: "chord", chord: cell.chord, small: cell.small, alternative: cell.alternative ?? undefined }));

const noChordCellArb: fc.Arbitrary<Cell> = fc
  .record({ small: fc.boolean(), alternative: fc.option(chordArb, { nil: undefined }) })
  .map((cell): Cell => ({ kind: "noChord", small: cell.small, alternative: cell.alternative ?? undefined }));

const backReferenceCellArb: fc.Arbitrary<Cell> = fc.oneof(
  fc.record({ small: fc.boolean() }).map((cell): Cell => ({ kind: "sameChord", small: cell.small })),
  fc
    .record({ small: fc.boolean(), root: rootArb, accidental: accidentalArb })
    .map((cell): Cell => ({
      kind: "sameChordWithBass",
      bass: { root: cell.root, accidental: cell.accidental },
      small: cell.small,
    })),
);

const cellArb: fc.Arbitrary<Cell> = fc.oneof(
  { arbitrary: chordCellArb, weight: 6 },
  { arbitrary: noChordCellArb, weight: 1 },
);

// Annotation text may hold no angle bracket, which would close the
// annotation early, and no leading digits that would read as the size code
// the parser strips.
const annotationArb: fc.Arbitrary<Annotation> = fc
  .stringMatching(/^[A-Za-z][A-Za-z0-9 .,']{0,14}$/)
  .map((text): Annotation => ({ text, position: 0 }));

function barOf(cells: fc.Arbitrary<Cell>): fc.Arbitrary<Bar> {
  return fc.record({
    cells: fc.array(cells, { minLength: 1, maxLength: 3 }),
    annotations: fc.array(annotationArb, { maxLength: 2 }),
    fermata: fc.boolean(),
  });
}

const barArb: fc.Arbitrary<Bar> = barOf(cellArb);

/**
 * A bar holding only cells that name no chord.
 *
 * This is the one place an unresolved back reference can stand, because the
 * parser resolves one against any chord named earlier in the text; a tree
 * with a chord before an unresolved reference is not one the parser can
 * produce, and generating it tested the writer against an impossible
 * input rather than against a chart.
 */
const leadingBarArb: fc.Arbitrary<Bar> = barOf(
  fc.oneof({ arbitrary: backReferenceCellArb, weight: 3 }, { arbitrary: noChordCellArb, weight: 1 }),
);

const timeSignatureArb: fc.Arbitrary<TimeSignature> = fc.constantFrom<TimeSignature[]>(
  { numerator: 4, denominator: 4 },
  { numerator: 3, denominator: 4 },
  { numerator: 6, denominator: 8 },
  { numerator: 12, denominator: 8 },
);

const labelArb = fc.constantFrom("A", "B", "C", "D", "i", "v");

/**
 * A section, with the shapes the parser can produce and no others.
 *
 * A section always holds at least one bar somewhere, since the parser drops
 * one that holds none, which is the filter at the end.
 */
function sectionOf(bars: fc.Arbitrary<Bar>): fc.Arbitrary<Section> {
  return fc
  .record({
    bars: fc.array(bars, { maxLength: 4 }),
    label: fc.option(labelArb, { nil: undefined }),
    timeSignature: fc.option(timeSignatureArb, { nil: undefined }),
    repeatKind: fc.constantFrom("none" as const, "simple" as const, "endings" as const),
    // An ending may hold no bar, and the numbers need not be consecutive;
    // a review measured that both round-trip.
    endingBars: fc.array(fc.array(barArb, { maxLength: 2 }), { maxLength: 3 }),
    endingNumbers: fc.array(fc.integer({ min: 1, max: 12 }), { maxLength: 3 }),
  })
  .map((spec): Section => {
    const section: Section = { bars: spec.bars };
    if (spec.label !== undefined) section.label = spec.label;
    if (spec.timeSignature !== undefined) section.timeSignature = spec.timeSignature;
    if (spec.repeatKind === "simple") {
      section.repeat = { kind: "simple" };
    } else if (spec.repeatKind === "endings") {
      const endings: Ending[] = spec.endingBars.map((bars, index) => ({
        number: spec.endingNumbers[index] ?? index + 1,
        bars,
      }));
      const repeat: Repeat = { kind: "endings", endings };
      if (endings.length > 0) section.repeat = repeat;
      else section.repeat = { kind: "simple" };
    }
    return section;
  })
  .filter((section) => section.bars.length > 0 || (section.repeat?.endings ?? []).some((e) => e.bars.length > 0));
}

const sectionArb = sectionOf(barArb);

/**
 * The chart's first section.
 *
 * Its bars are ordinary, except that it may open with a bar naming no
 * chord, which is where an unresolved back reference can appear.
 */
const leadingSectionArb: fc.Arbitrary<Section> = fc
  .tuple(fc.option(leadingBarArb, { nil: undefined }), sectionOf(barArb))
  .map(([opening, section]) =>
    opening === undefined ? section : { ...section, bars: [opening, ...section.bars] },
  );

/**
 * A chart, with navigation markers pointing only at positions the parser
 * can record: a section index, or the one index past the last section.
 */
export const chartArb: fc.Arbitrary<IrealChart> = fc
  .record({
    leading: leadingSectionArb,
    rest: fc.array(sectionArb, { maxLength: 3 }),
    segno: fc.option(fc.nat(4), { nil: undefined }),
    coda: fc.option(fc.nat(4), { nil: undefined }),
    partMarkers: fc.array(fc.nat(4), { maxLength: 2 }),
    annotations: fc.array(annotationArb, { maxLength: 1 }),
  })
  .map((spec): IrealChart => {
    const sections = [spec.leading, ...spec.rest];
    const limit = sections.length;
    const navigation: Navigation = { partMarkerSections: spec.partMarkers.map((n) => n % (limit + 1)).sort((a, b) => a - b) };
    if (spec.segno !== undefined) navigation.segnoSectionIndex = spec.segno % (limit + 1);
    if (spec.coda !== undefined) navigation.codaSectionIndex = spec.coda % (limit + 1);
    return { sections, navigation, annotations: spec.annotations };
  });
