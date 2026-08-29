import { ABCContext, createRational, multiplyRational } from "abcls-parser";
import { TAGS } from "../csTree/types";
import { Selection } from "../selection";
import { extractBrokenToken, rhythmToRational, rationalToRhythm } from "./rhythm";
import { findRhythmChild, replaceRhythm } from "./treeUtils";
import { findNodesById } from "./types";

/**
 * Multiply the rhythm of selected notes, chords, rests, and y-spacers by the given factor.
 * For example, with factor 2:
 *   - `a` becomes `a2` (1 * 2 = 2)
 *   - `a/2` becomes `a` (1/2 * 2 = 1)
 *   - `a//` becomes `a/` (1/4 * 2 = 1/2)
 */
export function multiplyRhythm(selection: Selection, factor: number = 2, ctx: ABCContext): Selection {
  const multiplier = createRational(factor, 1);

  for (const cursor of selection.cursors) {
    const nodes = findNodesById(selection.root, cursor);
    for (const csNode of nodes) {
      if (csNode.tag === TAGS.Note || csNode.tag === TAGS.Chord || csNode.tag === TAGS.Rest || csNode.tag === TAGS.YSPACER) {
        const existingRhythm = findRhythmChild(csNode);
        const brokenToken = existingRhythm ? extractBrokenToken(existingRhythm) : null;

        if (existingRhythm === null) {
          // No rhythm exists - the default is 1, so we multiply 1 * factor = factor
          const newRhythm = rationalToRhythm(multiplier, ctx, null);
          replaceRhythm(csNode, newRhythm);
        } else {
          const currentRational = rhythmToRational(existingRhythm);
          const newRational = multiplyRational(currentRational, multiplier);
          const newRhythm = rationalToRhythm(newRational, ctx, brokenToken);
          replaceRhythm(csNode, newRhythm);
        }
      }
    }
  }

  return selection;
}
