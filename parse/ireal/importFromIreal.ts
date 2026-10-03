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
  // A section label (e.g. "*A") rendered as ABC's own standard inline
  // part-marker field, "[P:A]" — not a bare "[A]" bracket, which looks
  // similar but collides with ABC's own bracket/inline-field syntax and
  // corrupts the chord that follows it once this ABCx text is converted
  // to real ABC (confirmed: "[A]" parses as an inline field containing
  // the literal text "A", eating the bracket structure the next chord's
  // own quoting then collides with). "[P:A]" is exactly the construct
  // ABC (and renderers like abcjs) use for this, so it round-trips
  // cleanly and renders as a proper boxed section letter above the
  // staff — the same thing iReal Pro itself shows, not an ad hoc
  // annotation.
  if (t.type === "sectionLabel") return `[P:${t.label}]`;
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
// A heuristic for making the chart's one genuinely-repeated section
// visible as an actual repeat sign, the way iReal Pro itself displays
// it, instead of writing the section out twice as flat duplicated bars
// (which is what gridAnnotations.ts's fillRepeats produces when it
// flattens a "{...}" section — ABC's own repeat-barline model isn't
// threaded through this function's plain string-per-bar representation,
// so there's nothing marking the two halves as "the same section"
// beyond their text happening to be identical). Confirmed against a
// real chart ("A Felicidade") whose repeated 8-bar A section showed as
// 16 plain, visually indistinguishable bars before this; a listener
// comparing against iReal Pro's own display, which shows a single
// repeat-barline-wrapped section, flagged the difference.
//
// Detects the longest immediately-adjacent repeated run of bars
// (checked longest-first, so a genuine whole-section repeat wins over a
// shorter coincidental match inside it) and collapses it into one
// repeat-barline-wrapped occurrence. A minimum run length of 4 bars is
// required: real charts commonly repeat a short (e.g. 2-bar) vamp or
// ii-V pattern more than once without that being a notated repeat
// section, and compacting those coincidental matches would be wrong far
// more often than it would be right.
const MIN_REPEAT_RUN_BARS = 4;
const MAX_REPEAT_RUN_BARS = 16;

function compactImmediateRepeats(bars: string[]): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < bars.length) {
    const maxRun = Math.min(MAX_REPEAT_RUN_BARS, Math.floor((bars.length - i) / 2));
    let matchedRunLength = 0;
    for (let runLength = maxRun; runLength >= MIN_REPEAT_RUN_BARS; runLength--) {
      let matches = true;
      for (let j = 0; j < runLength; j++) {
        if (bars[i + j] !== bars[i + runLength + j]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        matchedRunLength = runLength;
        break;
      }
    }
    if (matchedRunLength > 0) {
      const run = bars.slice(i, i + matchedRunLength);
      result.push(`|: ${run[0]}`, ...run.slice(1, -1), `${run[run.length - 1]} :|`);
      i += matchedRunLength * 2;
    } else {
      result.push(bars[i]);
      i += 1;
    }
  }
  return result;
}

function gridTokensToAbcxBody(tokens: GridToken[]): string {
  const bars = splitIntoBars(tokens);
  const isRepeat = bars.map(isRepeatBar);

  // Resolve each repeat bar's text to the nearest preceding non-repeat
  // bar's text; the resulting array already has exactly the text to emit
  // for every bar, in order — a repeat bar needs no special treatment
  // beyond this resolution.
  const emitted: string[] = [];
  // Tracked separately from what's emitted: a section label belongs only
  // to the bar it actually introduces, not to every later bar that holds
  // the same chord via "x" — otherwise "[A] Cmaj7 | x | x" would show
  // "[A]" on all three bars instead of just the first.
  let lastSourceTextForRepeat = "";
  for (let i = 0; i < bars.length; i++) {
    if (isRepeat[i]) {
      emitted.push(lastSourceTextForRepeat);
    } else {
      emitted.push(bars[i].map(cellText).join(" "));
      lastSourceTextForRepeat = bars[i]
        .filter((t) => t.type !== "sectionLabel")
        .map(cellText)
        .join(" ");
    }
  }

  const compacted = compactImmediateRepeats(emitted);

  // iReal Pro charts are conventionally laid out four bars to a line; the
  // ABC output mirrors that so abcjs renders a readable, multi-line staff
  // instead of one unbroken line of bars.
  const BARS_PER_LINE = 4;
  const lines: string[] = [];
  for (let i = 0; i < compacted.length; i += BARS_PER_LINE) {
    lines.push(compacted.slice(i, i + BARS_PER_LINE).join(" | "));
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
