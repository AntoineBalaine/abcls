/**
 * CSTree-native sub-helpers for the timed explosion transform.
 *
 * These functions replace the AST-based equivalents in explosionTimed.ts,
 * operating directly on CSNode sibling chains instead of System arrays.
 */

import { cloneSubtree, visit, replace, insertAfter, insertBefore, remove, appendChild } from "abcls-cstree";
import { ABCContext, TT } from "abcls-parser";
import { DocumentSnapshots, getSnapshotAtPosition, encode } from "abcls-parser/interpreter/ContextInterpreter";
import { Range } from "abcls-parser/types/types";
import {
  IRational,
  createRational,
  addRational,
  subtractRational,
  compareRational,
  multiplyRational,
  isInfiniteRational,
} from "abcls-parser/Visitors/fmt/rational";
import * as barmap from "../context/csBarMap";
import { CSNode, TAGS, isTokenNode, getTokenData, createCSNode, FormattingData } from "../csTree/types";
import { Selection } from "../selection";
import { findNodeById, firstTokenData, walkByTag } from "../selectors/treeWalk";
import { isVoiceMarker, extractVoiceId } from "../selectors/voiceSelector";
import { computeNodeRange, rangesOverlap } from "../utils/rangeUtils";
import { consolidateRests } from "./consolidateRests";
import { collectSiblingIds } from "./explode";
import { collectNotesFromChord, createEolNode, findBodyOfTune, findTunesWithSelection, isEolNode, nodeOrDescendantInSet } from "./lineUtils";
import { rhythmToRational, rationalToRhythm } from "./rhythm";
import { noteToRest, chordToRest } from "./toRest";
import { getCursorRange } from "./toSlashNotation";
import { findRhythmChild, replaceRhythm } from "./treeUtils";
import { unwrapSingle } from "./unwrapSingle";

export interface DurationContext {
  brokenRhythmPending?: {
    isGreater: boolean;
  };
  tuplet?: {
    p: number;
    q: number;
  };
}

export interface BarSlice {
  systemNode: CSNode;
  startNode: CSNode | null;
  endNode: CSNode | null;
}

const TIME_EVENT_TAGS = new Set<string>([TAGS.Note, TAGS.Chord, TAGS.Rest, TAGS.MultiMeasureRest, TAGS.YSPACER]);

export function isTimeEvent(node: CSNode): boolean {
  if (TIME_EVENT_TAGS.has(node.tag)) return true;
  if (node.tag === TAGS.Beam) {
    let child = node.firstChild;
    while (child !== null) {
      if (isTimeEvent(child)) return true;
      child = child.nextSibling;
    }
  }
  return false;
}

function findBrokenToken(node: CSNode): { isGreater: boolean } | null {
  const rhythmNode = findRhythmChild(node);
  if (rhythmNode === null) return null;
  let child = rhythmNode.firstChild;
  while (child !== null) {
    if (isTokenNode(child) && getTokenData(child).tokenType === TT.RHY_BRKN) {
      return { isGreater: getTokenData(child).lexeme.includes(">") };
    }
    child = child.nextSibling;
  }
  return null;
}

function calculateBaseDuration(node: CSNode, context: DurationContext): IRational {
  const rhythmNode = findRhythmChild(node);
  let duration: IRational;
  if (rhythmNode === null) {
    duration = createRational(1, 1);
  } else {
    duration = rhythmToRational(rhythmNode);
  }

  if (context.brokenRhythmPending) {
    const factor = context.brokenRhythmPending.isGreater ? createRational(1, 2) : createRational(3, 2);
    duration = multiplyRational(duration, factor);
  }

  return duration;
}

export function calculateDuration(node: CSNode, context: DurationContext): IRational {
  if (node.tag === TAGS.MultiMeasureRest) {
    return createRational(1, 0);
  }

  if (node.tag === TAGS.Beam) {
    let total = createRational(0, 1);
    const beamContext: DurationContext = { ...context };
    let child = node.firstChild;
    while (child !== null) {
      if (isTimeEvent(child)) {
        const childDuration = calculateDuration(child, beamContext);
        total = addRational(total, childDuration);
        const broken = findBrokenToken(child);
        if (broken) {
          beamContext.brokenRhythmPending = broken;
        } else {
          beamContext.brokenRhythmPending = undefined;
        }
      }
      child = child.nextSibling;
    }
    return total;
  }

  let result: IRational;
  if (node.tag === TAGS.Note) {
    result = calculateBaseDuration(node, context);
    if (context.tuplet) {
      result = multiplyRational(result, createRational(context.tuplet.q, context.tuplet.p));
    }
  } else if (node.tag === TAGS.Chord || node.tag === TAGS.Rest || node.tag === TAGS.YSPACER) {
    result = calculateBaseDuration(node, context);
  } else {
    result = createRational(0, 1);
  }

  // Update broken rhythm state for the next note. Because the Beam and
  // MultiMeasureRest cases return early above, we only reach this point
  // for Note, Chord, Rest, and YSPACER — all of which should update state.
  const broken = findBrokenToken(node);
  if (broken) {
    context.brokenRhythmPending = broken;
  } else {
    context.brokenRhythmPending = undefined;
  }

  return result;
}

export function splitNoteAt(targetNode: CSNode, splitAt: IRational, ctx: ABCContext): { first: CSNode; second: CSNode } | null {
  const originalDuration = calculateDuration(targetNode, {});

  if (compareRational(splitAt, createRational(0, 1)) <= 0 || compareRational(splitAt, originalDuration) >= 0) {
    return null;
  }

  const firstClone = cloneSubtree(targetNode, () => ctx.generateId());
  const secondClone = cloneSubtree(targetNode, () => ctx.generateId());

  const remainingDuration = subtractRational(originalDuration, splitAt);

  replaceRhythm(firstClone, rationalToRhythm(splitAt, ctx));
  replaceRhythm(secondClone, rationalToRhythm(remainingDuration, ctx));

  replace(targetNode, firstClone);
  insertAfter(firstClone, secondClone);

  return { first: firstClone, second: secondClone };
}

export function getMaxChordSize(startNode: CSNode | null): number {
  let maxSize = 1;
  let current = startNode;
  while (current !== null) {
    if (current.tag === TAGS.Chord) {
      const noteCount = collectNotesFromChord(current).length;
      maxSize = Math.max(maxSize, noteCount);
    } else if (current.tag === TAGS.Beam || current.tag === TAGS.Tuplet) {
      maxSize = Math.max(maxSize, getMaxChordSize(current.firstChild));
    }
    current = current.nextSibling;
  }
  return maxSize;
}

function isBoundaryNode(node: CSNode): boolean {
  if (node.tag === TAGS.BarLine) return true;
  if (isVoiceMarker(node)) return true;
  if (isTokenNode(node) && getTokenData(node).tokenType === TT.EOL) return true;
  return false;
}

/**
 * Walks up from a node to find its nearest ancestor System node, if any.
 * CSNode has no direct parent pointer -- parentRef either points to the
 * previous sibling (walk left until we reach the first child) or, at the
 * first child, to the actual parent node.
 */
function findEnclosingSystem(node: CSNode): CSNode | null {
  let current: CSNode | null = node;
  while (current !== null && current.parentRef !== null) {
    if (current.parentRef.tag === "firstChild") {
      const parent: CSNode = current.parentRef.parent;
      if (parent.tag === TAGS.System) return parent;
      current = parent;
    } else {
      current = current.parentRef.prev;
    }
  }
  return null;
}

