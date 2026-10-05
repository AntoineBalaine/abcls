/**
 * Groups a parsed iReal Pro chart into the lines a reader sees.
 *
 * Because every defect in this work came from a stage that was handed text
 * and had to recover structure from it, this stage produces no text at all.
 * It answers only the questions a renderer cannot answer for itself without
 * re-deriving structure: which bar begins a line, which barline sits between
 * two bars, which line carries a section's letter, and where a bar sits in
 * the chart for the purpose of grouping. What a chord looks like on screen is
 * the renderer's business and is decided from the `ParsedChord` each cell
 * carries, never from a string this module wrote.
 *
 * The shape follows `plans/3.chord-grid-text-rendering.md` section 5.
 *
 * A laid-out bar refers to the tree's own annotation and chord objects
 * rather than copying them, because the layout is a read-only view of a
 * tree that outlives it by a single render and copying every chord in the
 * library would buy nothing. No consumer may mutate what it is handed.
 */

import { ParsedChord } from "../music-theory/types";
import { Annotation, Bar, Bass, CellKind, IrealChart, Navigation, Section, TimeSignature } from "./gridAst";

/**
 * A barline, named by what it does rather than by how it is drawn.
 *
 * `closeOpenRepeat` exists because a bar that closes a repeat where the next
 * opens another is the single symbol `:|:`. Writing it as `:|` followed by
 * `|:` says something different and wrong, namely repeat what came before,
 * then two empty bars, then repeat what follows; that defect reached a real
 * chart twice before the rule was settled. It can only arise between two
 * bars of one line, which the rule that a section always begins a line
 * currently prevents, since only a section's first bar opens a repeat. It is
 * derived anyway rather than dropped, so that a later change to the line
 * rule cannot quietly reintroduce the defect.
 */
export type Barline = "plain" | "openRepeat" | "closeRepeat" | "closeOpenRepeat" | "final";

export interface LaidOutCell {
  kind: CellKind;
  chord?: ParsedChord;
  alternative?: ParsedChord;
  /**
   * Which of the bar's cells this one occupies, counting from zero. Read
   * with `LaidOutBar.cellCount`, it says where in the bar the chord falls,
   * which is what lets a renderer put two chords on the first and third
   * beats rather than merely side by side.
   */
  slot: number;
  /**
   * The bass of an unresolved `sameChordWithBass` cell, which the parser
   * leaves in place when no chord preceded it. Dropping it would lose a
   * note the chart names, and the chord preservation invariant cannot see
   * the loss because such a cell holds no chord of its own.
   */
  bass?: Bass;
  small: boolean;
}

export interface LaidOutBar {
  cells: LaidOutCell[];
  /** The barline drawn to this bar's left. */
  openBarline: Barline;
  annotations: Annotation[];
  fermata: boolean;
  /** How many cells the bar is written across, which a slot indexes into. */
  cellCount: number;
  /** 1, 2, and so on, when this bar belongs to a repeat's numbered ending. */
  endingNumber?: number;
  /**
   * The bar's position over the whole chart, counted in layout order, which
   * is the order a reader's eye takes. Cloze grouping reads this so that the
   * groups it hides match what is on screen.
   */
  indexInChart: number;
}

export interface LaidOutLine {
  /** Present only on the first line of a labelled section. */
  sectionLabel?: string;
  /** Present only on the first line of a section that states a time signature. */
  timeSignature?: TimeSignature;
  /**
   * Which of `IrealChart.sections` this line's bars came from, so that a
   * consumer placing a navigation marker, whose fields are section indexes,
   * does not have to re-derive section boundaries by counting labels.
   */
  sectionIndex: number;
  bars: LaidOutBar[];
  /**
   * The barline closing the line.
   *
   * A barline between two bars is printed once, and when those bars fall on
   * different lines the two halves of it belong in different places: what
   * closes goes to the end of the earlier line, and what opens goes to the
   * start of the later one. So this field carries only `closeRepeat` when
   * the line's last bar sends the reader back, `final` at the end of the
   * chart, and `plain` otherwise; the opening half, if any, appears as the
   * next line's first `openBarline`. A renderer prints each bar's
   * `openBarline` and then this, and no symbol is printed twice.
   */
  closeBarline: Barline;
}

export interface ChartLayout {
  lines: LaidOutLine[];
  navigation: Navigation;
  /** Chart-level annotations, those that attach to no bar. */
  annotations: Annotation[];
}

export interface LayoutOptions {
  barsPerLine?: number;
}

const DEFAULT_BARS_PER_LINE = 4;

/**
 * One bar with the two structural facts a barline is a function of, before
 * the barlines themselves are derived.
 *
 * A barline depends on both of the bars it stands between, so it cannot be
 * decided while walking a single bar. Collecting the facts first and
 * deriving the barlines in a second pass is what keeps the rule in one
 * place; the old path decided barlines locally and then tried to repair the
 * adjacencies afterwards with string replacement.
 */
interface BarFacts {
  bar: Bar;
  opensRepeat: boolean;
  closesRepeatAfter: boolean;
  endingNumber?: number;
  /** True for the bar that begins its section, which begins a line. */
  startsSection: boolean;
  sectionIndex: number;
}

function hasContent(bar: Bar): boolean {
  return bar.cells.length > 0;
}

/**
 * Flattens one section into bars carrying their structural facts.
 *
 * A repeat is laid out once and never duplicated. A simple repeat marks its
 * first bar as opening and its last as closing. A repeat with numbered
 * endings lays out the common bars once and then each ending in turn, since
 * that is how the chart is read: the common bars are played before each
 * ending. Only the last bar of every ending but the final one sends the
 * reader back, so only those close the repeat.
 */
