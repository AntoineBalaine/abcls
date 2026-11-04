import { collectChildren, insertAfter, remove } from "abcls-cstree";
import { ABCContext, Comment, Directive, Expr, Info_line, Inline_field, Lyric_line, Token, TT, extractVoiceIdFromMarker } from "abcls-parser";
import { isEOL, isInlineField } from "abcls-parser/helpers";
import { Position } from "abcls-parser/types/types";
import { TAGS } from "../csTree/types";
import { Selection } from "../selection";
import { findByPos, firstTokenNode } from "../selectors/treeWalk";
import { rationalizeCursors, systemNodeToAst, toCSTreeSystem } from "./splitSystem";

type SystemAst = Array<Expr | Token>;

/**
 * Joins the system under each cursor with the system that follows it.
 *
 * This is the inverse of splitSystems: each voice line of the following system is appended to the voice line of the same
 * voice in the system under the cursor, and the voice marker that the split put in front of it is dropped.
 * Because the two halves of a split line are cut at a note, appending them gives back the text that was split.
 *
 * The cursor of the result is on the first note that was appended, which is where the two systems were joined.
 */
export function joinSystems(selection: Selection, cursors: Position[], ctx: ABCContext): Selection {
  const collectedCursors: Set<number>[] = [];
  const joinedSystemIds = new Set<number>();

  // Because a join changes the text that comes after its cursor and not the text before it, we go from the last cursor to the first.
  for (const cursor of rationalizeCursors(cursors)) {
    const result = joinSystemAtCursor(selection, cursor, ctx, joinedSystemIds);
    selection = { root: result.root, cursors: [] };
    collectedCursors.push(...result.cursors);
  }

  collectedCursors.reverse();
  return { root: selection.root, cursors: collectedCursors };
}

/**
 * Joins the system under one cursor with the next one.
 * When there is nothing to join, the tree is returned as it is, without a cursor, so that the caller does not take
 * the cursors of the selection that it passed for the result of the join.
 */
export function joinSystemAtCursor(selection: Selection, cursor: Position, ctx: ABCContext, joinedSystemIds: Set<number>): Selection {
  const unchanged: Selection = { root: selection.root, cursors: [] };
  const tuneBody = findByPos(selection.root, TAGS.Tune_Body, cursor, null, null);
  if (!tuneBody) return unchanged;

  const found = findByPos(tuneBody.node, TAGS.System, cursor, tuneBody.node, null);
  if (!found) return unchanged;

  const system = found.node;
  const next = system.nextSibling;
  // Because two cursors in the same system must not join it twice, a system that was joined already is skipped.
  if (next === null || next.tag !== TAGS.System || joinedSystemIds.has(system.id)) return unchanged;

  const joined = joinSystemAsts(systemNodeToAst(system), systemNodeToAst(next));
  const joinedNode = toCSTreeSystem(joined.merged, ctx);

  insertAfter(system, joinedNode);
  remove(system);
  remove(next);
  joinedSystemIds.add(joinedNode.id);

  const children = collectChildren(joinedNode);
  const joinPoint = joined.joinIndex === null ? undefined : children[joined.joinIndex];
  const firstToken = joinPoint ? firstTokenNode(joinPoint) : null;
  return { root: selection.root, cursors: firstToken ? [new Set([firstToken.id])] : [] };
}

