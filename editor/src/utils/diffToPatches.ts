/**
 * Character-level diff algorithm for editor patch generation
 *
 * Uses LCS (Longest Common Subsequence) to find character differences
 * and converts them to line:column positions for patch expressions.
 * The LCS tables are bounded in size, so that a large score cannot exhaust the memory of the process.
 */

/**
 * Position in a document (1-based line and column)
 */
export interface Position {
  line: number;
  column: number;
}

/**
 * A single change between original and modified text
 */
export interface Change {
  /** Type of change */
  type: "insert" | "delete" | "replace";
  /** Start position in original (1-based). For insert, this is position after which to insert */
  originalStart: Position;
  /** End position in original (1-based, inclusive). For insert, same as start */
  originalEnd: Position;
  /** New content for insert/replace, empty string for delete */
  newContent: string;
}

/**
 * The largest number of cells that the table of a longest common subsequence may have.
 *
 * Because the table of two texts of m and n elements has (m+1)*(n+1) cells, the table of two scores of
 * 34,000 characters would hold more than a billion cells, and the process that computes it runs out of memory and dies.
 * With 4 million cells and 4 bytes per cell, the table takes at most 16 MB.
 */
const MAX_TABLE_CELLS = 4_000_000;

/**
 * Gives the position (1-based line and column) of each offset of a text, with a table of the offsets where its lines start.
 * Because a text can have thousands of changes, we search the table instead of counting the lines again for each offset.
 */
function createPositionLookup(text: string): (offset: number) => Position {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      lineStarts.push(i + 1);
    }
  }
  return (offset: number): Position => {
    const clamped = Math.min(Math.max(offset, 0), text.length);
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (lineStarts[middle] <= clamped) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return { line: low + 1, column: clamped - lineStarts[low] + 1 };
  };
}

/**
 * Computes the longest common subsequence of two sequences, and returns the pairs (index in a, index in b) of the matching elements.
 * Returns null when the table that it needs would exceed MAX_TABLE_CELLS, so that the caller can use a coarser way.
 */
function computeLCS<T>(a: ArrayLike<T>, b: ArrayLike<T>): Array<[number, number]> | null {
  const m = a.length;
  const n = b.length;
  if ((m + 1) * (n + 1) > MAX_TABLE_CELLS) {
    return null;
  }

  // The table is one flat array of 32-bit numbers, which takes much less memory than an array of arrays.
  const width = n + 1;
  const table = new Uint32Array((m + 1) * width);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        table[i * width + j] = table[(i - 1) * width + (j - 1)] + 1;
      } else {
        table[i * width + j] = Math.max(table[(i - 1) * width + j], table[i * width + (j - 1)]);
      }
    }
  }

  // Backtrack to find the matching pairs. Because we walk from the end, we collect them in reverse, then turn them around.
  const pairs: Array<[number, number]> = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      pairs.push([i - 1, j - 1]);
      i--;
      j--;
    } else if (table[(i - 1) * width + j] > table[i * width + (j - 1)]) {
      i--;
    } else {
      j--;
    }
  }
  return pairs.reverse();
}

/** Counts how many elements two strings share at their start. */
function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let length = 0;
  while (length < limit && a[length] === b[length]) length++;
  return length;
}

/** Counts how many elements two strings share at their end, without going into the first `skip` elements. */
function commonSuffixLength(a: string, b: string, skip: number): number {
  const limit = Math.min(a.length, b.length) - skip;
  let length = 0;
  while (length < limit && a[a.length - 1 - length] === b[b.length - 1 - length]) length++;
  return length;
}

/** Splits a text into lines that keep their newline, so that the lines put back together give the text. */
function splitKeepingNewlines(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      lines.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) {
    lines.push(text.slice(start));
  }
  return lines;
}

/**
 * Finds the matching characters of two texts, as pairs (index in a, index in b), for texts that are too large for one table.
 *
 * Because a score is made of lines, and a transform changes some notes inside some lines, we first match whole lines,
 * which needs a table of lines instead of a table of characters. We then match the characters of each pair of changed
 * regions between the matched lines. When a table is still too large, that region is left without matches,
 * which makes the caller replace it as a whole: the edit is coarser, but it is still correct, and nothing runs out of memory.
 */