function sectionFacts(section: Section, sectionIndex: number): BarFacts[] {
  const common = section.bars.filter(hasContent);
  const repeat = section.repeat;

  const facts: BarFacts[] = common.map((bar, i) => ({
    bar,
    opensRepeat: repeat !== undefined && i === 0,
    closesRepeatAfter: false,
    startsSection: i === 0,
    sectionIndex,
  }));

  if (repeat === undefined) return facts;

  const endings = repeat.endings ?? [];
  if (repeat.kind === "simple" || endings.length === 0) {
    // An unclosed `{`, which real charts write, still opens a repeat; the
    // section's end is where the reader goes back from.
    if (facts.length > 0) facts[facts.length - 1].closesRepeatAfter = true;
    return facts;
  }

  for (let e = 0; e < endings.length; e++) {
    const ending = endings[e];
    const bars = ending.bars.filter(hasContent);
    const isLast = e === endings.length - 1;
    for (let i = 0; i < bars.length; i++) {
      // A section whose bars all live in its endings has no common bar to
      // start it, which two charts in the sample library do; the section
      // still begins at its first laid-out bar, and its label still belongs
      // to that bar's line. Marking only a common bar lost both labels.
      //
      // Such a bar still does not open a repeat. In the `[N1 ... }` shape,
      // which the parser documents as 24 occurrences across the sample
      // library, the repeated span lies before the ending rather than
      // inside it, so drawing an opening repeat on the ending's own first
      // bar would tell the reader to loop that one bar.
      const startsSection = facts.length === 0;
      facts.push({
        bar: bars[i],
        opensRepeat: false,
        // Every ending but the last sends the reader back to the repeat's
        // start; the last one plays on into whatever follows. Which ending
        // is last is taken from the order the chart writes them in, since
        // that is the order it is read in, and the numbers themselves are
        // not a reliable ordering: two charts in the sample library write
        // them out of sequence (2, 1, 2) or write a lone second ending with
        // no first. The verification harness reports a sequence that is not
        // consecutive from one, so that shape surfaces rather than being
        // silently laid out as if it were ordinary.
        closesRepeatAfter: !isLast && i === bars.length - 1,
        endingNumber: ending.number,
        startsSection,
        sectionIndex,
      });
    }
  }
  return facts;
}

/**
 * The barline standing between two adjacent bars of the same line.
 *
 * A barline is a function of both bars it stands between, which is why it
 * cannot be decided while walking one bar: a bar that closes a repeat where
 * the next opens another is the single symbol rather than two. The old path
 * decided each barline locally and then tried to repair the adjacencies with
 * string replacement, which is the defect this derivation replaces.
 */
function barlineBetween(left: BarFacts | undefined, right: BarFacts | undefined): Barline {
  const closes = left?.closesRepeatAfter ?? false;
  const opens = right?.opensRepeat ?? false;
  if (closes && opens) return "closeOpenRepeat";
  if (closes) return "closeRepeat";
  if (opens) return "openRepeat";
  return "plain";
}

/**
 * The barline opening a line, which carries only what opens.
 *
 * Whatever closes the preceding bar has already been printed as that bar's
 * own line's `closeBarline`, so repeating it here would print one barline
 * twice, once at each side of the line break.
 */
function lineOpeningBarline(first: BarFacts): Barline {
  return first.opensRepeat ? "openRepeat" : "plain";
}

/**
 * The barline closing a line, which carries only what closes.
 *
 * Whatever opens the following bar is printed as the next line's own
 * opening barline. Nothing follows the chart's last bar, so the barline
 * after it ends the chart rather than separating two bars.
 */
function lineClosingBarline(last: BarFacts, next: BarFacts | undefined): Barline {
  if (last.closesRepeatAfter) return "closeRepeat";
  if (next === undefined) return "final";
  return "plain";
}

export function layoutChart(chart: IrealChart, options: LayoutOptions = {}): ChartLayout {
  const barsPerLine = options.barsPerLine ?? DEFAULT_BARS_PER_LINE;

  const facts: BarFacts[] = [];
  for (let s = 0; s < chart.sections.length; s++) {
    facts.push(...sectionFacts(chart.sections[s], s));
  }

  const lines: LaidOutLine[] = [];
  let line: LaidOutLine | undefined;

  for (let i = 0; i < facts.length; i++) {
    const current = facts[i];
    const section = chart.sections[current.sectionIndex];

    // A section always starts a new line, and a line never runs past
    // `barsPerLine`; a short final line is left short rather than padded.
    if (line === undefined || current.startsSection || line.bars.length >= barsPerLine) {
      line = { bars: [], closeBarline: "plain", sectionIndex: current.sectionIndex };
      if (current.startsSection) {
        if (section.label !== undefined) line.sectionLabel = section.label;
        if (section.timeSignature !== undefined) line.timeSignature = section.timeSignature;
      }
      lines.push(line);
    }

    line.bars.push({
      cells: current.bar.cells.map((cell) => ({
        kind: cell.kind,
        chord: cell.chord,
        alternative: cell.alternative,
        bass: cell.bass,
        small: cell.small,
        slot: cell.slot,
      })),
      cellCount: current.bar.cellCount,
      // The first bar of a line takes only the opening half of the barline
      // before it, because the closing half was printed at the end of the
      // previous line.
      openBarline: line.bars.length === 0 ? lineOpeningBarline(current) : barlineBetween(facts[i - 1], current),
      annotations: current.bar.annotations,
      fermata: current.bar.fermata,
      endingNumber: current.endingNumber,
      indexInChart: i,
    });

    // The line's closing barline is known as soon as its last bar is known,
    // so it is rewritten each time a bar is added.
    line.closeBarline = lineClosingBarline(current, facts[i + 1]);
  }

  return { lines, navigation: chart.navigation, annotations: chart.annotations };
}
