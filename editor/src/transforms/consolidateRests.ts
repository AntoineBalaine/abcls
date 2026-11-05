import { remove } from "abcls-cstree";
import { ABCContext, addRational, createRational, equalRational, IRational, TT } from "abcls-parser";
import { CSNode, isRest, isBarLine, isTokenNode, getTokenData } from "../csTree/types";
import { Selection } from "../selection";
import { isVoiceMarker } from "../selectors/voiceSelector";
import { isPowerOfTwoRational, nextMeaningfulSibling } from "./consolidationUtils";
import { getNodeRhythm, rationalToRhythm } from "./rhythm";
import { replaceRhythm } from "./treeUtils";
import { findNodesById } from "./types";

/**
 * Extracts the rest type ('z' or 'x') from a Rest node.
 */
function getRestType(restNode: CSNode): string | null {
  let current = restNode.firstChild;
  while (current !== null) {
    if (isTokenNode(current)) {
      const tokenData = getTokenData(current);
      if (tokenData.tokenType === TT.REST) {
        return tokenData.lexeme;
      }
    }
    current = current.nextSibling;
  }
  return null;
}

/**
 * Performs a single pass of rest consolidation.
 * Returns true if any consolidation was performed.
 */
function consolidatePass(selection: Selection, ctx: ABCContext, consumedIds: Set<number>): boolean {
  let changed = false;

  for (const cursor of selection.cursors) {
    const nodes = findNodesById(selection.root, cursor);
    const restNodes = nodes.filter(isRest);

    for (const restNode of restNodes) {
      if (consumedIds.has(restNode.id)) {
        continue;
      }

      const restType = getRestType(restNode);
      if (restType === null) {
        continue;
      }

      const rhythm1 = getNodeRhythm(restNode);
      const next = nextMeaningfulSibling(restNode);

      if (next === null) {
        continue;
      }
      if (isBarLine(next) || isVoiceMarker(next)) {
        continue;
      }
      if (!isRest(next)) {
        continue;
      }

      const nextRestType = getRestType(next);
      if (nextRestType !== restType) {
        continue;
      }

      const rhythm2 = getNodeRhythm(next);
      if (!equalRational(rhythm1, rhythm2)) {
        continue;
      }

      const summed = addRational(rhythm1, rhythm2);
      if (!isPowerOfTwoRational(summed)) {
        continue;
      }

      // Perform the consolidation
      const newRhythm = rationalToRhythm(summed, ctx);
      replaceRhythm(restNode, newRhythm);

      // Remove the next rest from the tree
      remove(next);

      consumedIds.add(next.id);
      cursor.delete(next.id);
      changed = true;
    }
  }

  return changed;
}

/** What the caller can ask of `consolidateRests`. */
export interface ConsolidateRestsOptions {
  /**
   * Because the conservative mode only joins two rests of the same length into a power of two, it leaves `z4 z2` and
   * `z2 z3 z` as they are. When this is true, consecutive rests of the same type are joined into the fewest rests that
   * can each be written as a single note value, with up to two dots (`z4 z2` becomes `z6`).
   */
  dotted?: boolean;
}

