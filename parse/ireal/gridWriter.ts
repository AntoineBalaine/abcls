/**
 * Writes an `IrealChart` back out as iReal Pro grid text.
 *
 * This is the inverse of `gridParser.ts`, and the two are checked against
 * each other rather than against fixtures alone: parsing what this writes
 * must reproduce the tree it was given, which `plans/4.abcx-to-ireal-export.md`
 * section 9 asserts over a real 657-chart library and over generated trees.
 *
 * It normalises rather than reproducing a chart byte for byte. The tree has
 * already resolved every back reference, so a bar that was written `x` or
 * `p` comes out as the chord it stood for; whitespace, layout hints and
 * padding are not reproduced; a repeat always closes with `}` where the
 * chart may have used `]`; and a repeat whose opening brace was never
 * closed is closed. None of those changes the tree on a reparse, which is
 * the property that matters.
 *
 * Where a tree holds something iReal Pro's language cannot say, this
 * reports it rather than writing text that says something else. That is
 * the division of labour in section 3 of the plan: reading is where a
 * construct may be unrepresentable and writing is where it may be
 * inexpressible, and a silent writer would leave a consumer unable to tell
 * which happened. Most of those conditions cannot arise from a tree the
 * parser built and can arise from one assembled by hand or read out of
 * ABCx, which is what phase B will do.
 */

import { ChordQuality, ParsedChord } from "../music-theory/types";
import { ABCContext } from "../parsers/Context";
import { Token, TT } from "../parsers/scan";
import { ParserErrorType } from "../types/types";
import { irealChordTextRoundTrips, parsedChordToIrealText } from "./chordShorthand";
import { Annotation, Bar, Bass, Cell, IrealChart, Repeat, Section, TimeSignature } from "./gridAst";

/**
 * What the writer has emitted so far, as far as a later cell depends on it.
 *
 * A back reference binds to the last chord named earlier in the text, so
 * whether one can be written at all depends on what was written before it.
 */
interface WriteState {
  chordWritten: boolean;
  /**
   * Whether the chords being written are small. Because an `s` marker lasts
   * until an `l` marker, the writer marks only where small chords begin
   * and where they end, rather than every small chord.
   */
  small: boolean;
}

function report(ctx: ABCContext, message: string): void {
  const reported = new Token(TT.INVALID, "", ctx.generateId());
  ctx.errorReporter.report(message, reported, ParserErrorType.PARSER);
}

/** `T12` is twelve eight; every other code is a numerator then a denominator. */
function timeSignatureText(ts: TimeSignature, ctx: ABCContext): string {
  if (ts.numerator === 12 && ts.denominator === 8) return "T12";
  if (ts.numerator > 9 || ts.denominator > 9) {
    report(ctx, `A time signature of ${ts.numerator}/${ts.denominator} has no iReal Pro spelling`);
    return "";
  }
  // One over two spells the same three characters as twelve eight, which is
  // the one code whose digits are not a fraction, so it cannot be written.
  if (ts.numerator === 1 && ts.denominator === 2) {
    report(ctx, "A time signature of 1/2 cannot be written, since T12 already spells 12/8");
    return "";
  }
  return `T${ts.numerator}${ts.denominator}`;
}

function bassText(bass: Bass): string {
  return bass.root + bass.accidental;
}

/**
 * An annotation, delimited and escaped.
 *
 * The parser strips one leading size code from an annotation's text, so
 * text that begins with one is written behind a second code for it to
 * strip; without that the three characters are lost on every round trip. A
 * delimiter inside the text has no escape at all and is removed, because
 * leaving it would end the annotation early and turn the rest into chords.
 */
function annotationText(annotation: Annotation, ctx: ABCContext): string {
  let text = annotation.text;
  if (/[<>|]/.test(text)) {
    report(ctx, `An annotation's text cannot hold '<', '>' or '|': ${JSON.stringify(text)}`);
    text = text.replace(/[<>|]/g, "");
  }
  if (/^\*\d\d/.test(text)) text = `*00${text}`;
  return `<${text}>`;
}

/**
 * A chord's text, checked against the reading it will be given.
 *
 * The check is the inverse function rather than a list of known
 * ambiguities, because the shorthand has several and enumerating them
 * invites missing one. An alteration on a chord with no extension is the
 * case that prompted this: a flattened fifth on A writes `Ab5`, which
 * reads back as an A flat power chord, so the text says a different chord
 * from the one it was given. Running the reader over the writer's own
 * output costs nothing here and turns every such ambiguity into a report.
 */