export function getBarSlice(systemNode: CSNode, barEntry: barmap.BarEntry): BarSlice | null {
  const endNode = findNodeById(systemNode, barEntry.closingNodeId);
  if (endNode === null) return null;

  let startNode: CSNode | null = endNode;
  let current: CSNode = endNode;
  while (current.parentRef !== null && current.parentRef.tag === "sibling") {
    const prev = current.parentRef.prev;
    if (isBoundaryNode(prev)) {
      break;
    }
    startNode = prev;
    current = prev;
  }

  return { systemNode, startNode, endNode };
}

// We use manual iteration here rather than walkByTag or findFirstByTag because
// we need early-return-on-predicate (the first System where getBarSlice succeeds),
// which neither walkByTag nor findFirstByTag supports.
export function findBarSliceInSystems(rootNode: CSNode, barEntry: barmap.BarEntry): BarSlice | null {
  // When the root is a System itself, search it directly instead of
  // iterating children looking for System nodes.
  if (rootNode.tag === TAGS.System) {
    return getBarSlice(rootNode, barEntry);
  }
  let child = rootNode.firstChild;
  while (child !== null) {
    if (child.tag === TAGS.System) {
      const slice = getBarSlice(child, barEntry);
      if (slice) return slice;
    }
    child = child.nextSibling;
  }
  return null;
}

// --- Types ---

export interface TimeMapEntry {
  node: CSNode;
  startTime: IRational;
  duration: IRational;
}

export interface TimeRange {
  start: IRational;
  end: IRational;
}

export interface BarRange {
  start: number;
  end: number;
}

export interface PartAssignment {
  sourceVoiceId: string;
  partIndices: number[];
}

export interface SourceVoiceContent {
  voiceId: string;
  contentNode: CSNode;
}

export interface PreparedPart {
  targetVoiceId: string;
  sourceVoiceId: string;
  filteredContent: CSNode;
  unfilteredContent: CSNode;
  partIndices: number[];
}

/**
 * Builds a time map for the sibling chain from startNode to endNode
 * (inclusive). Each entry records the CSNode, its start time, and its
 * duration. The duration context is carried across entries because
 * broken rhythms are stateful.
 */
export function buildTimeMap(startNode: CSNode | null, endNode: CSNode | null, barDuration?: IRational): TimeMapEntry[] {
  const entries: TimeMapEntry[] = [];
  let currentTime = createRational(0, 1);
  const durCtx: DurationContext = {};
  let current = startNode;

  while (current !== null) {
    if (isTimeEvent(current)) {
      let duration = calculateDuration(current, durCtx);

      if (isInfiniteRational(duration)) {
        if (barDuration) {
          duration = barDuration;
        } else {
          break;
        }
      }

      entries.push({ node: current, startTime: currentTime, duration });
      currentTime = addRational(currentTime, duration);
    }

    if (current === endNode) break;
    current = current.nextSibling;
  }

  return entries;
}

/**
 * Computes the musical time interval within a bar that corresponds to
 * the cursor's character range. We build a time map and check which
 * entries overlap the cursor using computeNodeRange.
 */
export function cursorRangeToTimeRange(startNode: CSNode | null, endNode: CSNode | null, cursorRange: Range): TimeRange {
  const timeMap = buildTimeMap(startNode, endNode);
  let minTime: IRational | null = null;
  let maxTime: IRational = createRational(0, 1);

  for (const entry of timeMap) {
    const nodeRange = computeNodeRange(entry.node);
    if (nodeRange === null) continue;

    if (rangesOverlap(nodeRange, cursorRange)) {
      if (minTime === null || compareRational(entry.startTime, minTime) < 0) {
        minTime = entry.startTime;
      }
      const entryEnd = addRational(entry.startTime, entry.duration);
      if (compareRational(entryEnd, maxTime) > 0) {
        maxTime = entryEnd;
      }
    }
  }

  if (minTime === null) {
    return { start: createRational(0, 1), end: createRational(0, 1) };
  }

  return { start: minTime, end: maxTime };
}

/**
 * Replaces the content within a time range in a target bar with new
 * content. If a note straddles a boundary of the time range, it is
 * split into two notes with adjusted durations.
 */
/**
 * Converts a MultiMeasureRest node in-place to a regular Rest node with
 * the given duration. Because MMRs represent whole measures, they cannot
 * be split at sub-bar time offsets. Converting to a regular rest first
 * allows the normal split logic to proceed.
 */
function convertMmrToRest(mmrNode: CSNode, duration: IRational, ctx: ABCContext): void {
  while (mmrNode.firstChild) remove(mmrNode.firstChild);

  const restToken = createCSNode(TAGS.Token, ctx.generateId(), {
    lexeme: "z",
    tokenType: TT.REST,
    line: -1,
    position: -1,
  });

  mmrNode.tag = TAGS.Rest;
  appendChild(mmrNode, restToken);

  const rhythmNode = rationalToRhythm(duration, ctx);
  if (rhythmNode) appendChild(mmrNode, rhythmNode);
}

export function replaceTimeRangeInBar(barSlice: BarSlice, timeRange: TimeRange, replacementNodes: CSNode[], ctx: ABCContext, barDuration?: IRational): void {
  // Convert any MultiMeasureRest nodes to regular rests before splitting,
  // because MMRs represent whole measures and cannot be split at sub-bar
  // time offsets. The converted rest uses barDuration as its duration.
  if (barDuration) {
    let scan = barSlice.startNode;
    while (scan !== null) {
      if (scan.tag === TAGS.MultiMeasureRest) {
        convertMmrToRest(scan, barDuration, ctx);
      }
      if (scan === barSlice.endNode) break;
      scan = scan.nextSibling;
    }
  }

  let timeMap = buildTimeMap(barSlice.startNode, barSlice.endNode, barDuration);

  let firstOverlapIdx: number | null = null;
  let lastOverlapIdx: number | null = null;

  for (let i = 0; i < timeMap.length; i++) {
    const entry = timeMap[i];
    const entryEnd = addRational(entry.startTime, entry.duration);
    if (compareRational(entryEnd, timeRange.start) > 0 && compareRational(entry.startTime, timeRange.end) < 0) {
      if (firstOverlapIdx === null) firstOverlapIdx = i;
      lastOverlapIdx = i;
    }
  }

  if (firstOverlapIdx === null || lastOverlapIdx === null) return;

  // Split the first overlapping entry if it starts before the time range
  const firstEntry = timeMap[firstOverlapIdx];
  if (compareRational(firstEntry.startTime, timeRange.start) < 0) {
    const splitAtOffset = subtractRational(timeRange.start, firstEntry.startTime);
    const splitResult = splitNoteAt(firstEntry.node, splitAtOffset, ctx);
    // Update barSlice boundaries if the split target was a boundary node
    if (splitResult) {
      if (barSlice.startNode === firstEntry.node) barSlice.startNode = splitResult.first;
      if (barSlice.endNode === firstEntry.node) barSlice.endNode = splitResult.second;
    }
    // After splitting, rebuild the time map because the sibling chain changed
    timeMap = buildTimeMap(barSlice.startNode, barSlice.endNode, barDuration);
    firstOverlapIdx = firstOverlapIdx + 1;
    lastOverlapIdx = lastOverlapIdx + 1;
  }

  // Split the last overlapping entry if it extends beyond the time range
  const lastEntry = timeMap[lastOverlapIdx];
  if (!lastEntry) return;
  const lastEnd = addRational(lastEntry.startTime, lastEntry.duration);
  if (compareRational(lastEnd, timeRange.end) > 0) {
    const splitAtOffset = subtractRational(timeRange.end, lastEntry.startTime);
    const splitResult = splitNoteAt(lastEntry.node, splitAtOffset, ctx);
    if (splitResult) {
      if (barSlice.startNode === lastEntry.node) barSlice.startNode = splitResult.first;
      if (barSlice.endNode === lastEntry.node) barSlice.endNode = splitResult.second;
    }
    // Rebuild time map so we have accurate node references
    timeMap = buildTimeMap(barSlice.startNode, barSlice.endNode, barDuration);
    // lastOverlapIdx stays the same: we replace only the first half
  }

  // Collect ALL sibling nodes from the first overlapping time event to the
  // last overlapping time event (inclusive). This removes whitespace tokens
  // between time events, matching the AST version's splice behavior.
  const firstNode = timeMap[firstOverlapIdx].node;
  const lastNode = timeMap[lastOverlapIdx].node;
  const nodesToRemove: CSNode[] = [];
  let scan: CSNode | null = firstNode;
  while (scan !== null) {
    nodesToRemove.push(scan);
    if (scan === lastNode) break;
    scan = scan.nextSibling;
  }

  // Find the insertion anchor: the node after the last removed node
  const afterLast = lastNode.nextSibling;

  // Remove the overlapping nodes
  for (const node of nodesToRemove) {
    remove(node);
  }

  // Insert the replacement nodes at the position of the removed nodes
  if (afterLast !== null) {
    // Insert before the node that follows the removed range.
    // Because each insertBefore places the new node immediately before
    // afterLast, iterating forward preserves the original order.
    for (const node of replacementNodes) {
      insertBefore(afterLast, node);
    }
  } else {
    // The removed nodes were at the end of the system's children.
    // We append to the system node.
    for (const node of replacementNodes) {
      appendChild(barSlice.systemNode, node);
    }
  }

  // Update barSlice boundaries to reflect the new structure
  if (barSlice.startNode !== null && nodesToRemove.includes(barSlice.startNode)) {
    barSlice.startNode = replacementNodes.length > 0 ? replacementNodes[0] : afterLast;
  }
  if (barSlice.endNode !== null && nodesToRemove.includes(barSlice.endNode)) {
    barSlice.endNode = replacementNodes.length > 0 ? replacementNodes[replacementNodes.length - 1] : null;
  }
}

