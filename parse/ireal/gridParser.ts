import { ParsedChord } from "../music-theory/types";
import { ABCContext } from "../parsers/Context";
import { Token, TT } from "../parsers/scan";
import { ParserErrorType } from "../types/types";
import { irealTextToParsedChord } from "./chordShorthand";
import { Annotation, Bar, Bass, Cell, Ending, IrealChart, Navigation, Repeat, Section, TimeSignature } from "./gridAst";
import { GridToken, GridTT } from "./gridTokens";

/**
 * Parser for iReal Pro chord-grid token streams, turning the output of
 * `scanGrid` into the tree declared in `gridAst.ts`.
 *
 * Because the old import path resolved repeats, labels and codas by
 * splicing text and then re-reading it, every one of those resolutions
 * could and did corrupt the chord beside it; here each resolution is a
 * transformation over bars and cells instead, so no resolution ever
 * touches a chord it was not asked about. The rules implemented are those
 * of `plans/2.ireal-grid-lexer-parser.md` section 7.
 *
 * The parser runs in three passes, in this order and for this reason: a
 * `x` or `r` bar refers back to the bar before it no matter which section
 * that bar belongs to, so back references have to be resolved over one
 * flat list of bars, before anything is grouped into sections.
 *
 * 1. Collect markers. The token stream becomes a flat list of bars,
 *    interleaved with the structural markers found between them.
 * 2. Resolve back references. `x`, `r`, `p` and `W/<bass>` take their
 *    content from the bars and cells before them.
 * 3. Group into sections. Labels, braces, brackets and endings decide
 *    where one section ends and the next begins.
 */

/** A structural marker, or one bar, in the order the tokens held them. */
type Marker =
  | { kind: "bar"; bar: Bar; repeatPreviousBar: boolean; repeatPreviousTwoBars: boolean; position: number }
  | { kind: "repeatOpen" | "repeatClose" | "sectionOpen" | "sectionClose" | "segno" | "coda" | "partMarker" | "end"; position: number }
  | { kind: "label"; label: string; position: number }
  | { kind: "timeSignature"; timeSignature: TimeSignature; position: number }
  | { kind: "ending"; number: number; position: number }
  | { kind: "chartAnnotation"; annotation: Annotation; position: number };

function report(ctx: ABCContext, message: string, lexeme: string, position: number): void {
  const reported = new Token(TT.INVALID, lexeme, ctx.generateId());
  reported.position = position;
  ctx.errorReporter.report(message, reported, ParserErrorType.PARSER);
}

/**
 * The text of an annotation, without its delimiters and without the
 * leading size code iReal Pro may put in front of it (`<*64Open Feel>`).
 */
function annotationText(lexeme: string): string {
  let text = lexeme.replace(/^</, "").replace(/>$/, "");
  text = text.replace(/^\*\d\d/, "");
  return text;
}

/**
 * The time signature a `Tnn` lexeme names.
 *
 * `T12` is the one code whose two digits are not a numerator and a
 * denominator: iReal Pro writes twelve eight that way, there being no room
 * for three digits in a two digit code.
 */
function timeSignature(lexeme: string): TimeSignature {
  const digits = lexeme.slice(1);
  if (digits === "12") return { numerator: 12, denominator: 8 };
  return { numerator: parseInt(digits[0], 10), denominator: parseInt(digits[1], 10) };
}

/** The chord inside a `(...)` alternative chord token, or null. */
function alternativeChord(lexeme: string): ParsedChord | null {
  return irealTextToParsedChord(lexeme.replace(/^\(/, "").replace(/\)$/, ""));
}

/** The bass of a `W/<root><accidental?>` token. */
function sameChordBass(lexeme: string): Bass {
  const text = lexeme.slice(2);
  return { root: text[0] as Bass["root"], accidental: (text[1] ?? "") as Bass["accidental"] };
}