function chordText(chord: ParsedChord | undefined, ctx: ABCContext): string {
  if (chord === undefined) {
    report(ctx, "A chord cell carries no chord");
    return "";
  }
  // The dialect writes a quality symbol or nothing, and nothing means a
  // dominant, so an unspoken quality of any other kind cannot be said.
  if (!chord.qualityExplicit && chord.quality !== ChordQuality.Dominant) {
    report(ctx, `A chord of quality '${chord.quality}' marked as not explicit has no iReal Pro spelling`);
  }
  const text = parsedChordToIrealText(chord);
  if (!irealChordTextRoundTrips(chord)) {
    report(ctx, `A chord written as '${text}' does not read back as itself`);
  }
  return text;
}

function cellText(cell: Cell, state: WriteState, ctx: ABCContext): string {
  const parts: string[] = [];
  if (cell.small && !state.small) parts.push("s");
  if (!cell.small && state.small) parts.push("l");
  state.small = cell.small;

  if (cell.kind === "chord") {
    const text = chordText(cell.chord, ctx);
    if (text === "") return "";
    parts.push(text);
    state.chordWritten = true;
  } else if (cell.kind === "noChord") {
    parts.push("n");
  } else if (state.chordWritten) {
    // The parser leaves a back reference unresolved only when no chord was
    // named before it, so one that now follows a chord cannot be written:
    // `p` would bind to that chord and say what the tree does not. This
    // arises where a section holding an unresolved reference is written
    // after a section holding chords, which the tree's own order can
    // require and the text's order cannot express.
    report(ctx, "A back reference that named no chord now follows one, and is written as no chord instead");
    parts.push("n");
  } else if (cell.kind === "sameChordWithBass") {
    if (cell.bass === undefined) {
      report(ctx, "A back reference over a bass carries no bass, and is written as a plain back reference");
      parts.push("p");
    } else {
      parts.push(`W/${bassText(cell.bass)}`);
    }
  } else {
    parts.push("p");
  }

  // An alternative chord does not become the chord a later back reference
  // binds to, so writing one leaves the state alone.
  if (cell.alternative) parts.push(`(${chordText(cell.alternative, ctx)})`);
  return parts.join("");
}

/**
 * A bar, written as the run of cells it occupies.
 *
 * A space is one empty cell, so the padding is the layout: a chord on the
 * third cell of four is a chord with two spaces before it, which is what
 * says it falls on the third beat. Nothing may be joined with a space for
 * readability here, since a space is content.
 *
 * The fermata and the annotations are not cells and occupy none, so they
 * lead the bar and sit flush against the first cell.
 */
function barText(bar: Bar, state: WriteState, ctx: ABCContext): string {
  const parts: string[] = [];
  if (bar.fermata) parts.push("f");
  for (const annotation of bar.annotations) parts.push(annotationText(annotation, ctx));

  const bySlot = new Map<number, Cell>();
  const beyond: Cell[] = [];
  for (const cell of bar.cells) {
    if (cell.slot >= 0 && cell.slot < bar.cellCount && !bySlot.has(cell.slot)) bySlot.set(cell.slot, cell);
    else beyond.push(cell);
  }
  if (beyond.length > 0) {
    report(ctx, `A bar holds ${beyond.length} cell(s) with no position inside its ${bar.cellCount} cells`);
  }

  for (let slot = 0; slot < bar.cellCount; slot++) {
    const cell = bySlot.get(slot);
    parts.push(cell === undefined ? " " : cellText(cell, state, ctx));
  }
  for (const cell of beyond) parts.push(cellText(cell, state, ctx));
  return parts.join("");
}

/**
 * The bars of one section, separated by a barline and nothing else.
 *
 * No space is written around the separator, because a space beside it
 * would be read as an empty cell of the bar it touches and widen that bar
 * by one.
 */
function barsText(bars: Bar[], state: WriteState, ctx: ABCContext): string {
  return bars.map((bar) => barText(bar, state, ctx)).join("|");
}

