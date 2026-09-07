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
function gridTokensToAbcxBody(tokens: GridToken[]): string {
  // ABCx chord symbols are written bare, with no surrounding quotes (a
  // quoted string is a different node, an annotation, not a ChordSymbol);
  // confirmed directly by checking that the round-tripped ABCx text
  // re-parses its chords correctly only without quotes.
  const parts: string[] = [];
  for (const t of tokens) {
    if (t.type === "bar") {
      parts.push("|");
    } else if (t.type === "noChord") {
      parts.push("N.C.");
    } else if (t.type === "repeatBar") {
      parts.push("%");
    } else {
      parts.push(parsedChordToAbcxText(t.chord));
    }
  }
  return parts.join(" ");
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