/**
 * Extracts the content of a range of bars for a given voice. Returns a
 * temporary System CSNode whose children are cloned copies of the content
 * from each bar in the range, with BarLine delimiters between bars.
 */
export function extractBarsContent(barMap: barmap.BarMap, barRange: BarRange, voiceId: string, rootNode: CSNode, ctx: ABCContext): CSNode {
  const voiceEntries = barMap.get(voiceId);
  const systemNode = createCSNode(TAGS.System, ctx.generateId(), null);
  if (!voiceEntries) return systemNode;

  for (let barNum = barRange.start; barNum <= barRange.end; barNum++) {
    const entry = voiceEntries.get(barNum);
    if (!entry) continue;

    const slice = findBarSliceInSystems(rootNode, entry);
    if (!slice) continue;

    // Clone each node from startNode to endNode, preserving IDs so that
    // downstream trimming in explodeParts can cross-check against the
    // cursor selection set. Fresh IDs are assigned later when replacement
    // nodes are cloned for insertion.
    let current = slice.startNode;
    while (current !== null) {
      const clone = cloneSubtree(current, () => ctx.generateId(), true);
      appendChild(systemNode, clone);
      if (current === slice.endNode) break;
      current = current.nextSibling;
    }
  }

  return systemNode;
}

/**
 * Filters a chord to keep only the notes at the specified part indices
 * (top-down, 0-based). Because chord notes are stored bottom-up, we
 * convert each top-down index to a bottom-up index. If no notes survive,
 * the chord is converted to a rest. If exactly one note survives, the
 * chord is unwrapped.
 */
function filterChordToPartIndices(treeRoot: CSNode, chordNode: CSNode, partIndices: number[], ctx: ABCContext): void {
  const notes = collectNotesFromChord(chordNode);
  const noteIndicesToKeep = new Set<number>();

  for (const pi of partIndices) {
    const noteIdx = notes.length - 1 - pi;
    if (noteIdx >= 0) {
      noteIndicesToKeep.add(noteIdx);
    }
  }

  if (noteIndicesToKeep.size === 0) {
    chordToRest(chordNode, ctx);
    return;
  }

  // Remove notes not in the keep set
  for (let i = 0; i < notes.length; i++) {
    if (!noteIndicesToKeep.has(i)) {
      remove(notes[i]);
    }
  }

  // If exactly one note remains, unwrap the chord
  const remaining = collectNotesFromChord(chordNode);
  if (remaining.length === 1) {
    const tempSelection: Selection = {
      root: treeRoot,
      cursors: [new Set([chordNode.id])],
    };
    unwrapSingle(tempSelection);
  }
}

/**
 * Removes grace groups from the sibling chain for parts that do not
 * include part 0. Grace groups ornament the top voice only.
 */
function removeGraceGroupsForPartIndices(parent: CSNode, partIndices: number[]): void {
  if (partIndices.includes(0)) return;

  let current = parent.firstChild;
  while (current !== null) {
    const next = current.nextSibling;
    if (current.tag === TAGS.Grace_group) {
      remove(current);
    }
    current = next;
  }
}

/**
 * Walks a sibling chain and filters elements based on the part indices.
 * Chords are filtered to keep only the notes at partIndices. Standalone
 * notes become rests when 0 is not in partIndices. Grace groups are
 * removed for parts that do not include 0. Recurses into Beam and
 * Tuplet containers.
 */
export function walkAndFilterMulti(treeRoot: CSNode, startNode: CSNode | null, partIndices: number[], ctx: ABCContext): void {
  const isLowerPart = !partIndices.includes(0);

  removeGraceGroupsForPartIndices(treeRoot, partIndices);

  let current = startNode;
  while (current !== null) {
    const next = current.nextSibling;

    if (current.tag === TAGS.Chord) {
      filterChordToPartIndices(treeRoot, current, partIndices, ctx);
    } else if (current.tag === TAGS.Note) {
      if (isLowerPart) {
        noteToRest(current, ctx);
      }
    } else if (current.tag === TAGS.Beam || current.tag === TAGS.Tuplet) {
      removeGraceGroupsForPartIndices(current, partIndices);
      walkAndFilterMulti(treeRoot, current.firstChild, partIndices, ctx);
    }

    current = next;
  }
}

/**
 * Filters the children of a System CSNode to keep only the specified
 * part indices. After filtering, consecutive rests are consolidated.
 */
export function filterToParts(systemNode: CSNode, partIndices: number[], ctx: ABCContext): void {
  walkAndFilterMulti(systemNode, systemNode.firstChild, partIndices, ctx);

  const allIds = collectSiblingIds(systemNode.firstChild);
  const lineSelection: Selection = { root: systemNode, cursors: [allIds] };
  consolidateRests(lineSelection, ctx);
}

/**
 * Assigns part indices to target voices based on the maximum chord size
 * of each source voice. When there are more chord notes than remaining
 * target voices, the last target voice gets all leftover part indices.
 * This is a pure-logic function with no AST or CSTree dependencies.
 */
export function assignParts(sourceContents: SourceVoiceContent[], targetVoiceIds: string[]): Map<string, PartAssignment> {
  const assignments = new Map<string, PartAssignment>();
  let targetIdx = 0;

  for (const source of sourceContents) {
    const maxChordSize = getMaxChordSize(source.contentNode.firstChild);
    const numPartsForThisVoice = Math.min(maxChordSize, targetVoiceIds.length - targetIdx);

    for (let partIndex = 0; partIndex < numPartsForThisVoice; partIndex++) {
      let partIndices: number[];
      if (partIndex === numPartsForThisVoice - 1 && maxChordSize > numPartsForThisVoice) {
        partIndices = Array.from({ length: maxChordSize - partIndex }, (_, k) => partIndex + k);
      } else {
        partIndices = [partIndex];
      }

      assignments.set(targetVoiceIds[targetIdx], {
        sourceVoiceId: source.voiceId,
        partIndices,
      });
      targetIdx++;
    }
  }

  return assignments;
}

