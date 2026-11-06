/**
 * The rules that decide which notes of a bar are beamed together.
 *
 * Because the rules need the meter, the groups of the meter and the durations, and these are known to the interpreter,
 * the rules live here, where the editor transform that beams a selection and any later formatting step can share them.
 * Positions and durations are in whole notes, so that a quarter note lasts 1/4.
 */

import { IRational } from "../Visitors/fmt/rational";

/** A note, rest or chord of a bar, with where it starts and ends. */
export interface BeamItem {
  start: number;
  end: number;
  /** False for a rest, and for anything that is not a note or a chord. */
  isNoteLike: boolean;
}

/** Because durations are sums of floating point fractions, two positions closer than this are the same position. */
const TOLERANCE = 1e-9;

/** A note is beamed only when it is shorter than a quarter note, as a quarter note has no flag. */
const LONGEST_BEAMED = 1 / 4;

function toWholeNotes(fraction: IRational): number {
  return fraction.numerator / fraction.denominator;
}

/**
 * The positions in the bar where a new group of beamed notes may begin, after the start of the bar.
 *
 * When the meter gives its groups, as 5/8 (3/8+2/8) does, they are the groups, and 6/8 (3/8+3/8) differs from 6/8 (2/8+2/8+2/8).
 * Otherwise the groups follow the usual practice:
 * - a compound meter (6/8, 9/8, 12/8 and the same in sixteenths) groups by three of its units, a dotted beat;
 * - 3/8 and 3/16 keep the whole bar in one group;
 * - 5/8 is 3+2 and 7/8 is 2+2+3;
 * - the other meters group by their beat, which is a quarter note for a meter over 4, 8 or 16, and the unit of the meter above it.
 *
 * @param meter The meter of the bar, such as 6/8
 * @param groups The groups that the meter gives, in fractions of a whole note, when it gives them
 * @returns The positions where a group begins after the first one, in whole notes
 */
export function groupStarts(meter: IRational, groups?: readonly IRational[]): number[] {
  const barLength = toWholeNotes(meter);
  const lengths = groups && groups.length > 0 ? groups.map(toWholeNotes) : defaultGroupLengths(meter);
  const starts: number[] = [];
  let position = 0;
  for (const length of lengths) {
    position += length;
    if (position < barLength - TOLERANCE) starts.push(position);
  }
  return starts;
}

function defaultGroupLengths(meter: IRational): number[] {
  const { numerator, denominator } = meter;
  const unit = 1 / denominator;
  const barLength = numerator / denominator;
  const isSmallUnit = denominator >= 8;
  if (isSmallUnit && numerator % 3 === 0 && numerator > 3) {
    return Array.from({ length: numerator / 3 }, () => 3 * unit);
  }
  if (isSmallUnit && numerator === 3) return [barLength];
  if (isSmallUnit && numerator === 5) return [3 * unit, 2 * unit];
  if (isSmallUnit && numerator === 7) return [2 * unit, 2 * unit, 3 * unit];
  const beat = denominator >= 4 ? 1 / 4 : unit;
  const count = Math.max(1, Math.round(barLength / beat));
  return Array.from({ length: count }, () => beat);
}

/**
 * Tells, for each item of a bar, whether it is beamed to the item before it, which means that no space separates them.
 * An item joins the one before it when both are notes or chords shorter than a quarter note, and both begin in the same group.
 * A rest, a quarter note or a longer one, or a new group, starts a new beam.
 *
 * @param items The notes, rests and chords of the bar, in order
 * @param starts The positions where a group begins after the first one, from groupStarts
 * @returns For each item, true when it is beamed to the previous one. The first item is always false.
 */
export function beamJoins(items: readonly BeamItem[], starts: readonly number[]): boolean[] {
  const groupOf = (position: number): number => starts.filter((start) => start <= position + TOLERANCE).length;
  return items.map((item, index) => {
    if (index === 0) return false;
    const previous = items[index - 1];
    const isBeamable = (candidate: BeamItem): boolean => candidate.isNoteLike && candidate.end - candidate.start < LONGEST_BEAMED - TOLERANCE;
    return isBeamable(item) && isBeamable(previous) && groupOf(item.start) === groupOf(previous.start);
  });
}
