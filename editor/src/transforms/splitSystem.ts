import { collectChildren, appendChild, remove, insertAfter } from "abcls-cstree";
import { Token, TT, Expr, Inline_field, ABCContext, System } from "abcls-parser";
import { isEOL, isInlineField } from "abcls-parser/helpers";
import { DocumentSnapshots, getSnapshotAtPosition, encode } from "abcls-parser/interpreter/ContextInterpreter";
import { Position, Range } from "abcls-parser/types/types";
import { mapTimePoints, isTimeEvent } from "abcls-parser/Visitors/fmt/fmt_timeMap";
import { VoiceSplit, BarAlignment, Location, findFmtblLines, getNodeId } from "abcls-parser/Visitors/fmt/fmt_timeMapHelpers";
import { IRational, parseRational, rationalToString } from "abcls-parser/Visitors/fmt/rational";
import { RangeVisitor } from "abcls-parser/Visitors/RangeVisitor";
import { fromAst } from "../csTree/fromAst";
import { toAst } from "../csTree/toAst";
import { createCSNode, CSNode, TAGS } from "../csTree/types";
import { Selection } from "../selection";
import { findByPos, firstTokenNode, comparePositions } from "../selectors/treeWalk";

type SystemAst = Array<Expr | Token>;

interface CursorLocation {
  voiceLineStartIdx: number;
  splitIdx: number;
  nodeAtCursor: Expr | Token | null;
  position: Position;
}

interface TimeMapData {
  voiceSplits: VoiceSplit[];
  barAlignments: BarAlignment[];
  splitBarIdx: number | null;
  splitTime: IRational | null;
  splitVoiceIdx: number | null;
}

export interface SplitMetadata {
  syntheticEOLCount: number;
  addedVoiceMarkerCount: number;
}

interface VoiceLineRange {
  start: number;
  end: number;
}

interface VoiceLineBoundary {
  range: VoiceLineRange;
  voiceIdx: number;
}

// Maximum integer value for "split after all content" positions
const MAX_INT = Number.MAX_SAFE_INTEGER;

// Helper: check if cursor is within a range
function cursorIsInRange(cursor: Position, range: Range | null): boolean {
  if (!range) return false;
  const afterStart = comparePositions(cursor.line, cursor.character, range.start.line, range.start.character) >= 0;
  const beforeEnd = comparePositions(cursor.line, cursor.character, range.end.line, range.end.character) < 0;
  return afterStart && beforeEnd;
}

// Helper: check if cursor is before a position
function cursorIsBefore(cursor: Position, pos: Position): boolean {
  return comparePositions(cursor.line, cursor.character, pos.line, pos.character) < 0;
}

// Rationalize cursors: sort descending by position, deduplicate
export function rationalizeCursors(cursors: Position[]): Position[] {
  const sorted = [...cursors].sort((a, b) => {
    if (a.line !== b.line) return b.line - a.line;
    return b.character - a.character;
  });

  const deduplicated: Position[] = [];
  for (const cursor of sorted) {
    if (deduplicated.length === 0) {
      deduplicated.push(cursor);
    } else {
      const last = deduplicated[deduplicated.length - 1];
      if (cursor.line !== last.line || cursor.character !== last.character) {
        deduplicated.push(cursor);
      }
    }
  }
  return deduplicated;
}

// Convert System CSNode to AST array
export function systemNodeToAst(systemNode: CSNode): SystemAst {
  const children = collectChildren(systemNode);
  return children.map((child) => toAst(child) as Expr | Token);
}

// Find cursor location in the AST system
function findCursorLocation(systemAst: SystemAst, cursorPosition: Position, rangeVisitor: RangeVisitor): CursorLocation {
  let currentVoiceLineStart = 0;

  for (let i = 0; i < systemAst.length; i++) {
    const node = systemAst[i];
    const nodeRange = node.accept(rangeVisitor);

    if (cursorIsInRange(cursorPosition, nodeRange)) {
      return {
        voiceLineStartIdx: currentVoiceLineStart,
        splitIdx: i,
        nodeAtCursor: node,
        position: cursorPosition,
      };
    }

    if (nodeRange && cursorIsBefore(cursorPosition, nodeRange.start)) {
      return {
        voiceLineStartIdx: currentVoiceLineStart,
        splitIdx: i,
        nodeAtCursor: null,
        position: cursorPosition,
      };
    }

    if (isEOL(node)) {
      currentVoiceLineStart = i + 1;
    }
  }

  return {
    voiceLineStartIdx: currentVoiceLineStart,
    splitIdx: systemAst.length,
    nodeAtCursor: null,
    position: cursorPosition,
  };
}