/**
 * Extract bars of music per source voice,
 * assign to each target voice,
 * filter contents per target voice if necessary,
 * store into output
 */
export function prepareParts(
  barMap: barmap.BarMap,
  barRange: BarRange,
  sourceVoiceIds: string[],
  targetVoiceIds: string[],
  rootNode: CSNode,
  ctx: ABCContext
): PreparedPart[] {
  // Extract source content once per source voice
  const sourceContents = new Map<string, CSNode>();
  for (const voiceId of sourceVoiceIds) {
    sourceContents.set(voiceId, extractBarsContent(barMap, barRange, voiceId, rootNode, ctx));
  }

  const assignments = assignParts(
    sourceVoiceIds.map((voiceId) => ({
      voiceId,
      contentNode: sourceContents.get(voiceId)!,
    })),
    targetVoiceIds
  );

  const parts: PreparedPart[] = [];

  for (const targetVoiceId of targetVoiceIds) {
    const assignment = assignments.get(targetVoiceId);
    if (!assignment) continue;

    const sourceContent = sourceContents.get(assignment.sourceVoiceId)!;

    // The unfiltered clone preserves token data (line/position) so
    // that cursorRangeToTimeRange can compute range overlaps.
    const unfilteredClone = cloneSubtree(sourceContent, () => ctx.generateId(), true);

    // The filtered clone preserves source IDs so that explodeParts can
    // cross-check node IDs against the cursor selection to trim content
    // to the selected portion. Fresh IDs are assigned later when the
    // replacement nodes are cloned for insertion.
    const filteredClone = cloneSubtree(sourceContent, () => ctx.generateId(), true);
    filterToParts(filteredClone, assignment.partIndices, ctx);

    parts.push({
      targetVoiceId,
      sourceVoiceId: assignment.sourceVoiceId,
      filteredContent: filteredClone,
      unfilteredContent: unfilteredClone,
      partIndices: assignment.partIndices,
    });
  }

  return parts;
}

/**
 * Determines the bar range spanned by a cursor selection. We resolve
 * the voice at the cursor start from snapshots, then iterate that
 * voice's bar entries. For each entry, we locate the closing anchor
 * node and compare its position against the cursor range.
 */
export function getSourceBarRange(barMap: barmap.BarMap, rootNode: CSNode, cursorRange: Range, snapshots: DocumentSnapshots): BarRange {
  const voiceId = getSnapshotAtPosition(snapshots, encode(cursorRange.start.line, cursorRange.start.character)).voiceId;
  const voiceEntries = barMap.get(voiceId);

  let startBarNum = 0;
  let endBarNum = 0;

  if (voiceEntries) {
    for (const entry of voiceEntries.values()) {
      const anchorNode = findNodeById(rootNode, entry.closingNodeId);
      if (!anchorNode) continue;

      const anchorRange = computeNodeRange(anchorNode);
      if (anchorRange === null) continue;

      const anchorPos = anchorRange.start;

      if (anchorPos.line < cursorRange.start.line || (anchorPos.line === cursorRange.start.line && anchorPos.character < cursorRange.start.character)) {
        startBarNum = entry.barNumber + 1;
      }

      if (anchorPos.line < cursorRange.end.line || (anchorPos.line === cursorRange.end.line && anchorPos.character < cursorRange.end.character)) {
        endBarNum = entry.barNumber + 1;
      }
    }
  }

  // Clamp endBarNum to the highest bar number in the voice's entries
  if (voiceEntries) {
    let maxBar = 0;
    for (const entry of voiceEntries.values()) {
      if (entry.barNumber > maxBar) maxBar = entry.barNumber;
    }
    if (endBarNum > maxBar) endBarNum = maxBar;
  }

  return { start: startBarNum, end: endBarNum };
}

/**
 * O(1) lookup in the nested bar map.
 */
export function findBarEntry(barMap: barmap.BarMap, voiceId: string, barNum: number): barmap.BarEntry | null {
  return barMap.get(voiceId)?.get(barNum) ?? null;
}

interface VoicePosition {
  voiceId: string;
  systemNode: CSNode;
}

/**
 * Collects voice IDs and their associated system nodes from the tune
 * body. In deferred mode, voice markers (V: Info_lines) appear as
 * direct children of tuneBody before the System they apply to. In
 * linear mode, voice markers appear inside System children. We handle
 * both cases by tracking the last voice marker seen at either level.
 */
export function collectVoicePositions(tuneBody: CSNode): VoicePosition[] {
  const result: VoicePosition[] = [];
  let child = tuneBody.firstChild;
  let pendingVoiceId: string | null = null;

  while (child !== null) {
    // In deferred mode, V: Info_lines are direct children of tuneBody
    if (isVoiceMarker(child)) {
      const vid = extractVoiceId(child);
      if (vid !== null) {
        pendingVoiceId = vid;
      }
    }

    if (child.tag === TAGS.System) {
      // If a voice marker was seen before this system, record it
      if (pendingVoiceId !== null && !result.some((r) => r.voiceId === pendingVoiceId)) {
        result.push({ voiceId: pendingVoiceId, systemNode: child });
        pendingVoiceId = null;
      }

      // Also check for voice markers inside the system (linear mode has
      // multiple voice markers within a single system)
      let systemChild = child.firstChild;
      while (systemChild !== null) {
        if (isVoiceMarker(systemChild)) {
          const vid = extractVoiceId(systemChild);
          if (vid !== null && !result.some((r) => r.voiceId === vid)) {
            result.push({ voiceId: vid, systemNode: child });
          }
        }
        systemChild = systemChild.nextSibling;
      }
    }
    child = child.nextSibling;
  }

  return result;
}

export interface VoiceLineNodes {
  inlineField: CSNode;
  multiMeasureRestNode: CSNode;
  barlineNode: CSNode;
  /** Trailing EOL token. In the CSTree serialization, this is needed to
   * produce a line break after the barline in both linear and deferred modes. */
  eolToken: CSNode;
}

/**
 * Creates the nodes for a new voice line: an inline field voice marker
 * [V:voiceId], a placeholder rest, a barline, and a trailing EOL. The nodes
 * are returned unattached so the caller can decide where to insert them.
 *
 * When `barDuration` is given, the placeholder is a plain rest with an
 * explicit rhythm matching it (e.g. "z2") rather than a bare "Z" multi-measure
 * rest, so the seed bar reflects the source bar's actual length -- see
 * `createBar` for the same reasoning applied to later bars.
 */
