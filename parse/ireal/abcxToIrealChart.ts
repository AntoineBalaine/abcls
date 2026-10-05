/**
 * Reads an ABCx tune into an `IrealChart` and into the fields of an iReal
 * Pro link.
 *
 * This is the reading half of the export, and `gridWriter.ts` is the
 * writing half. Keeping them apart is the decision in
 * `plans/4.abcx-to-ireal-export.md` section 3: reading is where a construct
 * may be unrepresentable, writing is where it may be inexpressible, and a
 * single pass that assembled grid text while walking the ABCx tree would
 * hide which of the two had failed. That pass is also what the old
 * converter did, and why it silently dropped every repeat, ending, section
 * label and annotation a chart had.
 *
 * Every construct read here was measured against the ABCx parser rather
 * than assumed; section 5 of the plan records what the tree carries and
 * `ireal/KNOWN_GAPS.md` records the two spellings that turned out not to
 * exist.
 */

import { parseChordSymbol } from "../music-theory/parseChordSymbol";
import { scanChordSymbol } from "../music-theory/scanChordSymbol";
import { ParsedChord } from "../music-theory/types";
import { ABCContext } from "../parsers/Context";
import { Token, TT } from "../parsers/scan";
import { Annotation as AbcAnnotation, BarLine, ChordSymbol, Directive, Info_line, Inline_field, Tune } from "../types/Expr";
import { ParserErrorType } from "../types/types";
import { IrealSongFields } from "./fields";
import { Annotation, Bar, Cell, Ending, IrealChart, Navigation, Repeat, Section, TimeSignature } from "./gridAst";

function report(ctx: ABCContext, message: string, lexeme: string, position: number): void {
  const reported = new Token(TT.INVALID, lexeme, ctx.generateId());
  reported.position = position;
  ctx.errorReporter.report(message, reported, ParserErrorType.PARSER);
}

/** The text of a `"..."` annotation, without its quotes or placement prefix. */
function annotationBody(lexeme: string): string {
  return lexeme.replace(/^"/, "").replace(/"$/, "").replace(/^[\^_<>@]/, "");
}

/**
 * The navigation marker an annotation names, if it names one.
 *
 * ABCx has no decoration syntax: `!segno!` and `+segno+` both scan into
 * error nodes and stray chord symbols, which was measured rather than
 * assumed. A quoted annotation is what parses cleanly, so `"^segno"` and
 * `"^coda"` are the agreed spelling, and an annotation whose whole text is
 * one of those words is read as the marker rather than as text to print.
 */
function navigationMarker(text: string): "segno" | "coda" | null {
  const word = text.trim().toLowerCase();
  if (word === "segno") return "segno";
  if (word === "coda") return "coda";
  return null;
}

/** A `[M:3/4]` field as a time signature, or null when it is not one. */
function parseMeter(text: string, ctx: ABCContext, position: number): TimeSignature | null {
  const match = text.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (match === null) {
    report(ctx, `A time signature of '${text}' cannot be read`, text, position);
    return null;
  }
  return { numerator: parseInt(match[1], 10), denominator: parseInt(match[2], 10) };
}

/**
 * The chord an ABCx chord symbol names.
 *
 * A partial scan is refused rather than trusted. The chord scanner
 * recognises only a lowercase `maj`, so `BbMaj7` scans as `Bb` alone, and
 * accepting that would export a truncated chord that still looks like a
 * chord.
 */
function readChord(lexeme: string, ctx: ABCContext, position: number): ParsedChord | null {
  const scanned = scanChordSymbol(lexeme);
  if (scanned === null || scanned.consumed !== lexeme.length) {
    report(ctx, `Could not read the chord symbol '${lexeme}' for iReal Pro export`, lexeme, position);
    return null;
  }
  const parsed = parseChordSymbol(scanned.tokens);
  if (parsed === null) {
    report(ctx, `Could not read the chord symbol '${lexeme}' for iReal Pro export`, lexeme, position);
    return null;
  }
  return parsed;
}

/** What a barline's own characters say about the repeat around it. */
interface BarlineMeaning {
  closesRepeat: boolean;
  opensRepeat: boolean;
  endsSection: boolean;
}

/**
 * Reads a barline's text.
 *
 * A colon before the bar closes a repeat and one after it opens a repeat,
 * which makes `::` both. A lone colon is only an opening: it is the second
 * half of `:|:`, which the ABCx parser splits into `:|` and `:`, so the
 * closing half has already been seen.
 */