// Build time map and find split time
function buildTimeMapAndFindSplitTime(systemAst: SystemAst, cursorLocation: CursorLocation): TimeMapData {
  const voiceSplits = findFmtblLines(systemAst as System);
  const barAlignments = mapTimePoints(voiceSplits);

  for (let i = cursorLocation.splitIdx; i < systemAst.length; i++) {
    const node = systemAst[i];
    if (isTimeEvent(node)) {
      const nodeId = getNodeId(node);
      for (let barIdx = 0; barIdx < barAlignments.length; barIdx++) {
        const barAlignment = barAlignments[barIdx];
        for (const [timeKey, locations] of barAlignment.map) {
          for (const loc of locations) {
            if (loc.nodeID === nodeId) {
              return {
                voiceSplits,
                barAlignments,
                splitBarIdx: barIdx,
                splitTime: parseRational(timeKey),
                splitVoiceIdx: loc.voiceIdx,
              };
            }
          }
        }
      }
    }
  }

  return {
    voiceSplits,
    barAlignments,
    splitBarIdx: null,
    splitTime: null,
    splitVoiceIdx: null,
  };
}

// Find voice line boundaries in the system AST
// The range excludes the EOL token itself to avoid duplication when appendEOL adds a synthetic one.
function findVoiceLineBoundaries(systemAst: SystemAst): VoiceLineBoundary[] {
  const boundaries: VoiceLineBoundary[] = [];
  let currentStart = 0;
  let currentVoiceIdx = 0;

  for (let i = 0; i < systemAst.length; i++) {
    const node = systemAst[i];
    if (isEOL(node)) {
      // Exclude the EOL token from the range (end is i - 1, not i)
      if (i > currentStart) {
        boundaries.push({
          range: { start: currentStart, end: i - 1 },
          voiceIdx: currentVoiceIdx,
        });
      }
      currentStart = i + 1;
      currentVoiceIdx++;
    }
  }

  if (currentStart < systemAst.length) {
    boundaries.push({
      range: { start: currentStart, end: systemAst.length - 1 },
      voiceIdx: currentVoiceIdx,
    });
  }

  return boundaries;
}

// Lookup location at a given time for a voice
function timeToLocation(barAlignments: BarAlignment[], barIdx: number | null, time: IRational | null, voiceIdx: number): Location | null {
  if (barIdx === null || time === null) return null;

  const barAlignment = barAlignments[barIdx];
  if (!barAlignment) return null;

  const timeKey = rationalToString(time);
  const locations = barAlignment.map.get(timeKey);
  if (!locations) return null;

  for (const loc of locations) {
    if (loc.voiceIdx === voiceIdx) {
      return loc;
    }
  }

  return null;
}

// Get node position from AST node
function getAstNodePos(node: Expr | Token, rangeVisitor: RangeVisitor): Position | null {
  const range = node.accept(rangeVisitor);
  if (!range || range.start.line === Infinity) return null;
  return { line: range.start.line, character: range.start.character };
}

// Split voice line by position
function splitVoiceLineByPosition(
  systemAst: SystemAst,
  voiceLineRange: VoiceLineRange,
  splitCharPos: Position,
  rangeVisitor: RangeVisitor
): { before: SystemAst; after: SystemAst } {
  const before: SystemAst = [];
  const after: SystemAst = [];

  for (let i = voiceLineRange.start; i <= voiceLineRange.end; i++) {
    const node = systemAst[i];
    const nodePos = getAstNodePos(node, rangeVisitor);

    if (!nodePos) {
      before.push(node);
    } else if (comparePositions(nodePos.line, nodePos.character, splitCharPos.line, splitCharPos.character) < 0) {
      before.push(node);
    } else {
      after.push(node);
    }
  }

  return { before, after };
}