/** Tells if a number is a power of two, which includes one. */
function isPowerOfTwoInteger(n: number): boolean {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

/**
 * Tells if a duration, counted in unit note lengths, can be written as one rest: a power of two, possibly with one
 * or two dots, which are the multiples 3 and 7 of a power of two. For instance 6 is a dotted half note when the unit
 * is an eighth note, and 5 cannot be written without a tie.
 */
export function isSingleRestDuration(duration: IRational): boolean {
  const reduced = createRational(duration.numerator, duration.denominator);
  if (reduced.numerator <= 0 || !isPowerOfTwoInteger(reduced.denominator)) {
    return false;
  }
  let oddPart = reduced.numerator;
  while (oddPart % 2 === 0) {
    oddPart /= 2;
  }
  return oddPart === 1 || oddPart === 3 || oddPart === 7;
}

/**
 * Splits a run of durations into consecutive groups that each make one rest, using as few groups as possible.
 * Because a longer first group reads better, among the splits that have the fewest groups we take the one whose first
 * group is the longest, and so on for the groups that follow.
 * A rest that is alone in its group keeps whatever duration it had, even one that cannot be written as one rest.
 *
 * @returns the number of rests in each group, in order
 */
export function partitionRestRun(durations: readonly IRational[]): number[] {
  const count = durations.length;
  const fewestGroups: number[] = new Array<number>(count + 1).fill(0);
  const firstGroupLength: number[] = new Array<number>(count + 1).fill(0);

  for (let start = count - 1; start >= 0; start--) {
    let sum = createRational(0, 1);
    fewestGroups[start] = Number.POSITIVE_INFINITY;
    for (let length = 1; start + length <= count; length++) {
      sum = addRational(sum, durations[start + length - 1]);
      if (length > 1 && !isSingleRestDuration(sum)) {
        continue;
      }
      const groups = 1 + fewestGroups[start + length];
      if (groups <= fewestGroups[start]) {
        fewestGroups[start] = groups;
        firstGroupLength[start] = length;
      }
    }
  }

  const lengths: number[] = [];
  for (let start = 0; start < count; start += firstGroupLength[start]) {
    lengths.push(firstGroupLength[start]);
  }
  return lengths;
}

/**
 * Lists the rests that follow a rest without anything between them but blanks, as long as they have the same type.
 * A bar line, a voice marker, a note, or a chord symbol ends the run.
 */
function collectRestRun(first: CSNode, restType: string): CSNode[] {
  const run = [first];
  let next = nextMeaningfulSibling(first);
  while (next !== null && isRest(next) && getRestType(next) === restType) {
    run.push(next);
    next = nextMeaningfulSibling(next);
  }
  return run;
}

/** Joins the rests of each group of a run into the first rest of the group. The ids of the removed rests are returned. */
function joinRestGroups(run: readonly CSNode[], groupLengths: readonly number[], ctx: ABCContext): number[] {
  const removedIds: number[] = [];
  let position = 0;
  for (const length of groupLengths) {
    if (length > 1) {
      const group = run.slice(position, position + length);
      let total = createRational(0, 1);
      for (const rest of group) {
        total = addRational(total, getNodeRhythm(rest));
      }
      replaceRhythm(group[0], rationalToRhythm(total, ctx));
      for (const rest of group.slice(1)) {
        removedIds.push(rest.id);
        remove(rest);
      }
    }
    position += length;
  }
  return removedIds;
}

/** The deep mode of `consolidateRests`, which looks at whole runs of rests instead of pairs. */
function consolidateRestsDeep(selection: Selection, ctx: ABCContext): Selection {
  const handledIds = new Set<number>();

  for (const cursor of selection.cursors) {
    const restNodes = findNodesById(selection.root, cursor).filter(isRest);

    for (const restNode of restNodes) {
      if (handledIds.has(restNode.id)) {
        continue;
      }
      const restType = getRestType(restNode);
      if (restType === null) {
        continue;
      }

      const run = collectRestRun(restNode, restType);
      for (const rest of run) {
        handledIds.add(rest.id);
      }
      if (run.length < 2) {
        continue;
      }

      const durations: IRational[] = [];
      for (const rest of run) {
        durations.push(getNodeRhythm(rest));
      }
      const groupLengths = partitionRestRun(durations);
      for (const removedId of joinRestGroups(run, groupLengths, ctx)) {
        cursor.delete(removedId);
      }
    }
  }

  return selection;
}

/**
 * Consolidates consecutive identical rests into a single rest with doubled duration.
 *
 * The transform uses a conservative approach: it only performs "safe" consolidations
 * where both rests have identical duration and the result is a power-of-two duration
 * (no dotted rests).
 *
 * Valid consolidations:
 * - z/8 + z/8 becomes z/4
 * - z/4 + z/4 becomes z/2
 * - z/2 + z/2 becomes z
 * - z/16 + z/16 becomes z/8
 *
 * Invalid (skipped):
 * - z/8 + z/4 (different durations)
 * - z/8 + z/8 + z/8 would yield z3/8 (result is dotted, not power-of-2)
 * - z + x (different rest types)
 *
 * Consolidation stops at bar lines and voice-changing inline fields.
 *
 * The transform is idempotent: it loops until no more consolidations are possible,
 * so applying it twice yields the same result as applying it once.
 */
export function consolidateRests(selection: Selection, ctx: ABCContext, options: ConsolidateRestsOptions = {}): Selection {
  if (options.dotted === true) {
    return consolidateRestsDeep(selection, ctx);
  }

  const consumedIds = new Set<number>();

  // Loop until no more consolidations can be made (idempotent)
  while (consolidatePass(selection, ctx, consumedIds)) {
    // Continue until no changes
  }

  return selection;
}
