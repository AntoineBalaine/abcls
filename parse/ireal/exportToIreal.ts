/**
 * Turns ABCx source into an `irealb://` link.
 *
 * The composition of the three steps `plans/4.abcx-to-ireal-export.md`
 * section 4 lays out: read each tune into an `IrealChart`, write that tree
 * out as grid text, and assemble the link. Nothing here assembles text
 * while walking the ABCx tree, which is what the previous implementation
 * did and why it lost every repeat, ending, section label and annotation a
 * chart had.
 *
 * Conditions either half reports are left on the context rather than
 * thrown, so that a caller sees a chart it could not express alongside the
 * link it did produce. Only a source with no tune at all throws, since
 * there is then no link to return.
 */

import { ABCContext } from "../parsers/Context";
import { parse } from "../parsers/parse";
import { parseAbcx } from "../parsers/parse_abcx";
import { Scanner } from "../parsers/scan";
import { ScannerAbcx } from "../parsers/scan_abcx_tunebody";
import { File_structure, Info_line, Tune } from "../types/Expr";
import { abcTuneToIrealChart, AbcToIrealOptions } from "./abcToIrealChart";
import { abcxTuneToIrealChart, abcxTuneToSongFields, report } from "./abcxToIrealChart";
import { buildPlaylistLink, IrealSongFields, withChordDataMarker } from "./fields";
import { writeGrid } from "./gridWriter";
import { scramble } from "./scramble";

function tuneToSongFields(tune: Tune, ctx: ABCContext): IrealSongFields {
  const chart = abcxTuneToIrealChart(tune, ctx);
  const grid = writeGrid(chart, ctx);
  return abcxTuneToSongFields(tune, withChordDataMarker(scramble(grid)), ctx);
}

export function exportAbcxToIrealLink(abcxSource: string, ctx: ABCContext = new ABCContext()): string {
  const fileStructure: File_structure = parseAbcx(ScannerAbcx(abcxSource, ctx), ctx);

  const songs: IrealSongFields[] = [];
  for (const item of fileStructure.contents) {
    if (item instanceof Tune) songs.push(tuneToSongFields(item, ctx));
  }

  if (songs.length === 0) {
    throw new Error("No tunes found in ABCx source; nothing to export");
  }

  return buildPlaylistLink({ songs });
}

/** The X: number of a tune, or null when the header has none. */
function tuneNumber(tune: Tune): number | null {
  for (const line of tune.tune_header.info_lines) {
    if (line instanceof Info_line && line.key.lexeme === "X:") {
      const number = parseInt(line.value.map((token) => token.lexeme).join(""), 10);
      return Number.isFinite(number) ? number : null;
    }
  }
  return null;
}

export interface AbcToIrealLinkOptions extends AbcToIrealOptions {
  /** Only export the tunes with these X: numbers. Defaults to every tune. */
  tunes?: number[];
  /** The iReal Pro style of the songs, used when a tune carries no `%%irealstyle` directive. */
  style?: string;
}

/**
 * Turns the chord symbols of an ABC score into an `irealb://` link.
 *
 * The chords are read from one voice of each tune (see `abcToIrealChart.ts`), and the key is the key written in the
 * header, so a tune is exported in the key it is written in.
 *
 * @returns The link, or null when no tune can be exported; the reason is then reported to the context's error reporter
 */
export function exportAbcToIrealLink(abcSource: string, options: AbcToIrealLinkOptions = {}, ctx: ABCContext = new ABCContext()): string | null {
  const fileStructure: File_structure = parse(Scanner(abcSource, ctx), ctx);

  const songs: IrealSongFields[] = [];
  for (const item of fileStructure.contents) {
    if (!(item instanceof Tune)) continue;
    const number = tuneNumber(item);
    if (options.tunes !== undefined && (number === null || !options.tunes.includes(number))) continue;

    const chart = abcTuneToIrealChart(item, ctx, options);
    const grid = writeGrid(chart, ctx);
    const fields = abcxTuneToSongFields(item, withChordDataMarker(scramble(grid)), ctx);
    if (fields.style === "" && options.style !== undefined) fields.style = options.style;
    songs.push(fields);
  }

  if (songs.length === 0) {
    report(ctx, "No tune to export: the file has no tune, or none of them matches the requested X: numbers", "", 0);
    return null;
  }

  return buildPlaylistLink({ songs });
}
