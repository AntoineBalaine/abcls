import { ParsedChord } from "../music-theory/types";
import { KeyAccidental, KeyRoot } from "../types/abcjs-ast";

/**
 * The tree `gridParser.ts` builds from a stream of `GridToken`s.
 *
 * Because the old import path smuggled structure through a flat string and
 * kept recovering it wrongly, every structural fact a consumer needs lives
 * here as a property of the node it belongs to: a repeat belongs to a
 * section, a label belongs to a section, a fermata belongs to a bar. No
 * consumer has to read text back to find any of them.
 *
 * The shape follows `plans/2.ireal-grid-lexer-parser.md` section 7.
 */

/** A bass note under a chord, named the same way `ParsedChord.bass` is. */
export interface Bass {
  root: KeyRoot;
  accidental: KeyAccidental;
}

/**
 * What a cell holds.
 *
 * `sameChord` and `sameChordWithBass` are the unresolved forms of iReal
 * Pro's `p` and `W/<bass>` cells. `parseGrid` resolves both into `chord`
 * cells, and leaves one in place only when there is no preceding chord to
 * resolve it from, in which case it also reports the condition; a consumer
 * that sees either kind is therefore looking at a chart that named no
 * chord before its first back reference, not at an unfinished tree.
 */
export type CellKind = "chord" | "noChord" | "sameChord" | "sameChordWithBass";

export interface Cell {
  kind: CellKind;
  /** Set for `kind === "chord"`. */
  chord?: ParsedChord;
  /** Set for `kind === "sameChordWithBass"` before resolution. */
  bass?: Bass;
  /** The `s` cue-size marker applies to the cell that follows it. */
  small: boolean;
  /** The `(...)` alternative chord, written beside the cell's own chord. */
  alternative?: ParsedChord;
  /**
   * Which of the bar's cells this one occupies, counting from zero.
   *
   * iReal Pro writes a bar as a fixed run of cells and pads the empty ones
   * with spaces, so where a chord sits says when in the bar it falls:
   * measured over a real library, 7,569 bars hold one chord on the first
   * cell of four and 4,445 hold two on the first and third, which is beats
   * one and three. Dropping the padding as meaningless loses that.
   */
  slot: number;
}

export interface Annotation {
  text: string;
  /** Source offset, for diagnostics. */
  position: number;
}

export interface Bar {
  cells: Cell[];
  /** Bar-level text annotations, for example `<Solos>`. */
  annotations: Annotation[];
  fermata: boolean;
  /**
   * How many cells the bar was written across, which is what a `slot` is an
   * index into. Charts write the same bar at different granularities, most
   * often four cells and sometimes two, so a position only means anything
   * as a fraction of this.
   */
  cellCount: number;
}

export interface Ending {
  /** 1, 2, and so on, from the `N1` and `N2` markers. */
  number: number;
  bars: Bar[];
}

/**
 * A repeat over a section's bars. A `simple` repeat plays the section's
 * bars twice; an `endings` repeat plays them once before each ending.
 * Neither duplicates any bar in the tree.
 */
export interface Repeat {
  kind: "simple" | "endings";
  /** Set for `kind === "endings"`. */
  endings?: Ending[];
  /** True when the opening `{` was never closed, which real charts do. */
  unclosed?: boolean;
}

export interface TimeSignature {
  numerator: number;
  denominator: number;
}

export interface Section {
  /** `A`, `B`, `i`, from a `*A` marker. */
  label?: string;
  timeSignature?: TimeSignature;
  bars: Bar[];
  repeat?: Repeat;
}

/**
 * Where the chart's navigation markers sit, as section indexes into
 * `IrealChart.sections`. The markers record a position and reorder
 * nothing; the emitter decides how to express them.
 */
export interface Navigation {
  segnoSectionIndex?: number;
  codaSectionIndex?: number;
  /** Every `U` part marker, in the order they appear. */
  partMarkerSections: number[];
}

export interface IrealChart {
  sections: Section[];
  navigation: Navigation;
  /** Chart-level annotations, those that attach to no bar. */
  annotations: Annotation[];
}