export function createVoiceLineNodes(voiceId: string, ctx: ABCContext, barDuration?: IRational): VoiceLineNodes {
  // Create voice marker: [V:voiceId]
  const inlineField = createCSNode(TAGS.Inline_field, ctx.generateId(), null);
  const leftBracket = createCSNode(TAGS.Token, ctx.generateId(), {
    lexeme: "[",
    tokenType: TT.INLN_FLD_LFT_BRKT,
    line: -1,
    position: -1,
  });
  const headerToken = createCSNode(TAGS.Token, ctx.generateId(), {
    lexeme: "V:",
    tokenType: TT.INF_HDR,
    line: -1,
    position: -1,
  });
  const valueToken = createCSNode(TAGS.Token, ctx.generateId(), {
    lexeme: voiceId,
    tokenType: TT.INFO_STR,
    line: -1,
    position: -1,
  });
  const rightBracket = createCSNode(TAGS.Token, ctx.generateId(), {
    lexeme: "]",
    tokenType: TT.INLN_FLD_RGT_BRKT,
    line: -1,
    position: -1,
  });
  appendChild(inlineField, leftBracket);
  appendChild(inlineField, headerToken);
  appendChild(inlineField, valueToken);
  appendChild(inlineField, rightBracket);

  // Create the placeholder rest
  let multiMeasureRestNode: CSNode;
  if (barDuration) {
    multiMeasureRestNode = createCSNode(TAGS.Rest, ctx.generateId(), null);
    const restToken = createCSNode(TAGS.Token, ctx.generateId(), {
      lexeme: "z",
      tokenType: TT.REST,
      line: -1,
      position: -1,
    });
    appendChild(multiMeasureRestNode, restToken);
    const rhythmNode = rationalToRhythm(barDuration, ctx);
    if (rhythmNode) appendChild(multiMeasureRestNode, rhythmNode);
  } else {
    multiMeasureRestNode = createCSNode(TAGS.MultiMeasureRest, ctx.generateId(), null);
    const multiMeasureRestToken = createCSNode(TAGS.Token, ctx.generateId(), {
      lexeme: "Z",
      tokenType: TT.REST,
      line: -1,
      position: -1,
    });
    appendChild(multiMeasureRestNode, multiMeasureRestToken);
  }

  // Create barline
  const barlineNode = createCSNode(TAGS.BarLine, ctx.generateId(), null);
  const barlineToken = createCSNode(TAGS.Token, ctx.generateId(), {
    lexeme: "|",
    tokenType: TT.BARLINE,
    line: -1,
    position: -1,
  });
  appendChild(barlineNode, barlineToken);

  // Create trailing EOL
  const eolToken = createCSNode(TAGS.Token, ctx.generateId(), {
    lexeme: "\n",
    tokenType: TT.EOL,
    line: -1,
    position: -1,
  });

  return { inlineField, multiMeasureRestNode, barlineNode, eolToken };
}

/**
 * Registers a new voice in the bar map with a single seed bar entry, using
 * the given closingNodeId as the bar's anchor. This creates a seed bar only
 * -- explodeParts then calls createBar in a loop to fill in any missing bars
 * up to the target bar number.
 *
 * The seed is registered under startBarNum (default 0) rather than always 0
 * because a voice's bar numbers are cumulative across every System it
 * appears in: exploding a System other than the voice's first leaves
 * barRange.start above 0, and seeding at 0 would leave a stray extra bar
 * behind that no later bar number ever targets or replaces.
 */
export function registerVoiceInBarMap(barMap: barmap.BarMap, voiceId: string, closingNodeId: number, startBarNum = 0): void {
  const voiceEntries = new Map<number, barmap.BarEntry>();
  voiceEntries.set(startBarNum, {
    barNumber: startBarNum,
    closingNodeId,
  });
  barMap.set(voiceId, voiceEntries);
}

/**
 * Finds the voice line inside a linear-mode System that the tune's voice order
 * places directly after the given voice. A new line is inserted before that
 * marker so the system keeps the order the tune declares, rather than being
 * appended after voices that belong below it. Returns null when the tune
 * declares no later voice, meaning the new line belongs at the end.
 */
function findLinearVoiceSuccessor(systemNode: CSNode, voiceId: string, voiceOrder: string[]): CSNode | null {
  const targetIdx = voiceOrder.indexOf(voiceId);
  if (targetIdx === -1) return null;

  let child = systemNode.firstChild;
  while (child !== null) {
    if (isVoiceMarker(child)) {
      const existingId = extractVoiceId(child);
      if (existingId !== null && voiceOrder.indexOf(existingId) > targetIdx) {
        return child;
      }
    }
    child = child.nextSibling;
  }
  return null;
}

/**
 * Creates a new voice line and inserts it into a Tune_Body at the correct
 * position according to voiceOrder. Used by deferred mode where each voice
 * occupies its own System.
 */
export function createVoiceLine(
  barMap: barmap.BarMap,
  voiceId: string,
  tuneBody: CSNode,
  voiceOrder: string[],
  ctx: ABCContext,
  startBarNum = 0,
  barDuration?: IRational
): void {
  const nodes = createVoiceLineNodes(voiceId, ctx, barDuration);
  const systemNode = createCSNode(TAGS.System, ctx.generateId(), null);
  appendChild(systemNode, nodes.inlineField);
  appendChild(systemNode, nodes.multiMeasureRestNode);
  appendChild(systemNode, nodes.barlineNode);
  appendChild(systemNode, nodes.eolToken);

  // Find the correct insertion position
  const targetIdx = voiceOrder.indexOf(voiceId);

  if (targetIdx === -1) {
    appendChild(tuneBody, systemNode);
  } else {
    const existingVoices = collectVoicePositions(tuneBody);
    let insertBeforeSystem: CSNode | null = null;

    for (const existing of existingVoices) {
      const existingIdx = voiceOrder.indexOf(existing.voiceId);
      if (existingIdx > targetIdx) {
        insertBeforeSystem = existing.systemNode;
        break;
      }
    }

    if (insertBeforeSystem !== null) {
      insertBefore(insertBeforeSystem, systemNode);
    } else {
      appendChild(tuneBody, systemNode);
    }
  }

  registerVoiceInBarMap(barMap, voiceId, nodes.barlineNode.id, startBarNum);
}

/**
 * Creates a rest-filled bar for a voice and registers it in the bar map.
 *
 * When `barDuration` is given, the rest is written as a plain rest with an
 * explicit rhythm matching that duration (e.g. "z2") instead of a bare "Z"
 * multi-measure rest, so a bar padded in to keep a target voice aligned with
 * its source reflects the source bar's actual length rather than an
 * arbitrary whole-bar placeholder.
 *
 * The new bar is inserted at its correct numeric position among the voice's
 * existing entries, not simply appended after whichever entry has the
 * largest barNumber: the trailing padding loop in explodeParts can create
 * bars out of numeric order relative to bars a prior pass in the same call
 * already created (e.g. padding an earlier bar in the same System after a
 * later bar has already been filled in), so we look for the immediate
 * numeric predecessor and successor among existing entries and insert
 * relative to whichever is found.
 */