// Append content with synthetic EOL
export function appendEOL(system: SystemAst, voiceLineContent: SystemAst, ctx: ABCContext): void {
  if (voiceLineContent.length === 0) return;

  for (const node of voiceLineContent) {
    system.push(node);
  }

  system.push(new Token(TT.EOL, "\n", ctx.generateId()));
}

// Check if voice line starts with a voice marker
function startsWithVoiceMarker(voiceLine: SystemAst): boolean {
  if (voiceLine.length === 0) return false;
  const first = voiceLine[0];
  return isInlineField(first) && first.field.lexeme === "V:";
}

// Prepend voice marker to voice line
// The Inline_field class expects text[0] to be the field token per Formatter2 convention
// We use TT.INLN_FLD_LFT_BRKT/TT.INLN_FLD_RGT_BRKT so that toAst.ts buildInlineField
// correctly recognizes them as bracket tokens (not as text content).
export function prependVoiceMarker(voiceLine: SystemAst, voiceId: string, ctx: ABCContext): void {
  const fieldToken = new Token(TT.INF_HDR, "V:", ctx.generateId());
  const textToken = new Token(TT.INFO_STR, voiceId, ctx.generateId());
  const leftBracket = new Token(TT.INLN_FLD_LFT_BRKT, "[", ctx.generateId());
  const rightBracket = new Token(TT.INLN_FLD_RGT_BRKT, "]", ctx.generateId());
  const marker = new Inline_field(ctx.generateId(), fieldToken, [fieldToken, textToken], undefined, leftBracket, rightBracket);
  voiceLine.unshift(marker);
}

// Split the system AST into two halves
function splitSystemAst(
  systemAst: SystemAst,
  cursorLocation: CursorLocation,
  timeMapData: TimeMapData,
  snapshots: DocumentSnapshots,
  ctx: ABCContext,
  rangeVisitor: RangeVisitor
): { before: SystemAst; after: SystemAst; metadata: SplitMetadata } {
  const { barAlignments, splitBarIdx, splitTime, splitVoiceIdx } = timeMapData;
  const cursorPosition = cursorLocation.position;

  const voiceLineBoundaries = findVoiceLineBoundaries(systemAst);

  const systemBefore: SystemAst = [];
  const systemAfter: SystemAst = [];
  let syntheticEOLCount = 0;
  let addedVoiceMarkerCount = 0;

  for (const boundary of voiceLineBoundaries) {
    const voiceIdx = boundary.voiceIdx;

    // Get voice ID from snapshot
    const voiceLineStartNode = systemAst[boundary.range.start];
    const voiceLineStartPos = getAstNodePos(voiceLineStartNode, rangeVisitor);
    let voiceIdForLine = "";
    if (voiceLineStartPos) {
      const encodedPos = encode(voiceLineStartPos.line, voiceLineStartPos.character);
      const snapshot = getSnapshotAtPosition(snapshots, encodedPos);
      voiceIdForLine = snapshot?.voiceId || "";
    }

    // Determine split position for this voice line
    let splitCharPos: Position;
    if (voiceIdx === splitVoiceIdx) {
      splitCharPos = cursorPosition;
    } else {
      const locationAtTime = timeToLocation(barAlignments, splitBarIdx, splitTime, voiceIdx);
      if (locationAtTime) {
        splitCharPos = { line: locationAtTime.line, character: locationAtTime.character };
      } else {
        splitCharPos = { line: MAX_INT, character: MAX_INT };
      }
    }

    // Split voice line content
    const splitResult = splitVoiceLineByPosition(systemAst, boundary.range, splitCharPos, rangeVisitor);
    const voiceLineBefore = splitResult.before;
    const voiceLineAfter = splitResult.after;

    // Append to systemBefore with synthetic EOL
    if (voiceLineBefore.length > 0) {
      appendEOL(systemBefore, voiceLineBefore, ctx);
      syntheticEOLCount++;
    }

    // Prepend voice marker to systemAfter if needed
    if (voiceLineAfter.length > 0 && !startsWithVoiceMarker(voiceLineAfter) && voiceIdForLine !== "") {
      prependVoiceMarker(voiceLineAfter, voiceIdForLine, ctx);
      addedVoiceMarkerCount++;
    }

    // Append to systemAfter with synthetic EOL (same as systemBefore)
    if (voiceLineAfter.length > 0) {
      appendEOL(systemAfter, voiceLineAfter, ctx);
      syntheticEOLCount++;
    }
  }

  return {
    before: systemBefore,
    after: systemAfter,
    metadata: { syntheticEOLCount, addedVoiceMarkerCount },
  };
}

