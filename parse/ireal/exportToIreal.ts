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
import { parseAbcx } from "../parsers/parse_abcx";
import { ScannerAbcx } from "../parsers/scan_abcx_tunebody";
import { File_structure, Tune } from "../types/Expr";
import { abcxTuneToIrealChart, abcxTuneToSongFields } from "./abcxToIrealChart";
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
