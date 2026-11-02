import fs from "fs";
import path from "path";
import { expect } from "chai";
import { ElementType, NoteElement, StaffSystem } from "../types/abcjs-ast";
import { Tune } from "../types/abcjs-ast";
import { importFromMusicSheet } from "./importFromMusicSheet";
import { normalizeForMusicXML } from "./normalize";
import { parseMusicXmlToSheet } from "./parseMusicXml";
import { serializeScorePartwise } from "./serialize";
import { validateAgainstMusicXmlSchema } from "./testSupport/xsdValidation";

/**
 * Survey of the import/export pipeline against the real MusicXML Test Suite
 * (vendored under schema/testFixtures/musicxmlTestSuite/, see VENDORED.md).
 * Every fixture is sorted into exactly one bucket:
 *
 * - documented gap: import reports an unsupported feature for a
 *   reason already recorded in KNOWN_GAPS.md. Asserted by error message
 *   substring, not just catch-and-ignore.
 * - clean pass: import succeeds, re-export validates against the XSD, and
 *   re-importing the re-exported document yields a Tune with the same
 *   pitch/duration/rest content per voice as the original import. This is
 *   a real semantic check (via a second import, not a byte comparison of
 *   XML text or ABC formatting), not just a schema-validity check.
 * - excluded: `.invalid.` fixtures (deliberately malformed per the
 *   corpus's own convention) and one non-`.invalid.`-named fixture
 *   (41h-TooManyParts) that is equally deliberately malformed per its own
 *   embedded description; these are not round-trip material.
 * - needs a decision: real findings from this survey that are neither a
 *   clean pass nor an existing documented gap. Listed explicitly below
 *   with `it.skip` and a reason, not silently passed or failed.
 */

const FIXTURE_DIR = path.join(__dirname, "schema/testFixtures/musicxmlTestSuite");

function listFixtures(): string[] {
  return fs
    .readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".musicxml"))
    .sort();
}

// Deliberately malformed per the corpus's own convention (`.invalid.` in the
// name), or, for 41h, per its own embedded <miscellaneous-field> description
// ("more <part> elements than the <part-list> section contains"). Neither
// crashing on these nor rejecting them cleanly is a bug worth fixing for
// this survey; see the "needs a decision" section for the crash's error
// quality, which is a real but separate finding.
const EXCLUDED_MALFORMED = new Set([
  "41g-PartNoId.invalid.musicxml",
  "74b-FiguredBass.invalid.musicxml",
  "75b-Accordion.invalid.musicxml",
  "41h-TooManyParts.musicxml",
]);

// Fixtures expected to be reported as unsupported for a reason
// already documented in KNOWN_GAPS.md, with the substring that must appear
// in one of the reported messages.
const DOCUMENTED_GAPS: Record<string, string> = {
  "01d-Pitches-Microtones.musicxml": "accidental enum value",
  "01f-Pitches-ParenthesizedMicrotoneAccidentals.musicxml": "accidental enum value",
  "01h-Pitches-TurkishPersian.musicxml": "accidental enum value",
  "23d-Tuplets-Nested.musicxml": "nested tuplets",
  "71e-TabStaves.musicxml": "TAB clef",
};

function extractNoteSequence(tune: Tune): Array<{ pitches: number[]; duration: string; isRest: boolean }> {
  const out: Array<{ pitches: number[]; duration: string; isRest: boolean }> = [];
  for (const system of tune.systems) {
    if (!("staff" in system)) continue;
    for (const staff of (system as StaffSystem).staff) {
      for (const voice of staff.voices) {
        for (const el of voice) {
          if (el.el_type !== ElementType.Note) continue;
          const note = el as NoteElement;
          out.push({
            pitches: (note.pitches ?? []).map((p) => p.pitch ?? -9999),
            duration: `${note.duration.numerator}/${note.duration.denominator}`,
            isRest: !!note.rest,
          });
        }
      }
    }
  }
  return out;
}

/**
 * Imports a fixture, exports it again and imports the export. Because the import and the export report the content they
 * cannot represent instead of throwing, the result is either the three stages or the messages of the stage that failed.
 */