function barlineMeaning(text: string): BarlineMeaning {
  return {
    closesRepeat: text.length > 1 && text.startsWith(":"),
    opensRepeat: text.endsWith(":"),
    // A doubled or bracketed barline ends a section, the way iReal Pro's
    // own `]` does; a plain `|` only ends a bar.
    endsSection: /\|\||\|\]|\[\|/.test(text),
  };
}

/** The state a walk of one tune carries. */
interface Walk {
  sections: Section[];
  navigation: Navigation;
  chartAnnotations: Annotation[];
  open: Section | null;
  pendingLabel?: string;
  pendingTimeSignature?: TimeSignature;
  cells: Cell[];
  annotations: Annotation[];
  /** The section a numbered ending attaches to, which outlives its repeat's close. */
  endingsOwner: Section | null;
  currentEnding: Ending | null;
}

function ensureSection(walk: Walk): Section {
  if (walk.open === null) {
    const section: Section = { bars: [] };
    if (walk.pendingLabel !== undefined) section.label = walk.pendingLabel;
    if (walk.pendingTimeSignature !== undefined) section.timeSignature = walk.pendingTimeSignature;
    walk.pendingLabel = undefined;
    walk.pendingTimeSignature = undefined;
    walk.open = section;
  }
  return walk.open;
}

function closeSection(walk: Walk): void {
  walk.currentEnding = null;
  const section = walk.open;
  walk.open = null;
  if (section === null) return;
  const hasBars = section.bars.length > 0 || (section.repeat?.endings ?? []).some((ending) => ending.bars.length > 0);
  if (hasBars) {
    walk.sections.push(section);
    return;
  }
  // A section with no bars is not a section, which is also how the grid
  // parser reads one; its label and time signature carry to the next.
  if (section.label !== undefined) walk.pendingLabel = section.label;
  if (section.timeSignature !== undefined) walk.pendingTimeSignature = section.timeSignature;
}

/** Ends the bar being built, if it holds anything. */
function flushBar(walk: Walk): void {
  if (walk.cells.length === 0) {
    // An annotation written where no bar follows belongs to the chart.
    walk.chartAnnotations.push(...walk.annotations);
    walk.annotations = [];
    return;
  }
  // ABCx writes no padding, so a bar is exactly as many cells as it has
  // chords and each one follows the last.
  const bar: Bar = {
    cells: walk.cells,
    annotations: walk.annotations,
    fermata: false,
    cellCount: walk.cells.length,
  };
  if (walk.currentEnding !== null) walk.currentEnding.bars.push(bar);
  else {
    ensureSection(walk).bars.push(bar);
    // A bar of the section's own ends a run of endings, so a later ending
    // marker starts a repeat rather than extending that one.
    walk.endingsOwner = null;
  }
  walk.cells = [];
  walk.annotations = [];
}

function startEnding(walk: Walk, number: number): void {
  const owner = walk.endingsOwner ?? walk.open ?? ensureSection(walk);
  const repeat: Repeat = owner.repeat ?? { kind: "endings" };
  repeat.kind = "endings";
  repeat.endings = repeat.endings ?? [];
  owner.repeat = repeat;
  const ending: Ending = { number, bars: [] };
  repeat.endings.push(ending);
  walk.currentEnding = ending;
  walk.endingsOwner = owner;
  walk.open = owner;
}

function readBarLine(node: BarLine, walk: Walk): void {
  const text = node.barline.map((token) => token.lexeme).join("").replace(/\s+/g, "");
  const meaning = barlineMeaning(text);
  const endings = (node.repeatNumbers ?? []).map((token) => parseInt(token.lexeme, 10)).filter((n) => Number.isFinite(n));

  flushBar(walk);

  if (meaning.closesRepeat) {
    const section = walk.open;
    if (section !== null && section.repeat === undefined) section.repeat = { kind: "simple" };
    // The span is closed, but a following ending still belongs to it,
    // which is why the owner outlives the close.
    walk.currentEnding = null;
  }

  for (const number of endings) startEnding(walk, number);

  if (endings.length === 0 && (meaning.opensRepeat || meaning.endsSection)) {
    closeSection(walk);
    if (meaning.opensRepeat) ensureSection(walk).repeat = { kind: "simple" };
  }
}

