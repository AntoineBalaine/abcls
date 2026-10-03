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
  // A "repeatBar" cell mixed into a multi-cell bar, rather than being the
  // bar's sole content (the shape gridTokensToAbcxBody's whole-bar repeat
  // pass below already resolves), has no single-cell ABCx equivalent.
  // Dropped silently rather than thrown, matching this module's
  // documented policy of degrading unsupported/ungrammatical iReal grid
  // shapes instead of crashing the whole import (see KNOWN_GAPS.md) —
  // found importing a real user library backup containing this shape.
  return "";
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

// A bar consisting entirely of one or more "repeat previous bar" cells —
// iReal Pro packs "repeat this bar N times" as N consecutive repeatBar
// cells inside a single bar slot (no "|" between them), not as N
// separate one-cell bars, so this must accept more than one cell.
function isRepeatBar(bar: GridToken[]): boolean {
  return bar.length > 0 && bar.every((t) => t.type === "repeatBar");
}

/**
 * Renders one song's grid tokens as an ABCx tune-body line.
 *
 * iReal Pro's "x" grid cell means "this bar holds the same chord as the
 * previous bar" — a held/sustained chord spanning consecutive bars, the
 * same thing a real chart shows as that chord simply written again in
 * each bar with ordinary barlines, not a music-notation repeat sign.
 * ABC's `|:`/`:|` repeat barlines mean something else entirely (jump
 * back and play a whole section again) and are reserved for genuine
 * repeated sections; wrapping every single-bar "x" hold in its own
 * `|: ... :|` pair, an earlier version of this function did, produced a
 * chart littered with spurious repeat signs on ordinary held chords
 * instead of the plain repeated bars iReal Pro itself shows (confirmed
 * against a real chart, "A Felicidade", where only its actual repeated
 * A section carries a repeat sign in iReal Pro's own display — every
 * other "x" in the chart is just a held chord).
 *
 * So each "x" cell resolves to the same plain chord text as the nearest
 * preceding non-repeat bar, written as an ordinary bar like any other —
 * no special barline syntax at all. (In the generated ABCx text, "x"
 * used to be written as a bare "%" character; since ABCx, like ABC,
 * treats "%" as the start of a comment, that silently truncated any
 * real-world chart using repeat bars, which is why this function
 * resolves it to real chord text instead.)
 */
function gridTokensToAbcxBody(tokens: GridToken[]): string {
  const bars = splitIntoBars(tokens);
  const isRepeat = bars.map(isRepeatBar);

  // Resolve each repeat bar's text to the nearest preceding non-repeat
  // bar's text; the resulting array already has exactly the text to emit
  // for every bar, in order — a repeat bar needs no special treatment
  // beyond this resolution.
  const emitted: string[] = [];
  let lastSourceText = "";
  for (let i = 0; i < bars.length; i++) {
    if (isRepeat[i]) {
      emitted.push(lastSourceText);
    } else {
      const text = bars[i].map(cellText).join(" ");
      emitted.push(text);
      lastSourceText = text;
    }
  }

  // iReal Pro charts are conventionally laid out four bars to a line; the
  // ABC output mirrors that so abcjs renders a readable, multi-line staff
  // instead of one unbroken line of bars.
  const BARS_PER_LINE = 4;
  const lines: string[] = [];
  for (let i = 0; i < emitted.length; i += BARS_PER_LINE) {
    lines.push(emitted.slice(i, i + BARS_PER_LINE).join(" | "));
  }
  return lines.join(" |\n");
}

/**
 * Translates iReal Pro's own key-field spelling into standard ABC key
 * syntax. iReal Pro's key picker marks a minor key with a trailing "-"
 * (matching its own minor-chord shorthand, e.g. "A-7"), not ABC's "m"
 * suffix — so a chart whose key field is "A-" would otherwise end up as
 * the literal (invalid, and silently misread as major) ABC header
 * "K:A-" rather than "K:Am".
 */
function irealKeyToAbcKey(key: string): string {
  return key.endsWith("-") ? `${key.slice(0, -1)}m` : key;
}

function buildSongAbcxText(fields: IrealSongFields, tuneNumber: number, sourceLink: string): string {
  const lines: string[] = [`X:${tuneNumber}`, `% iReal Pro source: ${sourceLink}`];
  if (fields.title) lines.push(`T:${fields.title}`);
  if (fields.composer) lines.push(`C:${fields.composer}`);
  if (fields.style) lines.push(`%%irealstyle ${fields.style}`);
  if (fields.groove) lines.push(`%%irealgroove ${fields.groove}`);
  if (fields.bpm) lines.push(`Q:1/4=${fields.bpm}`);
  lines.push(`%%irealrepeats ${fields.repeats ?? "1"}`);
  lines.push(`K:${irealKeyToAbcKey(fields.key || "C")}`);

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
