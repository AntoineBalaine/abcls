import { expect } from "chai";
import { MusicSheet } from "opensheetmusicdisplay";
import { Tune } from "../../types/abcjs-ast";
import { importFromMusicSheet } from "../importFromMusicSheet";
import { ScorePartwiseIR } from "../ir";
import { normalizeForMusicXML } from "../normalize";

/**
 * Imports a sheet in a test, and fails the test with the import's messages when the import fails.
 */
export function importTune(sheet: MusicSheet): Tune {
  const result = importFromMusicSheet(sheet);
  if (!result.ok) expect.fail(result.errors.join("; "));
  return result.tune;
}

/**
 * Normalizes a tune for MusicXML in a test, and fails the test with the export's messages when the export fails.
 */
export function normalizeTune(tune: Tune): ScorePartwiseIR {
  const result = normalizeForMusicXML(tune);
  if (!result.ok) expect.fail(result.errors.join("; "));
  return result.ir;
}
