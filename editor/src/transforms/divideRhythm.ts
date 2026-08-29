import { ABCContext, createRational, divideRational } from "abcls-parser";
import { TAGS } from "../csTree/types";
import { Selection } from "../selection";
import { extractBrokenToken, rhythmToRational, rationalToRhythm } from "./rhythm";
import { findRhythmChild, replaceRhythm } from "./treeUtils";
import { findNodesById } from "./types";

/**
 * Divide the rhythm of selected notes, chords, rests, and y-spacers by the given factor.
 * For example, with factor 2:
 *   - `a` becomes `a/` (1 / 2 = 1/2)
 *   - `a2` becomes `a` (2 / 2 = 1)
 *   - `a/2` becomes `a/4` (1/2 / 2 = 1/4)
 */
export function divideRhythm(selection: Selection, factor: number = 2, ctx: ABCContext): Selection {
  const divisor = createRational(factor, 1);

  for (const cursor of selection.cursors) {
    const nodes = findNodesById(selection.root, cursor);
    for (const csNode of nodes) {
      if (csNode.tag === TAGS.Note || csNode.tag === TAGS.Chord || csNode.tag === TAGS.Rest || csNode.tag === TAGS.YSPACER) {
        const existingRhythm = findRhythmChild(csNode);
        const brokenToken = existingRhythm ? extractBrokenToken(existingRhythm) : null;

        if (existingRhythm === null) {
          // No rhythm exists - the default is 1, so we divide 1 / factor
          const newRational = createRational(1, factor);
          const newRhythm = rationalToRhythm(newRational, ctx, null);
          replaceRhythm(csNode, newRhythm);
        } else {
          const currentRational = rhythmToRational(existingRhythm);
          const newRational = divideRational(currentRational, divisor);
          const newRhythm = rationalToRhythm(newRational, ctx, brokenToken);
          replaceRhythm(csNode, newRhythm);
        }
      }
    }
  }

  return selection;
}