/** A label is one character, which is all the `*X` marker has room for. */
function labelText(label: string, ctx: ABCContext): string {
  if (/^\w$/.test(label)) return `*${label}`;
  report(ctx, `A section label must be one word character, and ${JSON.stringify(label)} is not`);
  const first = label.match(/\w/);
  return first === null ? "" : `*${first[0]}`;
}

/**
 * The markers that record a position in the chart rather than belonging to
 * a bar.
 *
 * The parser reads each as the index of the section that follows it, so
 * they are written immediately after a section's opening delimiter, at
 * which point every earlier section has closed and the count matches.
 */
function navigationText(chart: IrealChart, sectionIndex: number): string {
  const parts: string[] = [];
  if (chart.navigation.segnoSectionIndex === sectionIndex) parts.push("S");
  if (chart.navigation.codaSectionIndex === sectionIndex) parts.push("Q");
  for (const index of chart.navigation.partMarkerSections) {
    if (index === sectionIndex) parts.push("U");
  }
  return parts.join("");
}

/**
 * Navigation indexes with nowhere to go.
 *
 * A marker is written at the section it names, or in the one slot after
 * the last section; an index beyond that names no position in the text and
 * would be dropped silently.
 */
function reportUnreachableNavigation(chart: IrealChart, ctx: ABCContext): void {
  const limit = chart.sections.length;
  const beyond = (index: number | undefined): boolean => index !== undefined && index > limit;
  if (beyond(chart.navigation.segnoSectionIndex)) report(ctx, "A segno names a section the chart does not have");
  if (beyond(chart.navigation.codaSectionIndex)) report(ctx, "A coda names a section the chart does not have");
  if (chart.navigation.partMarkerSections.some((index) => index > limit)) {
    report(ctx, "A part marker names a section the chart does not have");
  }
}

function reportUnwritableRepeat(repeat: Repeat, ctx: ABCContext): void {
  if (repeat.kind === "endings" && (repeat.endings ?? []).length === 0) {
    report(ctx, "A repeat with numbered endings holds none, and is written as a plain repeat");
  }
}

function sectionText(section: Section, chart: IrealChart, index: number, state: WriteState, ctx: ABCContext): string {
  const repeat = section.repeat;
  const parts: string[] = [];
  if (repeat) reportUnwritableRepeat(repeat, ctx);

  // The brace and the bracket are the two repeat barlines rather than a
  // matched pair, so a repeated section opens with a brace and a plain one
  // with a bracket.
  parts.push(repeat ? "{" : "[");

  parts.push(navigationText(chart, index));
  if (section.label !== undefined) parts.push(labelText(section.label, ctx));
  if (section.timeSignature !== undefined) parts.push(timeSignatureText(section.timeSignature, ctx));
  parts.push(barsText(section.bars, state, ctx));

  // An ending's own marker ends the bar before it, so no separator is
  // written between the common bars and the first ending.
  for (const ending of repeat?.endings ?? []) {
    parts.push(`N${ending.number}`);
    parts.push(barsText(ending.bars, state, ctx));
  }

  // A repeat is closed even when the chart left it open. The parser
  // reports an unclosed brace and marks the repeat, which is a fact about
  // malformed input rather than about the music, and writing a chart that
  // says what it means is worth losing that one flag.
  parts.push(repeat ? "}" : "]");
  // Joined with nothing at all. A space between a marker and a bar would
  // be read as an empty first cell of that bar and shift every chord in it
  // along by one, which is the whole reason the padding is meaningful.
  return parts.join("");
}

export function writeGrid(chart: IrealChart, ctx: ABCContext): string {
  const state: WriteState = { chordWritten: false, small: false };
  reportUnreachableNavigation(chart, ctx);

  const parts: string[] = [];
  for (let index = 0; index < chart.sections.length; index++) {
    parts.push(sectionText(chart.sections[index], chart, index, state, ctx));
  }
  // A marker standing after the last section has no section to lead, and
  // the parser records it against the index one past the end. One chart in
  // the sample library writes a part marker there, and without this slot
  // it had nowhere to go.
  parts.push(navigationText(chart, chart.sections.length));
  // An annotation belonging to no bar is one the parser carried past the
  // last bar, so writing it after every section is what makes it carry
  // again rather than attaching to a bar.
  for (const annotation of chart.annotations) parts.push(annotationText(annotation, ctx));
  parts.push("Z");
  return parts.join("");
}