function runRoundTrip(xml: string): { ok: true; reExported: string; originalTune: Tune; reimportedTune: Tune } | { ok: false; errors: string[] } {
  const sheet = parseMusicXmlToSheet(xml);
  const original = importFromMusicSheet(sheet);
  if (!original.ok) return original;
  const normalized = normalizeForMusicXML(original.tune);
  if (!normalized.ok) return normalized;
  const reExported = serializeScorePartwise(normalized.ir);
  const reimported = importFromMusicSheet(parseMusicXmlToSheet(reExported));
  if (!reimported.ok) return reimported;
  return { ok: true, reExported, originalTune: original.tune, reimportedTune: reimported.tune };
}

describe("MusicXML Test Suite survey", () => {
  const allFixtures = listFixtures();

  describe("documented gaps (expected unsupported-feature errors)", () => {
    for (const [file, substring] of Object.entries(DOCUMENTED_GAPS)) {
      it(`reports ${file} as unsupported (${substring})`, () => {
        const xml = fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8");
        const result = runRoundTrip(xml);
        expect(result.ok).to.equal(false);
        expect(result.ok ? "" : result.errors.join("\n")).to.include(substring);
      });
    }
  });

  describe("clean pass: schema validity and semantic content preserved", () => {
    const gapFiles = new Set(Object.keys(DOCUMENTED_GAPS));
    // Fixtures needing a human decision (see report); excluded from the
    // blanket clean-pass loop below and listed individually as skipped.
    const needsDecision = new Set(["13a-KeySignatures.musicxml", "74a-FiguredBass.musicxml"]);
    const cleanPassFixtures = allFixtures.filter((f) => !EXCLUDED_MALFORMED.has(f) && !gapFiles.has(f) && !needsDecision.has(f));

    it("sanity: the clean-pass set is the expected size", () => {
      // 181 vendored - 3 .invalid. - 1 non-.invalid. malformed (41h) - 5 documented gaps - 2 needs-decision = 170
      expect(cleanPassFixtures.length).to.equal(170);
    });

    for (const file of cleanPassFixtures) {
      it(`round-trips cleanly: ${file}`, () => {
        const xml = fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8");
        const result = runRoundTrip(xml);
        if (!result.ok) expect.fail(result.errors.join("; "));
        const { reExported, originalTune, reimportedTune } = result;
        const xsd = validateAgainstMusicXmlSchema(reExported);
        expect(xsd.valid, `XSD validation errors:\n${xsd.errors.join("\n")}`).to.equal(true);
        const originalNotes = extractNoteSequence(originalTune);
        const reimportedNotes = extractNoteSequence(reimportedTune);
        expect(reimportedNotes.length, "note count changed across the round trip").to.equal(originalNotes.length);
        expect(reimportedNotes, "pitch/duration/rest content changed across the round trip").to.deep.equal(originalNotes);
      });
    }
  });

  describe("needs a decision (not a clean pass, not an existing documented gap)", () => {
    it.skip("13a-KeySignatures.musicxml: throws 'key with -11 fifths' — MusicXML's fifths attribute is not documented in KNOWN_GAPS.md as bounded; unclear whether extreme fifths counts (beyond the traditional ±7) should be supported with a real key-spelling table or added as a new documented gap. See survey report.", () => {});
    it.skip("74a-FiguredBass.musicxml: contains real <figured-bass> content but silently completes instead of throwing, contradicting KNOWN_GAPS.md's 'throws unconditionally' claim. Root cause: opensheetmusicdisplay's own parser does not expose figured bass anywhere in its shipped types, so importFromMusicSheet(sheet: MusicSheet) structurally cannot detect it from the object it receives — enforcing the documented policy would require importFromMusicSheet to also accept raw XML text, a public API change beyond this survey's scope. See survey report.", () => {});
    it.skip("41g-PartNoId.invalid.musicxml and 41h-TooManyParts.musicxml: both throw a raw TypeError ('Cannot read properties of undefined (reading Instruments)') instead of a clean, named error. Excluded from the must-round-trip bar since both are deliberately malformed, but a cleaner rejection would be a small future robustness improvement. See survey report.", () => {});
  });
});
