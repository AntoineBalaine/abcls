/**
 * Cursor positions in the text that a transform produced.
 *
 * Because the tokens of a node keep the line and the column that they had in the text that was parsed, the range of a
 * node that a transform moved or created points at the old text: after "split system at cursor", the cursor of the editor
 * went to the position that the node had before the split, or to the top of the file for a node that the transform created.
 *
 * To get the exact position in the new text, we put a sentinel character before the first token of the node and another
 * after its last token, serialize the tree once, and read where the sentinels landed. The sentinels are removed again,
 * so the positions are those of the text without them.
 */

import { ABCContext } from "abcls-parser";
import { Range } from "abcls-parser/types/types";
import { CSNode, isTokenNode, TokenData } from "../csTree/types";
import { Selection } from "../selection";
import { serializeCSTree } from "./csTreeSerializer";
import { findNodeById } from "./selectionRangeResolver";

/**
 * The sentinels are characters of the Unicode private use area, which do not occur in ABC text.
 * Cursor number i uses START_BASE + i before its node and END_BASE + i after it.
 */
const START_BASE = 0xe000;
const END_BASE = 0xf000;
/** The number of cursors that can be marked at once, which is the size of each range of sentinels. */
const MAX_MARKED_CURSORS = 0x800;

function firstLeafToken(node: CSNode): CSNode | null {
  if (isTokenNode(node)) return node;
  let child = node.firstChild;
  while (child !== null) {
    const found = firstLeafToken(child);
    if (found !== null) return found;
    child = child.nextSibling;
  }
  return null;
}

function lastLeafToken(node: CSNode): CSNode | null {
  let last: CSNode | null = null;
  let child = node.firstChild;
  while (child !== null) {
    const found = lastLeafToken(child);
    if (found !== null) last = found;
    child = child.nextSibling;
  }
  if (last !== null) return last;
  return isTokenNode(node) ? node : null;
}

/** Remembers a token whose lexeme was changed, so that it can be put back. */
interface MarkedToken {
  data: TokenData;
  lexeme: string;
}

/**
 * Puts the sentinels of one cursor on the first and the last token of its node.
 * Returns false when the node has no token, so that the cursor has no position.
 */
function markNode(node: CSNode, index: number, marked: MarkedToken[]): boolean {
  const first = firstLeafToken(node);
  const last = lastLeafToken(node);
  if (first === null || last === null || !isTokenNode(first) || !isTokenNode(last)) return false;

  // Because the first and the last token can be the same one, the sentinels are added one after the other.
  marked.push({ data: first.data, lexeme: first.data.lexeme });
  first.data.lexeme = String.fromCharCode(START_BASE + index) + first.data.lexeme;
  marked.push({ data: last.data, lexeme: last.data.lexeme });
  last.data.lexeme = last.data.lexeme + String.fromCharCode(END_BASE + index);
  return true;
}

/** Gives the first node of each cursor, which is the node that the selection resolvers take as the cursor's position. */
function cursorNodeIds(selection: Selection): number[] {
  const ids: number[] = [];
  for (const cursor of selection.cursors) {
    const [first] = [...cursor];
    if (first !== undefined) ids.push(first);
  }
  return ids;
}

/**
 * Reads the sentinels in a text. Returns the text without them, and the start and the end of each marked cursor,
 * as a line and a column of the text without the sentinels.
 */
function readSentinels(markedText: string, cursorCount: number): { text: string; ranges: Array<Partial<Range>> } {
  const ranges: Array<Partial<Range>> = Array.from({ length: cursorCount }, () => ({}));
  let text = "";
  let line = 0;
  let column = 0;
  for (const char of markedText) {
    const code = char.charCodeAt(0);
    if (code >= START_BASE && code < START_BASE + cursorCount) {
      ranges[code - START_BASE].start = { line, character: column };
    } else if (code >= END_BASE && code < END_BASE + cursorCount) {
      ranges[code - END_BASE].end = { line, character: column };
    } else {
      text += char;
      if (char === "\n") {
        line++;
        column = 0;
      } else {
        column += char.length;
      }
    }
  }
  return { text, ranges };
}

/**
 * Gives the range of each cursor of the selection in the text that the tree serializes to.
 *
 * `plainText` is that text, serialized without sentinels. When the text that comes out of the marked tree is not exactly
 * the same, or when there are more cursors than sentinels, we return null, so that the caller keeps the ranges that it
 * had: a cursor at a position that might be wrong is worse than the old behaviour.
 * A cursor whose node has no token gets no range, as in `resolveSelectionRanges`.
 */
export function resolveSelectionRangesInText(selection: Selection, ctx: ABCContext, plainText: string): Range[] | null {
  const ids = cursorNodeIds(selection);
  if (ids.length === 0) return [];
  if (ids.length > MAX_MARKED_CURSORS) return null;

  const marked: MarkedToken[] = [];
  const markedCursors: number[] = [];
  for (let index = 0; index < ids.length; index++) {
    const node = findNodeById(selection.root, ids[index]);
    if (node !== null && markNode(node, index, marked)) {
      markedCursors.push(index);
    }
  }

  let markedText: string;
  try {
    markedText = serializeCSTree(selection.root, ctx);
  } finally {
    // The sentinels were added in order, so we take them off in the opposite order.
    for (let i = marked.length - 1; i >= 0; i--) {
      marked[i].data.lexeme = marked[i].lexeme;
    }
  }

  const read = readSentinels(markedText, ids.length);
  if (read.text !== plainText) return null;

  const ranges: Range[] = [];
  for (const index of markedCursors) {
    const { start, end } = read.ranges[index];
    if (start !== undefined && end !== undefined) {
      ranges.push({ start, end });
    }
  }
  return ranges;
}