function readInlineField(node: Inline_field, walk: Walk, ctx: ABCContext): void {
  const key = node.field.lexeme.replace(/:$/, "");
  const value = (node.text ?? []).map((token) => token.lexeme).join("").replace(/^[A-Za-z]:/, "").trim();
  if (key === "P") {
    flushBar(walk);
    closeSection(walk);
    walk.pendingLabel = value;
    walk.endingsOwner = null;
    return;
  }
  if (key === "M") {
    const meter = parseMeter(value, ctx, node.field.position);
    if (meter === null) return;
    if (walk.open !== null && walk.open.bars.length === 0 && walk.currentEnding === null) walk.open.timeSignature = meter;
    else walk.pendingTimeSignature = meter;
  }
}

export function abcxTuneToIrealChart(tune: Tune, ctx: ABCContext): IrealChart {
  const walk: Walk = {
    sections: [],
    navigation: { partMarkerSections: [] },
    chartAnnotations: [],
    open: null,
    cells: [],
    annotations: [],
    endingsOwner: null,
    currentEnding: null,
  };

  for (const system of tune.tune_body?.sequence ?? []) {
    for (const node of system) {
      if (node instanceof ChordSymbol) {
        const chord = readChord(node.token.lexeme, ctx, node.token.position);
        if (chord !== null) walk.cells.push({ kind: "chord", chord, small: false, slot: walk.cells.length });
      } else if (node instanceof BarLine) {
        readBarLine(node, walk);
      } else if (node instanceof Inline_field) {
        readInlineField(node, walk, ctx);
      } else if (node instanceof AbcAnnotation) {
        const text = annotationBody(node.text.lexeme);
        const marker = navigationMarker(text);
        if (marker === "segno") walk.navigation.segnoSectionIndex = walk.sections.length;
        else if (marker === "coda") walk.navigation.codaSectionIndex = walk.sections.length;
        else walk.annotations.push({ text, position: node.text.position });
      }
    }
  }

  flushBar(walk);
  closeSection(walk);
  return { sections: walk.sections, navigation: walk.navigation, annotations: walk.chartAnnotations };
}

function infoLineText(line: Info_line): string {
  return line.value.map((token) => token.lexeme).join("").trim();
}

function findInfoLine(tune: Tune, header: string): Info_line | undefined {
  return tune.tune_header.info_lines.find((line): line is Info_line => line instanceof Info_line && line.key.lexeme === header);
}

function findDirective(tune: Tune, name: string): Directive | undefined {
  return tune.tune_header.info_lines.find((line): line is Directive => line instanceof Directive && line.key.lexeme === name);
}

function directiveText(directive: Directive): string {
  return directive.values.map((value) => ("lexeme" in value ? value.lexeme : "")).join(" ").trim();
}

/**
 * The link fields a tune's header names.
 *
 * `rawChordData` is a parameter rather than something read from the header,
 * because the grid is the business of `gridWriter.ts` and this function's
 * business is the metadata around it. The plan's section 7 names a
 * two-argument signature; taking the chord data here instead keeps the
 * returned fields complete rather than returning a value with one member
 * knowingly wrong for a caller to patch.
 */
export function abcxTuneToSongFields(tune: Tune, rawChordData: string, ctx: ABCContext): IrealSongFields {
  const title = findInfoLine(tune, "T:");
  const composer = findInfoLine(tune, "C:");
  const key = findInfoLine(tune, "K:");
  const tempo = findInfoLine(tune, "Q:");
  const style = findDirective(tune, "irealstyle");
  const groove = findDirective(tune, "irealgroove");
  const repeats = findDirective(tune, "irealrepeats");

  if (title === undefined) report(ctx, "A tune with no title is exported as untitled", "T:", 0);

  return {
    title: title ? infoLineText(title) : "",
    composer: composer ? infoLineText(composer) : "",
    style: style ? directiveText(style) : "",
    key: key ? infoLineText(key) : "C",
    transpose: "0",
    rawChordData,
    groove: groove ? directiveText(groove) : undefined,
    // A tempo is commonly written as a note length and a rate, `1/4=120`,
    // or as a bare rate; only the trailing run of digits is the rate.
    bpm: tempo ? infoLineText(tempo).match(/(\d+)\s*$/)?.[1] : undefined,
    repeats: repeats ? directiveText(repeats) : undefined,
  };
}