export function createBar(barMap: barmap.BarMap, voiceId: string, barNum: number, rootNode: CSNode, ctx: ABCContext, barDuration?: IRational): void {
  const voiceEntries = barMap.get(voiceId);
  if (!voiceEntries || voiceEntries.size === 0) return;

  let predecessor: barmap.BarEntry | null = null;
  let successor: barmap.BarEntry | null = null;
  for (const entry of voiceEntries.values()) {
    if (entry.barNumber < barNum && (predecessor === null || entry.barNumber > predecessor.barNumber)) {
      predecessor = entry;
    }
    if (entry.barNumber > barNum && (successor === null || entry.barNumber < successor.barNumber)) {
      successor = entry;
    }
  }
  if (predecessor === null && successor === null) return;

  // Create the placeholder rest. When the source bar's duration is known, use
  // a plain rest with an explicit rhythm (e.g. "z2") matching it, instead of
  // a bare "Z" multi-measure rest whose implicit duration doesn't reflect it.
  let mmrNode: CSNode;
  if (barDuration) {
    mmrNode = createCSNode(TAGS.Rest, ctx.generateId(), null);
    const restToken = createCSNode(TAGS.Token, ctx.generateId(), {
      lexeme: "z",
      tokenType: TT.REST,
      line: -1,
      position: -1,
    });
    appendChild(mmrNode, restToken);
    const rhythmNode = rationalToRhythm(barDuration, ctx);
    if (rhythmNode) appendChild(mmrNode, rhythmNode);
  } else {
    mmrNode = createCSNode(TAGS.MultiMeasureRest, ctx.generateId(), null);
    const mmrToken = createCSNode(TAGS.Token, ctx.generateId(), {
      lexeme: "Z",
      tokenType: TT.REST,
      line: -1,
      position: -1,
    });
    appendChild(mmrNode, mmrToken);
  }

  // Create barline
  const barlineNode = createCSNode(TAGS.BarLine, ctx.generateId(), null);
  const barlineToken = createCSNode(TAGS.Token, ctx.generateId(), {
    lexeme: "|",
    tokenType: TT.BARLINE,
    line: -1,
    position: -1,
  });
  appendChild(barlineNode, barlineToken);

  if (predecessor !== null) {
    const anchorNode = findNodeById(rootNode, predecessor.closingNodeId);
    if (!anchorNode) return;

    // Find the insertion point: after the anchor but before the next voice
    // marker, so we stay within the correct voice's content region. The scan
    // stops at the line terminator as well, because the bar belongs on its own
    // voice's line rather than after the newline that closes it.
    let insertionPoint: CSNode | null = anchorNode.nextSibling;
    while (insertionPoint !== null) {
      if (isVoiceMarker(insertionPoint) || isEolNode(insertionPoint)) break;
      insertionPoint = insertionPoint.nextSibling;
    }

    if (insertionPoint !== null) {
      insertBefore(insertionPoint, mmrNode);
      insertBefore(insertionPoint, barlineNode);
    } else {
      insertAfter(anchorNode, mmrNode);
      insertAfter(mmrNode, barlineNode);
    }
  } else {
    // No numeric predecessor exists yet: insert immediately before the
    // successor bar's own content, so the new bar lands ahead of it.
    const successorAnchor = findNodeById(rootNode, successor!.closingNodeId);
    if (!successorAnchor) return;
    const successorSystem = findEnclosingSystem(successorAnchor);
    const successorSlice = successorSystem ? getBarSlice(successorSystem, successor!) : null;
    const insertionPoint = successorSlice?.startNode ?? successorAnchor;

    insertBefore(insertionPoint, mmrNode);
    insertBefore(insertionPoint, barlineNode);
  }

  voiceEntries.set(barNum, {
    barNumber: barNum,
    closingNodeId: barlineNode.id,
  });
}

// --- getVoiceIdsFromSelection (already CSTree-native, moved here) ---

interface VoiceMarkerCtx {
  voiceIds: Set<string>;
  selectionRange: Range;
}

function collectVoiceMarkerCallback(node: CSNode, ctx: VoiceMarkerCtx): void {
  if (!isVoiceMarker(node)) return;

  const nodeRange = computeNodeRange(node);
  if (!nodeRange || !rangesOverlap(nodeRange, ctx.selectionRange)) return;

  const vid = extractVoiceId(node);
  if (vid !== null) {
    ctx.voiceIds.add(vid);
  }
}

/**
 * Derives the set of source voice IDs from the selection. We compute the
 * selection's bounding range, resolve the starting voice from snapshots,
 * then walk the given tune body for voice markers that fall within that range.
 *
 * The tune body is supplied by the caller rather than resolved here, because the caller
 * knows which tune the selection belongs to. Resolving it here would walk the first tune of
 * the document and therefore miss every voice marker in any later tune.
 */
export function getVoiceIdsFromSelection(selection: Selection, tuneBody: CSNode, snapshots: DocumentSnapshots): Set<string> {
  const allIds = new Set<number>();
  for (const cursor of selection.cursors) {
    for (const id of cursor) {
      allIds.add(id);
    }
  }
  const selectionRange = getCursorRange(allIds, selection.root);
  if (!selectionRange) return new Set();

  const pos = encode(selectionRange.start.line, selectionRange.start.character);
  const startingVoice = getSnapshotAtPosition(snapshots, pos).voiceId;

  const voiceIds = new Set<string>([startingVoice]);

  walkByTag([TAGS.Inline_field, TAGS.Info_line], { voiceIds, selectionRange }, collectVoiceMarkerCallback, tuneBody.firstChild);

  return voiceIds;
}

// --- explodeParts ---

/**
 * Trims a list of nodes to only those whose character position overlaps
 * the cursor range. This keeps all node types (annotations, WS, etc.)
 * that fall within the selection, not just those whose IDs happen to
 * be in the cursor set.
 */
function trimToSelection(nodes: CSNode[], cursorRange: Range): CSNode[] {
  return nodes.filter((n) => {
    const nodeRange = computeNodeRange(n);
    if (nodeRange === null) return false;
    return rangesOverlap(nodeRange, cursorRange);
  });
}

/**
 * Collects sibling nodes from startNode up to (but not including) a BarLine
 * delimiter. Returns the collected nodes and the next node to continue from
 * (which is either the sibling after the barline, or null).
 */
function collectBarSegment(startNode: CSNode | null): { nodes: CSNode[]; next: CSNode | null } {
  const nodes: CSNode[] = [];
  let current = startNode;
  while (current !== null) {
    if (current.tag === TAGS.BarLine) {
      return { nodes, next: current.nextSibling };
    }
    nodes.push(current);
    current = current.nextSibling;
  }
  return { nodes, next: null };
}

/**
 * The core explosion loop. For each prepared part, we iterate its bars
 * sequentially. For each bar, we ensure the target voice and bar exist
 * (creating them if not), compute the time range from the unfiltered
 * source bar, and perform the time-range-based replacement in the target.
 */