function matchLargeTexts(a: string, b: string): Array<[number, number]> {
  const linesA = splitKeepingNewlines(a);
  const linesB = splitKeepingNewlines(b);
  const linePairs = computeLCS(linesA, linesB);
  if (linePairs === null) {
    return [];
  }

  // The offset at which each line starts, so that a line index gives a character offset.
  const startsA = [0];
  for (const line of linesA) startsA.push(startsA[startsA.length - 1] + line.length);
  const startsB = [0];
  for (const line of linesB) startsB.push(startsB[startsB.length - 1] + line.length);

  const pairs: Array<[number, number]> = [];
  let previousA = 0;
  let previousB = 0;
  // A last pair past the end closes the final region.
  const closedLinePairs: Array<[number, number]> = [...linePairs, [linesA.length, linesB.length]];
  for (const [lineA, lineB] of closedLinePairs) {
    // The region between the previous matched lines and this one
    const regionA = a.slice(startsA[previousA], startsA[lineA]);
    const regionB = b.slice(startsB[previousB], startsB[lineB]);
    for (const [i, j] of matchRegion(regionA, regionB)) {
      pairs.push([startsA[previousA] + i, startsB[previousB] + j]);
    }
    if (lineA < linesA.length) {
      // The matched line is equal in both texts, so each of its characters matches.
      for (let k = 0; k < linesA[lineA].length; k++) {
        pairs.push([startsA[lineA] + k, startsB[lineB] + k]);
      }
    }
    previousA = lineA + 1;
    previousB = lineB + 1;
  }
  return pairs;
}

/**
 * Finds the matching characters of two regions that lie between matched lines.
 * Returns no pair when the regions are too large for a table.
 */
function matchRegion(a: string, b: string): Array<[number, number]> {
  if (a.length === 0 || b.length === 0) {
    return [];
  }
  const prefix = commonPrefixLength(a, b);
  const suffix = commonSuffixLength(a, b, prefix);
  const pairs: Array<[number, number]> = [];
  for (let k = 0; k < prefix; k++) pairs.push([k, k]);
  const middle = computeLCS(a.slice(prefix, a.length - suffix), b.slice(prefix, b.length - suffix));
  for (const [i, j] of middle ?? []) pairs.push([prefix + i, prefix + j]);
  for (let k = suffix; k > 0; k--) pairs.push([a.length - k, b.length - k]);
  return pairs;
}

/**
 * Finds the matching characters of two texts, as pairs (index in original, index in modified), in order.
 *
 * Because most edits are local, the characters that the texts share at their start and at their end are matched
 * first, without a table. The middle is matched with one table when it is small enough, and line by line otherwise.
 */
function matchCharacters(original: string, modified: string): Array<[number, number]> {
  const prefix = commonPrefixLength(original, modified);
  const suffix = commonSuffixLength(original, modified, prefix);
  const middleOriginal = original.slice(prefix, original.length - suffix);
  const middleModified = modified.slice(prefix, modified.length - suffix);

  const pairs: Array<[number, number]> = [];
  for (let k = 0; k < prefix; k++) pairs.push([k, k]);
  const middle = computeLCS(middleOriginal, middleModified) ?? matchLargeTexts(middleOriginal, middleModified);
  for (const [i, j] of middle) pairs.push([prefix + i, prefix + j]);
  for (let k = suffix; k > 0; k--) pairs.push([original.length - k, modified.length - k]);
  return pairs;
}

/**
 * Compute character-level diff between original and modified text
 *
 * Because it never builds a table larger than MAX_TABLE_CELLS, it does not run out of memory on a large score.
 * The changes that it returns are always correct, but they are minimal only when the texts are small enough for one table.
 *
 * @param original - The original text
 * @param modified - The modified text
 * @returns Array of changes, sorted by position (ascending)
 */