// Convert AST array to CSTree System node
export function toCSTreeSystem(systemArray: SystemAst, ctx: ABCContext): CSNode {
  const systemNode = createCSNode(TAGS.System, ctx.generateId(), null);

  for (const element of systemArray) {
    const childNode = fromAst(element, ctx);
    appendChild(systemNode, childNode);
  }

  return systemNode;
}

// Update CSTree with split systems
function updateCSTree(
  selection: Selection,
  originalSystemNode: CSNode,
  tuneBody: CSNode,
  prevSibling: CSNode | null,
  systemBeforeAst: SystemAst,
  systemAfterAst: SystemAst,
  metadata: SplitMetadata,
  ctx: ABCContext
): { selection: Selection; cursorNodeId: number | null; metadata: SplitMetadata } {
  const systemBeforeCS = toCSTreeSystem(systemBeforeAst, ctx);
  const systemAfterCS = toCSTreeSystem(systemAfterAst, ctx);

  // Replace the original system with the two new systems.
  // Because systemBeforeCS and systemAfterCS are freshly created (parentRef === null),
  // we can use insertAfter/remove to replace originalSystemNode.
  if (originalSystemNode.parentRef) {
    // Insert the two new systems after the original, then remove the original
    insertAfter(originalSystemNode, systemBeforeCS);
    insertAfter(systemBeforeCS, systemAfterCS);
    remove(originalSystemNode);
  }

  const firstNode = firstTokenNode(systemAfterCS);
  const cursorNodeId = firstNode ? firstNode.id : null;

  return { selection, cursorNodeId, metadata };
}

// Single-cursor transform
export function splitSystem(selection: Selection, cursorPosition: Position, ctx: ABCContext, snapshots: DocumentSnapshots): Selection {
  // Find Tune_Body node
  const tuneBodyResult = findByPos(selection.root, TAGS.Tune_Body, cursorPosition, null, null);
  if (!tuneBodyResult) {
    return selection;
  }
  const tuneBody = tuneBodyResult.node;

  // Find System node
  const systemResult = findByPos(tuneBody, TAGS.System, cursorPosition, tuneBody, null);
  if (!systemResult) {
    return selection;
  }
  const systemNode = systemResult.node;
  const prevSibling = systemResult.prevSibling;

  // Convert System to AST array
  const systemAst = systemNodeToAst(systemNode);

  const rangeVisitor = new RangeVisitor();

  // Find cursor location
  const cursorLocation = findCursorLocation(systemAst, cursorPosition, rangeVisitor);

  // Build time map and find split time
  const timeMapData = buildTimeMapAndFindSplitTime(systemAst, cursorLocation);
  if (timeMapData.splitBarIdx === null) {
    return selection;
  }

  // Split the system
  const splitResult = splitSystemAst(systemAst, cursorLocation, timeMapData, snapshots, ctx, rangeVisitor);

  // Update CSTree
  const result = updateCSTree(selection, systemNode, tuneBody, prevSibling, splitResult.before, splitResult.after, splitResult.metadata, ctx);

  // Build new cursors from the cursorNodeId
  const newCursors: Set<number>[] = [];
  if (result.cursorNodeId !== null) {
    newCursors.push(new Set([result.cursorNodeId]));
  }

  return { root: result.selection.root, cursors: newCursors };
}

// Multi-cursor transform
export function splitSystems(selection: Selection, cursors: Position[], ctx: ABCContext, snapshots: DocumentSnapshots): Selection {
  const rationalizedCursors = rationalizeCursors(cursors);
  const collectedCursors: Set<number>[] = [];

  for (const cursor of rationalizedCursors) {
    const result = splitSystem(selection, cursor, ctx, snapshots);
    // Carry forward the modified root
    selection = { root: result.root, cursors: [] };
    collectedCursors.push(...result.cursors);
  }

  collectedCursors.reverse();
  return { root: selection.root, cursors: collectedCursors };
}