function explodeParts(
  parts: PreparedPart[],
  barMap: barmap.BarMap,
  barRange: BarRange,
  cursorRange: Range,
  rootNode: CSNode,
  ctx: ABCContext,
  outputSelections: Map<string, Set<number>>,
  voiceOrder: string[],
  mode: "linear" | "deferred"
): void {
  for (const part of parts) {
    let filteredCursor: CSNode | null = part.filteredContent.firstChild;
    let sourceCursor: CSNode | null = part.unfilteredContent.firstChild;

    for (let barNum = barRange.start; barNum <= barRange.end; barNum++) {
      // Collect the current bar's filtered elements (nodes before the next barline)
      const filteredSeg = collectBarSegment(filteredCursor);
      filteredCursor = filteredSeg.next;

      // Collect the current bar's unfiltered source elements (for time range)
      const sourceSeg = collectBarSegment(sourceCursor);
      sourceCursor = sourceSeg.next;

      // Compute time range from the unfiltered source bar
      const sourceStart = sourceSeg.nodes.length > 0 ? sourceSeg.nodes[0] : null;
      const sourceEnd = sourceSeg.nodes.length > 0 ? sourceSeg.nodes[sourceSeg.nodes.length - 1] : null;
      const timeRange = cursorRangeToTimeRange(sourceStart, sourceEnd, cursorRange);

      // Compute the source bar's total duration so that buildTimeMap can
      // assign a finite duration to any Z placeholder rests in the target bar,
      // and so any placeholder bar we create below (seed or padding) can be
      // written with a rest matching this bar's actual length.
      const sourceTimeMap = buildTimeMap(sourceStart, sourceEnd);
      let sourceBarDuration = createRational(0, 1);
      if (sourceTimeMap.length > 0) {
        const last = sourceTimeMap[sourceTimeMap.length - 1];
        sourceBarDuration = addRational(last.startTime, last.duration);
      }

      // Ensure the target voice exists
      if (!barMap.has(part.targetVoiceId)) {
        if (mode === "linear") {
          // In linear mode the voice lines live inside the current System, so a
          // new one is placed among them at the position the tune's voice order
          // gives it rather than after every existing voice.
          const nodes = createVoiceLineNodes(part.targetVoiceId, ctx, sourceBarDuration);
          const successor = findLinearVoiceSuccessor(rootNode, part.targetVoiceId, voiceOrder);
          if (successor !== null) {
            // Because each insertion goes immediately before the successor,
            // inserting in order leaves the nodes in that same order.
            insertBefore(successor, nodes.inlineField);
            insertBefore(successor, nodes.multiMeasureRestNode);
            insertBefore(successor, nodes.barlineNode);
            insertBefore(successor, nodes.eolToken);
          } else {
            // The new line goes at the end of the System, which means the line
            // currently last needs a terminator if it does not carry one.
            const lastChild = lastChildOf(rootNode);
            if (lastChild !== null && !isEolNode(lastChild)) {
              appendChild(rootNode, createEolNode(ctx));
            }
            appendChild(rootNode, nodes.inlineField);
            appendChild(rootNode, nodes.multiMeasureRestNode);
            appendChild(rootNode, nodes.barlineNode);
            appendChild(rootNode, nodes.eolToken);
          }
          registerVoiceInBarMap(barMap, part.targetVoiceId, nodes.barlineNode.id, barNum);
        } else {
          createVoiceLine(barMap, part.targetVoiceId, rootNode, voiceOrder, ctx, barNum, sourceBarDuration);
        }
      }

      // Ensure the target bar exists
      let targetBarEntry = findBarEntry(barMap, part.targetVoiceId, barNum);
      if (targetBarEntry === null) {
        createBar(barMap, part.targetVoiceId, barNum, rootNode, ctx, sourceBarDuration);
        targetBarEntry = findBarEntry(barMap, part.targetVoiceId, barNum);
      }
      if (targetBarEntry === null) continue;

      // Perform replacement in the target bar
      const targetSlice = findBarSliceInSystems(rootNode, targetBarEntry);
      if (!targetSlice) continue;

      // Trim filtered nodes to only those within the cursor selection, then
      // clone with fresh IDs so the original prepared content is not consumed.
      const selectedNodes = trimToSelection(filteredSeg.nodes, cursorRange);
      const replacementNodes = selectedNodes.map((n) => cloneSubtree(n, () => ctx.generateId()));

      replaceTimeRangeInBar(targetSlice, timeRange, replacementNodes, ctx, sourceBarDuration);

      // Collect output selection IDs
      const outSet = outputSelections.get(part.targetVoiceId);
      if (outSet) {
        for (const node of replacementNodes) {
          outSet.add(node.id);
        }
      }
    }

    // Create rest-filled bars for source bars that fall outside the selection,
    // but only among bars belonging to the same System as the ones just processed.
    // Bar numbers are cumulative across a voice's whole tune (spanning every System
    // it appears in), so without this scoping, a voice whose earlier Systems have more
    // bars than the System actually being exploded would get padded with bars pulled
    // from those other Systems -- bars that have nothing to do with the current selection.
    const sourceEntries = barMap.get(part.sourceVoiceId);
    if (sourceEntries) {
      const boundaryEntry = sourceEntries.get(barRange.start) ?? sourceEntries.get(barRange.end);
      const boundaryAnchor = boundaryEntry ? findNodeById(rootNode, boundaryEntry.closingNodeId) : null;
      const currentSystem = boundaryAnchor ? findEnclosingSystem(boundaryAnchor) : null;

      let maxSourceBar = 0;
      for (const entry of sourceEntries.values()) {
        if (entry.barNumber > maxSourceBar) maxSourceBar = entry.barNumber;
      }
      for (let barNum = 0; barNum <= maxSourceBar; barNum++) {
        if (barNum >= barRange.start && barNum <= barRange.end) continue;
        const entry = sourceEntries.get(barNum);
        const entryAnchor = entry ? findNodeById(rootNode, entry.closingNodeId) : null;
        if (currentSystem !== null) {
          const entrySystem = entryAnchor ? findEnclosingSystem(entryAnchor) : null;
          if (entrySystem !== currentSystem) continue;
        }
        const existing = findBarEntry(barMap, part.targetVoiceId, barNum);
        if (existing !== null) continue;

        // Give the padding rest the same duration as the source bar it
        // stands in for, instead of an arbitrary whole-bar "Z".
        const entrySlice = entryAnchor ? findBarSliceInSystems(rootNode, entry!) : null;
        let padDuration: IRational | undefined;
        if (entrySlice) {
          const entryTimeMap = buildTimeMap(entrySlice.startNode, entrySlice.endNode);
          if (entryTimeMap.length > 0) {
            const last = entryTimeMap[entryTimeMap.length - 1];
            padDuration = addRational(last.startTime, last.duration);
          }
        }

        createBar(barMap, part.targetVoiceId, barNum, rootNode, ctx, padDuration);
      }
    }
  }
}

// --- explosionLinear ---

/**
 * Handles explosion for linear-style tunes (all voices inline in the same
 * system). We process each System that overlaps the cursor independently.
 * For each such System, we clone it, build the bar map directly from the
 * clone (no Tune_Body wrapper needed), run the explosion which appends
 * new voice content inside the System, then replace the original System
 * with the modified clone.
 *
 * The tune body to work on and the map collecting the created node IDs are both supplied by
 * the caller, because a single call to the explosion transform may have to process several
 * tunes and merge their results.
 */
function explosionLinear(
  selection: Selection,
  tuneBody: CSNode,
  targetVoiceIds: string[],
  ctx: ABCContext,
  snapshots: DocumentSnapshots,
  outputSelections: Map<string, Set<number>>
): void {
  if (tuneBody.tag !== TAGS.Tune_Body) return;

  const sourceVoiceIds = getVoiceIdsFromSelection(selection, tuneBody, snapshots);
  if (sourceVoiceIds.size > 1) return;

  const voiceOrder = tuneBody.data.voices;

  // Iterate cursors in reverse so that earlier positions remain valid
  for (let ci = selection.cursors.length - 1; ci >= 0; ci--) {
    const cursor = selection.cursors[ci];
    const cursorRange = getCursorRange(cursor, selection.root);
    if (!cursorRange) continue;

    let currentSystem: CSNode | null = tuneBody.firstChild;

    while (currentSystem !== null) {
      const nextSystem = currentSystem.nextSibling;

      if (currentSystem.tag !== TAGS.System) {
        currentSystem = nextSystem;
        continue;
      }

      const systemRange = computeNodeRange(currentSystem);
      if (!systemRange || !rangesOverlap(systemRange, cursorRange)) {
        currentSystem = nextSystem;
        continue;
      }

      // Resolve the starting voice from the first token's position
      const firstTok = firstTokenData(currentSystem);
      if (!firstTok) {
        currentSystem = nextSystem;
        continue;
      }
      const startingVoiceId = getSnapshotAtPosition(snapshots, encode(firstTok.line, firstTok.position)).voiceId;

      // Build the bar map directly from the System -- no clone or
      // Tune_Body wrapper needed. The source content is independently
      // cloned by prepareParts, and the bar map's anchor nodes (barlines)
      // are never removed during mutation.
      const barMapState = barmap.init(startingVoiceId);
      visit(currentSystem, barMapState);
      barmap.finalize(barMapState);
      const barMap = barMapState.barMap;

      const barRange = getSourceBarRange(barMap, currentSystem, cursorRange, snapshots);

      const parts = prepareParts(barMap, barRange, Array.from(sourceVoiceIds), targetVoiceIds, currentSystem, ctx);

      explodeParts(parts, barMap, barRange, cursorRange, currentSystem, ctx, outputSelections, voiceOrder, "linear");

      currentSystem = nextSystem;
    }
  }
}

