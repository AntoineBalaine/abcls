import { parsePlaylistLink, stripChordDataMarker, IrealSongFields } from "./fields";
import { unscramble } from "./scramble";
import { GridToken, textToGridTokens } from "./gridNotation";
import { parsedChordToAbcxText } from "./chordShorthand";

/**
 * Builds ABCx source text directly for one song, rather than constructing
 * a synthetic AST and reusing the existing Formatter. ABCx's output shape
 * for a chord chart (a handful of header lines, then a chord/bar body
 * line) is simple enough that a direct text writer is lower risk than
 * verifying the Formatter's full-ABC-oriented assumptions (multi-voice
 * alignment, line wrapping) do not interfere with this much simpler case;
 * see the implementation report for the reasoning behind this deviation
 * from the plan's tentative Formatter-reuse idea.
 */

// One cell's ABCx text, or `null` for a "repeat previous bar" cell (iReal
// Pro's "x" grid token) whose text is resolved in a second pass once the
// preceding bars are known.
function cellText(t: GridToken): string {
  if (t.type === "noChord") return "N.C.";
  if (t.type === "chord") return parsedChordToAbcxText(t.chord);
  throw new Error(`cellText: unexpected token type "${t.type}"`);
}

/**
 * Splits a flat grid-token stream into bars, dropping the "bar" separator
 * tokens themselves (their position is implicit in the array boundaries).
 */
function splitIntoBars(tokens: GridToken[]): GridToken[][] {
  const bars: GridToken[][] = [[]];
  for (const t of tokens) {
    if (t.type === "bar") {
      bars.push([]);
    } else {
      bars[bars.length - 1].push(t);
    }
  }
  return bars;
}

function isRepeatBar(bar: GridToken[]): boolean {
  return bar.length === 1 && bar[0].type === "repeatBar";
}

/**
 * Renders one song's grid tokens as an ABCx tune-body line.
 *
 * iReal Pro's "x" grid cell means "repeat the previous bar" and, in the
 * generated ABCx text, used to be written as a bare "%" character. Since
 * ABCx (like ABC) treats "%" as the start of a comment, that silently
 * truncated any real-world chart using repeat bars: everything after the
 * "%" became a comment instead of chord data. Per the ABC 2.2 standard,
 * there is no per-bar "repeat previous measure" notation, but there is a
 * standard repeated-section barline pair, `|:` ... `:|` ("play what's
 * between these bars twice"), which is semantically equivalent for a
 * single repeated bar and, unlike "%", is real, already-supported ABC
 * barline syntax rather than a comment-colliding placeholder. So a bar
 * followed by exactly one "repeat previous bar" cell is rewritten as
 * `|: <bar> :|`, and the repeat cell itself contributes no separate
 * content (its meaning is now carried by the closing `:|`).
 *
 * A chain of two or more consecutive repeat cells (rare; "repeat this
 * bar N times" for N > 2) has no single standard-ABC construct, so each
 * repeat beyond the first is rendered as its own separate `|: <bar> :|`
 * pair reusing the same source bar text; this plays the source bar an
 * extra two times per pair rather than exactly once, a known, documented
 * simplification of this converter's reduced grid grammar (see the
 * module doc comment in gridNotation.ts) rather than a claim of exact
 * repeat-count fidelity.
 */
function gridTokensToAbcxBody(tokens: GridToken[]): string {
  const bars = splitIntoBars(tokens);
  const isRepeat = bars.map(isRepeatBar);

  // Resolve each repeat bar's text to the nearest preceding non-repeat
  // bar's text.
  const resolvedText: string[] = [];
  let lastSourceText = "";
  for (let i = 0; i < bars.length; i++) {
    if (isRepeat[i]) {
      resolvedText.push(lastSourceText);
    } else {
      const text = bars[i].map(cellText).join(" ");
      resolvedText.push(text);
      lastSourceText = text;
    }
  }

  const consumed = new Array<boolean>(bars.length).fill(false);
  const emitted: string[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (consumed[i]) continue;
    if (!isRepeat[i] && i + 1 < bars.length && isRepeat[i + 1]) {
      emitted.push(`|: ${resolvedText[i]} :|`);
      consumed[i + 1] = true;
      let j = i + 2;
      while (j < bars.length && isRepeat[j]) {
        emitted.push(`|: ${resolvedText[i]} :|`);
        consumed[j] = true;
        j++;
      }
    } else {
      emitted.push(resolvedText[i]);
    }
  }

  // iReal Pro charts are conventionally laid out four bars to a line; the
  // ABC output mirrors that so abcjs renders a readable, multi-line staff
  // instead of one unbroken line of bars. A "written bar" here is one
  // entry of `emitted`, so a folded repeat pair (one |: ... :| entry)
  // counts as a single bar for line-wrapping purposes, matching how it
  // occupies a single measure box on the page.
  const BARS_PER_LINE = 4;
  const lines: string[] = [];
  for (let i = 0; i < emitted.length; i += BARS_PER_LINE) {
    lines.push(emitted.slice(i, i + BARS_PER_LINE).join(" | "));
  }
  return lines.join(" |\n");
}

function buildSongAbcxText(fields: IrealSongFields, tuneNumber: number, sourceLink: string): string {
  const lines: string[] = [`X:${tuneNumber}`, `% iReal Pro source: ${sourceLink}`];
  if (fields.title) lines.push(`T:${fields.title}`);
  if (fields.composer) lines.push(`C:${fields.composer}`);
  if (fields.style) lines.push(`%%irealstyle ${fields.style}`);
  if (fields.groove) lines.push(`%%irealgroove ${fields.groove}`);
  if (fields.bpm) lines.push(`Q:1/4=${fields.bpm}`);
  lines.push(`%%irealrepeats ${fields.repeats ?? "1"}`);
  lines.push(`K:${fields.key || "C"}`);

  const chordText = unscramble(stripChordDataMarker(fields.rawChordData));
  const gridTokens = textToGridTokens(chordText);
  lines.push(gridTokensToAbcxBody(gridTokens));

  return lines.join("\n");
}

export function importIrealLinkToAbcx(link: string): string {
  const playlist = parsePlaylistLink(link);
  if (playlist.songs.length === 0) {
    throw new Error("No songs found in iReal Pro link; nothing to import");
  }
  return playlist.songs.map((song, i) => buildSongAbcxText(song, i + 1, link)).join("\n\n");
}
