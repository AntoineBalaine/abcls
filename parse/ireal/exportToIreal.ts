import { parseChordSymbol } from "../music-theory/parseChordSymbol";
import { scanChordSymbol } from "../music-theory/scanChordSymbol";
import { ABCContext } from "../parsers/Context";
import { parseAbcx } from "../parsers/parse_abcx";
import { ScannerAbcx } from "../parsers/scan_abcx_tunebody";
import { BarLine, ChordSymbol, Directive, File_structure, Info_line, Tune } from "../types/Expr";
import { buildPlaylistLink, IrealSongFields, withChordDataMarker } from "./fields";
import { GridToken, gridTokensToText } from "./gridNotation";
import { scramble } from "./scramble";

function infoLineText(line: Info_line): string {
  return line.value.map((t) => t.lexeme).join("");
}

function findInfoLine(tune: Tune, headerLexeme: string): Info_line | undefined {
  return tune.tune_header.info_lines.find((l): l is Info_line => l instanceof Info_line && l.key.lexeme === headerLexeme);
}

function findDirective(tune: Tune, name: string): Directive | undefined {
  return tune.tune_header.info_lines.find((l): l is Directive => l instanceof Directive && l.key.lexeme === name);
}

function directiveText(directive: Directive): string {
  return directive.values.map((v) => ("lexeme" in v ? v.lexeme : "")).join(" ");
}

function buildTuneFields(tune: Tune): IrealSongFields {
  const title = findInfoLine(tune, "T:");
  const composer = findInfoLine(tune, "C:");
  const key = findInfoLine(tune, "K:");
  const tempo = findInfoLine(tune, "Q:");
  const style = findDirective(tune, "irealstyle");
  const groove = findDirective(tune, "irealgroove");
  const repeats = findDirective(tune, "irealrepeats");

  const gridTokens: GridToken[] = [];
  if (tune.tune_body) {
    for (const system of tune.tune_body.sequence) {
      for (const item of system) {
        if (item instanceof ChordSymbol) {
          const lexeme = item.token.lexeme;
          const scanned = scanChordSymbol(lexeme);
          // scanChordSymbol can return a partial match (e.g. it only
          // recognizes lowercase "maj", so "BbMaj7" scans just "Bb" and
          // silently drops "aj7"); trusting a partial match would silently
          // export a truncated, wrong chord, so this is treated as a
          // failure rather than accepted.
          const parsed = scanned && scanned.consumed === lexeme.length ? parseChordSymbol(scanned.tokens) : null;
          if (!parsed) {
            throw new Error(`Could not parse chord symbol "${lexeme}" for iReal Pro export`);
          }
          gridTokens.push({ type: "chord" as const, chord: parsed });
        } else if (item instanceof BarLine) {
          gridTokens.push({ type: "bar" as const });
        }
      }
    }
  }

  const gridText = gridTokensToText(gridTokens);
  const scrambled = scramble(gridText);

  return {
    title: title ? infoLineText(title) : "",
    composer: composer ? infoLineText(composer) : "",
    style: style ? directiveText(style) : "",
    key: key ? infoLineText(key) : "C",
    transpose: "0",
    rawChordData: withChordDataMarker(scrambled),
    groove: groove ? directiveText(groove) : undefined,
    // Q: is commonly "<note-length>=<bpm>" (e.g. "1/4=120") or bare "120";
    // stripping all non-digits would wrongly concatenate every digit run
    // in the note-length part with the bpm itself, so only the trailing
    // digit run is taken.
    bpm: tempo ? infoLineText(tempo).match(/(\d+)\s*$/)?.[1] : undefined,
    repeats: repeats ? directiveText(repeats) : undefined,
  };
}

export function exportAbcxToIrealLink(abcxSource: string): string {
  const ctx = new ABCContext();
  const tokens = ScannerAbcx(abcxSource, ctx);
  const fileStructure: File_structure = parseAbcx(tokens, ctx);

  const songs: IrealSongFields[] = [];
  for (const item of fileStructure.contents) {
    if (item instanceof Tune) {
      songs.push(buildTuneFields(item));
    }
  }

  if (songs.length === 0) {
    throw new Error("No tunes found in ABCx source; nothing to export");
  }

  return buildPlaylistLink({ songs });
}