// --- explosionDeferred ---

/**
 * Handles explosion for deferred-style tunes (each voice in a separate
 * system). We clone the entire Tune_Body, build the bar map from the clone,
 * run the explosion, then replace the original Tune_Body with the modified
 * clone.
 *
 * The tune body to work on and the map collecting the created node IDs are both supplied by
 * the caller, because a single call to the explosion transform may have to process several
 * tunes and merge their results.
 */
function explosionDeferred(
  selection: Selection,
  tuneBody: CSNode,
  targetVoiceIds: string[],
  ctx: ABCContext,
  snapshots: DocumentSnapshots,
  outputSelections: Map<string, Set<number>>
): void {
  if (tuneBody.tag !== TAGS.Tune_Body) return;

  const sourceVoiceIds = getVoiceIdsFromSelection(selection, tuneBody, snapshots);
  if (sourceVoiceIds.size > 1) return;

  const voiceOrder = tuneBody.data.voices;

  // Clone the entire Tune_Body (preserving IDs for position data)
  const clonedTuneBody = cloneSubtree(tuneBody, () => ctx.generateId(), true);

  // Because the voice lines appended below each open on a line of their own, a body whose
  // final line carries no terminator needs one first, which is the case for every tune but
  // the last. The body's original ending is restored once the work is done, so that the
  // newline already following the tune does not become an extra blank line.
  const bodyNeededTerminator = !bodyEndsWithEol(clonedTuneBody);
  if (bodyNeededTerminator) {
    appendEolToBody(clonedTuneBody, ctx);
  }

  // Resolve the starting voice from the first token in the first System
  let firstSystem: CSNode | null = clonedTuneBody.firstChild;
  while (firstSystem !== null && firstSystem.tag !== TAGS.System) {
    firstSystem = firstSystem.nextSibling;
  }
  if (!firstSystem) return;

  const firstTok = firstTokenData(firstSystem);
  if (!firstTok) return;

  const startingVoiceId = getSnapshotAtPosition(snapshots, encode(firstTok.line, firstTok.position)).voiceId;
  const barMap = barmap.buildMap(clonedTuneBody, startingVoiceId);

  for (let ci = selection.cursors.length - 1; ci >= 0; ci--) {
    const cursor = selection.cursors[ci];
    const cursorRange = getCursorRange(cursor, selection.root);
    if (!cursorRange) continue;

    const barRange = getSourceBarRange(barMap, clonedTuneBody, cursorRange, snapshots);

    const parts = prepareParts(barMap, barRange, Array.from(sourceVoiceIds), targetVoiceIds, clonedTuneBody, ctx);

    explodeParts(parts, barMap, barRange, cursorRange, clonedTuneBody, ctx, outputSelections, voiceOrder, "deferred");
  }

  if (bodyNeededTerminator) {
    removeTrailingEolFromBody(clonedTuneBody);
  }

  // Replace the original Tune_Body with the modified clone
  replace(tuneBody, clonedTuneBody);
}

/**
 * Returns the last System child of a tune body, or null when it has none.
 */
function lastSystemOf(tuneBody: CSNode): CSNode | null {
  let lastSystem: CSNode | null = null;
  let child = tuneBody.firstChild;
  while (child !== null) {
    if (child.tag === TAGS.System) {
      lastSystem = child;
    }
    child = child.nextSibling;
  }
  return lastSystem;
}

/**
 * Returns the last child of a node, or null when it has none.
 */
function lastChildOf(node: CSNode): CSNode | null {
  let lastChild: CSNode | null = null;
  let child = node.firstChild;
  while (child !== null) {
    lastChild = child;
    child = child.nextSibling;
  }
  return lastChild;
}

/**
 * Reports whether a tune body's final line carries a terminator. In every tune but the last
 * one, the newline that ends the final line is not part of the tune body, so appending a
 * voice line would run it onto that line instead of giving it a line of its own.
 */
function bodyEndsWithEol(tuneBody: CSNode): boolean {
  const lastSystem = lastSystemOf(tuneBody);
  if (lastSystem === null) return true;
  const lastChild = lastChildOf(lastSystem);
  return lastChild !== null && isEolNode(lastChild);
}

/**
 * Appends a terminator to a tune body's final line.
 */
function appendEolToBody(tuneBody: CSNode, ctx: ABCContext): void {
  const lastSystem = lastSystemOf(tuneBody);
  if (lastSystem === null) return;
  appendChild(lastSystem, createEolNode(ctx));
}

/**
 * Removes the terminator from a tune body's final line, restoring a body that did not carry
 * one before voice lines were appended to it. Without this the newline that already follows
 * the tune outside its body would show up as an extra blank line.
 */
function removeTrailingEolFromBody(tuneBody: CSNode): void {
  const lastSystem = lastSystemOf(tuneBody);
  if (lastSystem === null) return;
  const lastChild = lastChildOf(lastSystem);
  if (lastChild !== null && isEolNode(lastChild)) {
    remove(lastChild);
  }
}

// --- explosion (entry dispatcher) ---

/**
 * Returns the cursors that address a node inside the given tune.
 *
 * Because both explosion algorithms drive their work from cursor ranges rather than from
 * line membership, a cursor belonging to another tune cannot simply fail to match. It would
 * resolve to a bar range computed against the wrong tune's bar map, so the cursors have to
 * be partitioned before either algorithm sees them.
 */
function cursorsInsideTune(cursors: Set<number>[], tune: CSNode): Set<number>[] {
  return cursors.filter((cursor) => nodeOrDescendantInSet(tune, cursor));
}

/**
 * Explodes the selection into the given target voices, splitting chords across them.
 *
 * Each tune holding a selected node is processed on its own, against its own body, and by
 * the algorithm its own style calls for: linear when all voices share a system, deferred
 * when each voice occupies its own. The style is read from the tune node rather than from
 * ctx.tuneLinear, because that field is reset once per tune while parsing and therefore ends
 * up holding only whatever the last tune left behind.
 *
 * The created node IDs of every tune are merged per target voice, so the returned selection
 * holds one cursor per target voice spanning the whole document.
 */
export function explosion(selection: Selection, targetVoiceIds: string[], ctx: ABCContext, snapshots: DocumentSnapshots): Selection {
  const selectedIds = new Set<number>();
  for (const cursor of selection.cursors) {
    for (const id of cursor) {
      selectedIds.add(id);
    }
  }

  const tunes = findTunesWithSelection(selection.root, selectedIds);
  if (tunes.length === 0) return selection;

  const outputSelections = new Map<string, Set<number>>();
  for (const id of targetVoiceIds) {
    outputSelections.set(id, new Set());
  }

  // Process the tunes from last to first, so that an insertion never shifts the position of
  // content not yet processed.
  for (let tuneIndex = tunes.length - 1; tuneIndex >= 0; tuneIndex--) {
    const tune = tunes[tuneIndex];

    const tuneBody = findBodyOfTune(tune);
    if (tuneBody === null) continue;

    const cursors = cursorsInsideTune(selection.cursors, tune);
    if (cursors.length === 0) continue;

    const tuneSelection: Selection = { root: selection.root, cursors };

    if ((tune.data as FormattingData).linear) {
      explosionLinear(tuneSelection, tuneBody, targetVoiceIds, ctx, snapshots, outputSelections);
    } else {
      explosionDeferred(tuneSelection, tuneBody, targetVoiceIds, ctx, snapshots, outputSelections);
    }
  }

  return {
    root: selection.root,
    cursors: targetVoiceIds.map((id) => outputSelections.get(id) ?? new Set()),
  };
}
