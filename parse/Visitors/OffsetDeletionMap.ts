/**
 * Offset Deletion Map
 *
 * Because the voice filter produces its text by deleting whole nodes from the original text, and never rewrites
 * what it keeps, a character offset in the filtered text can be converted to the offset of the same character in the
 * original text, and the other way around, by counting the deleted characters that come before it.
 *
 * Because these conversions do not depend on the parser, they are kept here as plain functions on a list of deletions,
 * so that they can be tested on their own.
 *
 * Every range in this module uses offsets into a text, with an exclusive end.
 */

/** A span of characters of the original text, with an exclusive end. */
export interface OffsetRange {
  start: number;
  end: number;
}

/**
 * Sorts the ranges, drops the empty ones, and joins the ones that overlap or touch.
 * Because the conversions below walk the deletions in order, they need this shape.
 */
export function mergeOffsetRanges(ranges: readonly OffsetRange[]): OffsetRange[] {
  const sorted = ranges.filter((r) => r.end > r.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: OffsetRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ start: range.start, end: range.end });
    }
  }
  return merged;
}

/**
 * Joins the ranges that are separated only by spaces or tabs on one line.
 * Because the nodes of a line hold their tokens but not always the blanks between them, deleting the nodes alone
 * would leave those blanks behind, and the blanks would keep the line alive.
 * The ranges must be merged and in order, as `mergeOffsetRanges` returns them.
 */
export function joinRangesAcrossBlanks(text: string, ranges: readonly OffsetRange[]): OffsetRange[] {
  const joined: OffsetRange[] = [];
  for (const range of ranges) {
    const last = joined[joined.length - 1];
    if (last !== undefined && /^[ \t]*$/.test(text.slice(last.end, range.start))) {
      last.end = range.end;
    } else {
      joined.push({ start: range.start, end: range.end });
    }
  }
  return joined;
}

/**
 * Removes the deletions from the text, which gives the filtered text when the deletions are the ones that the filter made.
 * The deletions must be merged, as `mergeOffsetRanges` returns them.
 */
export function applyDeletions(text: string, deletions: readonly OffsetRange[]): string {
  let result = "";
  let cursor = 0;
  for (const deletion of deletions) {
    result += text.slice(cursor, deletion.start);
    cursor = deletion.end;
  }
  return result + text.slice(cursor);
}

/** Gives the offset at which each line of the text starts. */
export function lineStartOffsets(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      starts.push(i + 1);
    }
  }
  return starts;
}

/**
 * Converts a line and a column to an offset. Because tokens count their column from the start of their line,
 * the offset of a token is the start of its line plus its column.
 */
export function lineColumnToOffset(lineStarts: readonly number[], line: number, column: number): number {
  const lineStart = lineStarts[Math.min(Math.max(line, 0), lineStarts.length - 1)];
  return lineStart + column;
}

/**
 * Converts the offset of a character of the filtered text into the offset of the same character in the original text.
 * Because a deletion that sits exactly at the offset came before the character, it counts as well.
 */
export function filteredOffsetToOriginal(offset: number, deletions: readonly OffsetRange[]): number {
  let deleted = 0;
  for (const deletion of deletions) {
    const filteredPosition = deletion.start - deleted;
    if (filteredPosition > offset) {
      break;
    }
    deleted += deletion.end - deletion.start;
  }
  return offset + deleted;
}

/**
 * Converts a range of the filtered text, such as the one that a click on a note gives, into the range of the original text.
 * Because the end is exclusive, we convert the last character and not the end itself, so that a deletion that follows the
 * range is not swallowed by it.
 */
export function filteredRangeToOriginal(start: number, end: number, deletions: readonly OffsetRange[]): OffsetRange {
  const originalStart = filteredOffsetToOriginal(start, deletions);
  if (end <= start) {
    return { start: originalStart, end: originalStart };
  }
  return { start: originalStart, end: filteredOffsetToOriginal(end - 1, deletions) + 1 };
}

/**
 * Counts how many deleted characters come before an offset of the original text, which is the distance
 * between that offset and the offset of the same position in the filtered text.
 */
function deletedBefore(offset: number, deletions: readonly OffsetRange[]): number {
  let deleted = 0;
  for (const deletion of deletions) {
    if (deletion.end > offset) {
      break;
    }
    deleted += deletion.end - deletion.start;
  }
  return deleted;
}

/** Finds the deletion that holds the character at the offset, if any. */
function deletionHolding(offset: number, deletions: readonly OffsetRange[]): OffsetRange | undefined {
  return deletions.find((deletion) => deletion.start <= offset && offset < deletion.end);
}

/**
 * Converts a range of the original text, such as an editor selection, into the range of the filtered text.
 *
 * Returns null when nothing of the range is visible in the filtered text, so that a cursor inside a hidden voice
 * highlights nothing. When the range is partly hidden, the visible part is returned.
 * A cursor that has no selection (an empty range) is visible unless it lies strictly inside a deletion,
 * because a cursor at the edge of a deletion is still next to a character that was kept.
 */
export function originalRangeToFiltered(start: number, end: number, deletions: readonly OffsetRange[]): OffsetRange | null {
  if (end <= start) {
    const holding = deletionHolding(start, deletions);
    if (holding !== undefined && holding.start < start) {
      return null;
    }
    const position = start - deletedBefore(start, deletions);
    return { start: position, end: position };
  }

  const firstHolding = deletionHolding(start, deletions);
  const firstKept = firstHolding === undefined ? start : firstHolding.end;
  const lastHolding = deletionHolding(end - 1, deletions);
  const lastKept = lastHolding === undefined ? end - 1 : lastHolding.start - 1;
  if (firstKept > lastKept) {
    return null;
  }
  return {
    start: firstKept - deletedBefore(firstKept, deletions),
    end: lastKept - deletedBefore(lastKept, deletions) + 1,
  };
}