/** Pass 1: the token stream as a flat list of bars and markers. */
function collectMarkers(tokens: GridToken[], ctx: ABCContext): Marker[] {
  const markers: Marker[] = [];

  let cells: Cell[] = [];
  let annotations: Annotation[] = [];
  let fermata = false;
  let repeatPreviousBar = false;
  let repeatPreviousTwoBars = false;
  let barPosition = 0;
  // The `s` cue-size marker and the `(...)` alternative chord both stand
  // beside a cell rather than being one, so each waits here for the cell
  // it belongs to.
  let pendingSmall = false;
  let pendingAlternative: ParsedChord | undefined;
  // An annotation or a fermata written in a bar that turns out to hold no
  // cell belongs to the next bar that does, which is the rule that makes
  // the phantom label bar and the empty bar defects impossible.
  let carriedAnnotations: Annotation[] = [];
  let carriedFermata = false;

  function pushCell(cell: Cell): void {
    if (pendingAlternative !== undefined) {
      cell.alternative = pendingAlternative;
      pendingAlternative = undefined;
    }
    cells.push(cell);
    pendingSmall = false;
  }

  function flushBar(position: number): void {
    if (cells.length === 0 && !repeatPreviousBar && !repeatPreviousTwoBars) {
      // Not a bar. Its annotations and its fermata carry forward; its
      // label, being a marker of its own, already stands before whatever
      // bar comes next.
      carriedAnnotations = [...carriedAnnotations, ...annotations];
      carriedFermata = carriedFermata || fermata;
    } else {
      markers.push({
        kind: "bar",
        bar: { cells, annotations: [...carriedAnnotations, ...annotations], fermata: fermata || carriedFermata },
        repeatPreviousBar,
        repeatPreviousTwoBars,
        position: barPosition,
      });
      carriedAnnotations = [];
      carriedFermata = false;
    }
    cells = [];
    annotations = [];
    fermata = false;
    repeatPreviousBar = false;
    repeatPreviousTwoBars = false;
    pendingSmall = false;
    pendingAlternative = undefined;
    barPosition = position;
  }

  for (const token of tokens) {
    switch (token.type) {
      case GridTT.CHORD: {
        const chord = irealTextToParsedChord(token.lexeme);
        if (chord === null) {
          report(ctx, `Unparsable chord in iReal Pro grid text: '${token.lexeme}'`, token.lexeme, token.position);
          break;
        }
        pushCell({ kind: "chord", chord, small: pendingSmall });
        break;
      }
      case GridTT.NO_CHORD:
        pushCell({ kind: "noChord", small: pendingSmall });
        break;
      case GridTT.SAME_CHORD:
        pushCell({ kind: "sameChord", small: pendingSmall });
        break;
      case GridTT.SAME_CHORD_WITH_BASS:
        pushCell({ kind: "sameChordWithBass", bass: sameChordBass(token.lexeme), small: pendingSmall });
        break;
      case GridTT.REPEAT_ONE_BAR:
        // A repeat marker is a statement about a whole bar, so one sharing
        // its bar with chord cells cannot mean what it says. Reading it as
        // the previous cell's chord keeps the content the old path dropped
        // here, and the condition is reported either way.
        if (cells.length > 0) {
          report(ctx, "A repeat-previous-bar cell shares its bar with chord cells; read as a repeat of the previous cell", token.lexeme, token.position);
          pushCell({ kind: "sameChord", small: pendingSmall });
        } else {
          repeatPreviousBar = true;
        }
        break;
      case GridTT.REPEAT_TWO_BARS:
        if (cells.length > 0) {
          report(ctx, "A repeat-previous-two-bars cell shares its bar with chord cells; read as a repeat of the previous cell", token.lexeme, token.position);
          pushCell({ kind: "sameChord", small: pendingSmall });
        } else {
          repeatPreviousTwoBars = true;
        }
        break;
      case GridTT.ANNOTATION:
        annotations.push({ text: annotationText(token.lexeme), position: token.position });
        break;
      case GridTT.ALTERNATIVE_CHORD: {
        const chord = alternativeChord(token.lexeme);
        if (chord === null) {
          report(ctx, `Unparsable alternative chord in iReal Pro grid text: '${token.lexeme}'`, token.lexeme, token.position);
          break;
        }
        if (cells.length > 0) cells[cells.length - 1].alternative = chord;
        else pendingAlternative = chord;
        break;
      }
      case GridTT.FERMATA:
        fermata = true;
        break;
      case GridTT.SMALL:
        pendingSmall = true;
        break;
      case GridTT.BAR:
        flushBar(token.position + token.lexeme.length);
        break;
      case GridTT.REPEAT_OPEN:
      case GridTT.REPEAT_CLOSE:
      case GridTT.SECTION_OPEN:
      case GridTT.SECTION_CLOSE:
      case GridTT.END: {
        // A structural delimiter ends the bar it follows, because real
        // charts write `|x }{*B` with no second separator between the
        // brace pair and the bar before it.
        flushBar(token.position + token.lexeme.length);
        const kind =
          token.type === GridTT.REPEAT_OPEN
            ? "repeatOpen"
            : token.type === GridTT.REPEAT_CLOSE
              ? "repeatClose"
              : token.type === GridTT.SECTION_OPEN
                ? "sectionOpen"
                : token.type === GridTT.SECTION_CLOSE
                  ? "sectionClose"
                  : "end";
        markers.push({ kind, position: token.position });
        break;
      }
      case GridTT.ENDING:
        flushBar(token.position + token.lexeme.length);
        markers.push({ kind: "ending", number: parseInt(token.lexeme.slice(1), 10), position: token.position });
        break;
      case GridTT.SECTION_LABEL:
        flushBar(token.position + token.lexeme.length);
        markers.push({ kind: "label", label: token.lexeme.slice(1), position: token.position });
        break;
      case GridTT.TIME_SIGNATURE:
        markers.push({ kind: "timeSignature", timeSignature: timeSignature(token.lexeme), position: token.position });
        break;
      case GridTT.SEGNO:
        markers.push({ kind: "segno", position: token.position });
        break;
      case GridTT.CODA:
        markers.push({ kind: "coda", position: token.position });
        break;
      case GridTT.PART_MARKER:
        markers.push({ kind: "partMarker", position: token.position });
        break;
      case GridTT.PAD:
      case GridTT.LAYOUT:
      case GridTT.SPACER:
      case GridTT.WHITESPACE:
      case GridTT.UNKNOWN:
        // Padding, layout and spacing carry no musical meaning, and an
        // unknown character was already reported by the scanner.
        break;
    }
  }
  flushBar(tokens.length > 0 ? tokens[tokens.length - 1].position + tokens[tokens.length - 1].lexeme.length : 0);

  // An annotation that never found a bar is a fact about the chart rather
  // than about any one bar; the caller reads it off `IrealChart.annotations`.
  for (const annotation of carriedAnnotations) {
    markers.push({ kind: "chartAnnotation", annotation, position: annotation.position });
  }
  return markers;
}