export function diffChars(original: string, modified: string): Change[] {
  // Handle edge cases
  if (original === modified) {
    return [];
  }

  const positionIn = createPositionLookup(original);

  if (original.length === 0) {
    // All content is an insert at position 1:1
    return [
      {
        type: "insert",
        originalStart: { line: 1, column: 1 },
        originalEnd: { line: 1, column: 1 },
        newContent: modified,
      },
    ];
  }

  if (modified.length === 0) {
    // All content is a delete from 1:1 to end
    // Use original.length - 1 to get position of last character (inclusive end)
    const endPos = positionIn(original.length - 1);
    return [
      {
        type: "delete",
        originalStart: { line: 1, column: 1 },
        originalEnd: endPos,
        newContent: "",
      },
    ];
  }

  const pairs = matchCharacters(original, modified);

  // Build the change list from the characters that sit between two matches
  const changes: Change[] = [];
  let origIdx = 0;
  let modIdx = 0;

  // A last pair past the end closes the final region.
  const closedPairs: Array<[number, number]> = [...pairs, [original.length, modified.length]];
  for (const [nextOrigMatch, nextModMatch] of closedPairs) {
    // Characters before next match are changes
    const origDeleted = original.substring(origIdx, nextOrigMatch);
    const modInserted = modified.substring(modIdx, nextModMatch);

    if (origDeleted.length > 0 || modInserted.length > 0) {
      const startPos = positionIn(origIdx);

      if (origDeleted.length > 0 && modInserted.length > 0) {
        // Replace: endOffset is index of last character being replaced (inclusive)
        const endOffset = origIdx + origDeleted.length - 1;
        changes.push({
          type: "replace",
          originalStart: startPos,
          originalEnd: positionIn(endOffset),
          newContent: modInserted,
        });
      } else if (origDeleted.length > 0) {
        // Delete only
        const endOffset = origIdx + origDeleted.length - 1;
        changes.push({
          type: "delete",
          originalStart: startPos,
          originalEnd: positionIn(endOffset),
          newContent: "",
        });
      } else {
        // Insert only
        // Insert happens at the position in the original where we're currently at
        changes.push({
          type: "insert",
          originalStart: startPos,
          originalEnd: startPos,
          newContent: modInserted,
        });
      }
    }

    // Move past the matched character
    origIdx = nextOrigMatch + 1;
    modIdx = nextModMatch + 1;
  }

  return changes;
}

/**
 * Generate patch expressions from changes
 *
 * @param changes - Array of changes from diffChars
 * @param sourceExpr - The source expression to use in patches (e.g., variable name)
 * @returns Array of patch expression strings
 */
export function generatePatches(changes: Change[], sourceExpr: string): string[] {
  // Sort changes by position descending (so later patches don't shift earlier positions)
  const sortedChanges = [...changes].sort((a, b) => {
    if (a.originalStart.line !== b.originalStart.line) {
      return b.originalStart.line - a.originalStart.line;
    }
    return b.originalStart.column - a.originalStart.column;
  });

  return sortedChanges.map((change) => {
    const start = change.originalStart;
    const end = change.originalEnd;

    let selector: string;
    if (start.line === end.line) {
      // Single-line selector
      if (start.column === end.column && change.type === "insert") {
        // Insert at a point
        selector = `:${start.line}:${start.column}`;
      } else {
        selector = `:${start.line}:${start.column}-${end.column}`;
      }
    } else {
      // Multi-line selector
      selector = `:${start.line}:${start.column}-${end.line}:${end.column}`;
    }

    // Escape content for ABC literal (escape triple backticks)
    const escapedContent = sanitizeAbcContent(change.newContent);

    return `${sourceExpr} | ${selector} |= \`\`\`abc\n${escapedContent}\n\`\`\``;
  });
}

/**
 * Sanitize ABC content for embedding in a triple-backtick fence
 * Escapes triple backticks to avoid premature fence closure
 */
function sanitizeAbcContent(content: string): string {
  return content.replace(/```/g, "\\`\\`\\`");
}