/** Splits the elements of a system into lines. Every line keeps its end-of-line token, except the last one when it has none. */
function splitIntoLines(system: SystemAst): SystemAst[] {
  const lines: SystemAst[] = [];
  let current: SystemAst = [];
  for (const element of system) {
    current.push(element);
    if (isEOL(element)) {
      lines.push(current);
      current = [];
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

function isBlankToken(element: Expr | Token): boolean {
  return element instanceof Token && (element.type === TT.WS || element.type === TT.EOL);
}

/** Gives the index of the first element that is not blank, or -1. */
function firstContentIndex(line: SystemAst): number {
  return line.findIndex((element) => !isBlankToken(element));
}

/**
 * Tells whether a line holds the music of a voice. The lines that hold an info line, a directive, a comment, a line of lyrics,
 * or nothing at all (such as `P:` or `%%text`) belong to the score and not to a voice.
 */
function isVoiceLine(line: SystemAst): boolean {
  const index = firstContentIndex(line);
  if (index === -1) return false;
  const first = line[index];
  return !(first instanceof Info_line || first instanceof Directive || first instanceof Comment || first instanceof Lyric_line);
}

/** Gives the voice id that a line starts with, or null when it does not start with a voice marker. */
function voiceIdOfLine(line: SystemAst): string | null {
  const index = firstContentIndex(line);
  if (index === -1) return null;
  const first = line[index];
  return isInlineField(first) ? extractVoiceIdFromMarker(first as Inline_field) : null;
}

/** Gives the line without its voice marker and the blanks that follow it, and without its end-of-line token. */
function contentWithoutMarker(line: SystemAst): { content: SystemAst; eol: Token | null } {
  const last = line[line.length - 1];
  const eol = last !== undefined && isEOL(last) ? last : null;
  const body = eol === null ? [...line] : line.slice(0, -1);

  const start = firstContentIndex(body);
  if (start !== -1 && isInlineField(body[start]) && voiceIdOfLine(line) !== null) {
    let end = start + 1;
    while (end < body.length && isBlankToken(body[end])) end++;
    return { content: body.slice(end), eol };
  }
  return { content: body, eol };
}

/** Gives the line without its end-of-line token. */
function contentWithoutEol(line: SystemAst): { content: SystemAst; eol: Token | null } {
  const last = line[line.length - 1];
  if (last !== undefined && isEOL(last)) return { content: line.slice(0, -1), eol: last };
  return { content: [...line], eol: null };
}

/**
 * Finds the voice line of the second system that goes with a voice line of the first one: the first one that has not
 * been used yet and has the same voice id. A line without a voice marker goes with any line, because the voice is then
 * given by its place.
 */
function findMatch(voiceId: string | null, secondLines: SystemAst[], used: Set<number>): number {
  for (let i = 0; i < secondLines.length; i++) {
    if (used.has(i) || !isVoiceLine(secondLines[i])) continue;
    const otherId = voiceIdOfLine(secondLines[i]);
    if (voiceId === null || otherId === null || voiceId === otherId) return i;
  }
  return -1;
}

/**
 * Joins two systems, given as lists of elements.
 *
 * Returns the elements of the joined system, and the index of the first element that came from the second system
 * on the first voice line that was joined, which is where the cursor goes. The index is null when no line was joined.
 */
export function joinSystemAsts(first: SystemAst, second: SystemAst): { merged: SystemAst; joinIndex: number | null } {
  const firstLines = splitIntoLines(first);
  const secondLines = splitIntoLines(second);
  const used = new Set<number>();

  const merged: SystemAst = [];
  let joinIndex: number | null = null;

  for (const line of firstLines) {
    const match = isVoiceLine(line) ? findMatch(voiceIdOfLine(line), secondLines, used) : -1;
    if (match === -1) {
      merged.push(...line);
      continue;
    }

    used.add(match);
    const head = contentWithoutEol(line);
    const tail = contentWithoutMarker(secondLines[match]);
    merged.push(...head.content);
    if (joinIndex === null) joinIndex = merged.length;
    merged.push(...tail.content);
    const eol = tail.eol ?? head.eol;
    if (eol !== null) merged.push(eol);
  }

  // The lines of the second system that were not joined (other voices, and lines such as P: or %%text) follow in their order.
  for (let i = 0; i < secondLines.length; i++) {
    if (!used.has(i)) merged.push(...secondLines[i]);
  }

  return { merged, joinIndex };
}