function copyCells(cells: Cell[]): Cell[] {
  return cells.map((cell) => ({ ...cell, chord: cell.chord ? { ...cell.chord, alterations: [...cell.chord.alterations] } : undefined }));
}

/** Pass 2: resolve `x`, `r`, `p` and `W/<bass>` against what came before. */
function resolveBackReferences(markers: Marker[], ctx: ABCContext): Marker[] {
  const resolved: Marker[] = [];
  const bars: Bar[] = [];
  let lastChord: ParsedChord | undefined;

  function resolveCells(bar: Bar, position: number): void {
    for (const cell of bar.cells) {
      if (cell.kind === "chord") {
        lastChord = cell.chord;
        continue;
      }
      if (cell.kind === "noChord") continue;
      if (lastChord === undefined) {
        report(ctx, "A cell repeats the previous chord, but no chord was named before it", cell.kind, position);
        continue;
      }
      const bass = cell.kind === "sameChordWithBass" ? (cell.bass ?? null) : lastChord.bass;
      cell.chord = { ...lastChord, alterations: [...lastChord.alterations], bass };
      cell.kind = "chord";
      delete cell.bass;
      lastChord = cell.chord;
    }
  }

  function addBar(bar: Bar, position: number): void {
    resolveCells(bar, position);
    bars.push(bar);
    resolved.push({ kind: "bar", bar, repeatPreviousBar: false, repeatPreviousTwoBars: false, position });
  }

  for (const marker of markers) {
    if (marker.kind !== "bar") {
      resolved.push(marker);
      continue;
    }
    if (marker.repeatPreviousTwoBars) {
      if (bars.length < 2) {
        report(ctx, "A bar repeats the previous two bars, but fewer than two bars came before it", "r", marker.position);
        continue;
      }
      // The copies take the cells only: an annotation and a fermata belong
      // to the bar that introduced them, not to the bar that repeats it.
      const first = bars[bars.length - 2];
      const second = bars[bars.length - 1];
      const firstCopy = copyCells(first.cells);
      const secondCopy = copyCells(second.cells);
      addBar({ cells: firstCopy, annotations: marker.bar.annotations, fermata: marker.bar.fermata }, marker.position);
      addBar({ cells: secondCopy, annotations: [], fermata: false }, marker.position);
      continue;
    }
    if (marker.repeatPreviousBar) {
      if (bars.length === 0) {
        report(ctx, "A bar repeats the previous bar, but no bar came before it", "x", marker.position);
        continue;
      }
      marker.bar.cells = copyCells(bars[bars.length - 1].cells);
    }
    addBar(marker.bar, marker.position);
  }
  return resolved;
}

/** Pass 3: group the flat list of bars into sections. */
function groupIntoSections(markers: Marker[], ctx: ABCContext): IrealChart {
  const sections: Section[] = [];
  const navigation: Navigation = { partMarkerSections: [] };
  const chartAnnotations: Annotation[] = [];

  // A holder rather than a plain local, because the two helpers below
  // assign it and TypeScript's narrowing does not follow an assignment
  // made inside a nested function.
  const open: { section: Section | null } = { section: null };
  let pendingLabel: string | undefined;
  let pendingTimeSignature: TimeSignature | undefined;
  // The section an `N<digit>` marker attaches its endings to, which stays
  // reachable after its closing brace because iReal Pro writes every
  // ending but the first outside the braces.
  let repeatSection: Section | null = null;
  let repeatOpenPosition: number | null = null;
  let currentEnding: Ending | null = null;
  // The section the next `N<digit>` marker attaches to when no repeat is
  // open, which is how iReal Pro writes every ending after the first:
  // `[*A ... ][N1 ... }[N2 ... ` puts the second ending in a bracketed
  // group of its own, after the group holding the first.
  let endingsOwner: Section | null = null;

  function ensureSection(): Section {
    if (open.section === null) {
      const section: Section = { bars: [] };
      if (pendingLabel !== undefined) section.label = pendingLabel;
      if (pendingTimeSignature !== undefined) section.timeSignature = pendingTimeSignature;
      pendingLabel = undefined;
      pendingTimeSignature = undefined;
      open.section = section;
    }
    return open.section;
  }

  function closeSection(): void {
    currentEnding = null;
    const section = open.section;
    if (section === null) return;
    const hasBars = section.bars.length > 0 || (section.repeat?.endings ?? []).some((ending) => ending.bars.length > 0);
    if (hasBars) {
      sections.push(section);
    } else {
      // A section with no bars is not a section. Its label and its time
      // signature carry onto the next section that does have bars.
      if (section.label !== undefined) pendingLabel = section.label;
      if (section.timeSignature !== undefined) pendingTimeSignature = section.timeSignature;
    }
    open.section = null;
  }

  for (const marker of markers) {
    switch (marker.kind) {
      case "bar":
        if (currentEnding !== null) currentEnding.bars.push(marker.bar);
        else {
          ensureSection().bars.push(marker.bar);
          // A bar of a section's own ends any run of endings, so a later
          // `N<digit>` starts a new repeat rather than extending that one.
          endingsOwner = null;
        }
        break;
      case "label":
        // A label written where a section is already under way starts the
        // next section; one written before any bar of the current section
        // names that section instead, which is the `{*A` form real charts
        // use.
        if (open.section !== null && open.section.bars.length === 0 && currentEnding === null) open.section.label = marker.label;
        else {
          closeSection();
          pendingLabel = marker.label;
        }
        break;
      case "timeSignature":
        if (open.section !== null && open.section.bars.length === 0 && currentEnding === null) open.section.timeSignature = marker.timeSignature;
        else if (open.section === null) pendingTimeSignature = marker.timeSignature;
        else {
          closeSection();
          pendingTimeSignature = marker.timeSignature;
        }
        break;
      case "repeatOpen":
        if (repeatOpenPosition !== null) {
          report(ctx, "A repeated section opens inside another one, which iReal Pro does not write", "{", marker.position);
        }
        closeSection();
        repeatSection = ensureSection();
        repeatSection.repeat = { kind: "simple" };
        repeatOpenPosition = marker.position;
        break;
      case "repeatClose":
        // A closing brace with no opening one before it is an ordinary
        // shape rather than a defect: iReal Pro writes the two brace
        // characters as the two repeat barlines of a section, and a
        // section whose repeat is drawn only at its end opens with the
        // plain `[` instead (`[N1 ... }`, 24 occurrences across the
        // sample library). The repeated span is then the section itself.
        if (repeatOpenPosition === null) {
          const section = ensureSection();
          section.repeat = section.repeat ?? { kind: "simple" };
        }
        repeatOpenPosition = null;
        closeSection();
        break;
      case "ending": {
        const owner: Section = (repeatOpenPosition !== null ? repeatSection : null) ?? endingsOwner ?? ensureSection();
        const repeat: Repeat = owner.repeat ?? { kind: "endings" };
        repeat.kind = "endings";
        repeat.endings = repeat.endings ?? [];
        owner.repeat = repeat;
        currentEnding = { number: marker.number, bars: [] };
        repeat.endings.push(currentEnding);
        endingsOwner = owner;
        break;
      }
      case "sectionOpen":
      case "sectionClose":
      case "end":
        // A section boundary ends a repeated span that is still open,
        // because iReal Pro closes a repeat with `]` as readily as with
        // `}` (`{T44F7 | ... |G-7 C7 ]`, 57 occurrences across the sample
        // library); only a brace with no boundary of any kind after it is
        // genuinely unclosed.
        repeatOpenPosition = null;
        closeSection();
        break;
      case "segno":
        navigation.segnoSectionIndex = sections.length;
        break;
      case "coda":
        // The first coda marker is the one the emitter jumps to; a second
        // one marks where the jump lands, and both are kept by position
        // rather than by reordering anything.
        if (navigation.codaSectionIndex === undefined) navigation.codaSectionIndex = sections.length;
        break;
      case "partMarker":
        navigation.partMarkerSections.push(sections.length);
        break;
      case "chartAnnotation":
        chartAnnotations.push(marker.annotation);
        break;
    }
  }

  closeSection();
  if (repeatOpenPosition !== null) {
    report(ctx, "A repeated section opens and is never closed; treated as a section boundary", "{", repeatOpenPosition);
    if (repeatSection?.repeat) repeatSection.repeat.unclosed = true;
  }

  return { sections, navigation, annotations: chartAnnotations };
}

export function parseGrid(tokens: GridToken[], ctx: ABCContext): IrealChart {
  const markers = collectMarkers(tokens, ctx);
  const resolved = resolveBackReferences(markers, ctx);
  return groupIntoSections(resolved, ctx);
}

/**
 * Every chord the tree names, in the order it names them, counting a
 * cell's alternative chord as well as its own.
 *
 * Written here rather than in a consumer because both the verification
 * harness and the tests need the same walk, and a walk that forgets a
 * branch of the tree would make a chord preservation check pass while
 * chords were being lost.
 */
export function chartChords(chart: IrealChart): ParsedChord[] {
  const chords: ParsedChord[] = [];
  function walkBars(bars: Bar[]): void {
    for (const bar of bars) {
      for (const cell of bar.cells) {
        if (cell.chord) chords.push(cell.chord);
        if (cell.alternative) chords.push(cell.alternative);
      }
    }
  }
  for (const section of chart.sections) {
    walkBars(section.bars);
    for (const ending of section.repeat?.endings ?? []) walkBars(ending.bars);
  }
  return chords;
}
