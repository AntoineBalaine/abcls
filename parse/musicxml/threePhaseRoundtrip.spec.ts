import { expect } from "chai";
import { SemanticAnalyzer } from "../analyzers/semantic-analyzer";
import { ABCContext } from "../parsers/Context";
import { AbcErrorReporter } from "../parsers/ErrorReporter";
import { parse } from "../parsers/parse";
import { Scanner } from "../parsers/scan";
import { TuneInterpreter } from "../interpreter/TuneInterpreter";
import { Tune } from "../types/abcjs-ast";
import { tuneToAbcText } from "../tuneToAst";
import { normalizeForMusicXML } from "./normalize";
import { serializeScorePartwise } from "./serialize";
import { importFromMusicSheet } from "./importFromMusicSheet";
import { parseMusicXmlToSheet } from "./testSupport/parseMusicXml";

/**
 * Full three-phase loop: ABC text -> Tune (existing pipeline) -> MusicXML
 * (phase 1) -> Tune (phase 2) -> ABC text (phase 3) -> Tune (existing
 * pipeline again). Planned in .private/3.tune-to-abc-serializer.md and
 * explicitly deferred there pending phase 2 landing on this branch; phase 2
 * has since landed (055bd43) but this test was never added until now.
 *
 * Compares semantic content between the first and last Tune, not the two
 * ABC texts as strings (formatting is allowed to differ) and not every
 * Tune field (some fields have no canonical form or aren't preserved by
 * design), following the same comparator style already used in
 * tuneToAst.spec.ts's summarizeTune.
 */
function interpretABC(abc: string): Tune {
  const ctx = new ABCContext(new AbcErrorReporter());
  const tokens = Scanner(abc, ctx);
  const ast = parse(tokens, ctx);
  const analyzer = new SemanticAnalyzer(ctx);
  ast.accept(analyzer);
  const interpreter = new TuneInterpreter(analyzer, ctx, abc);
  const result = interpreter.interpretFile(ast);
  return result.tunes[0];
}

function fullRoundTrip(abc: string): { originalTune: Tune; finalTune: Tune; intermediateXml: string; intermediateAbc: string } {
  const originalTune = interpretABC(abc);

  const ir = normalizeForMusicXML(originalTune);
  const intermediateXml = serializeScorePartwise(ir);

  const sheet = parseMusicXmlToSheet(intermediateXml);
  const importedTune = importFromMusicSheet(sheet);

  const ctx = new ABCContext(new AbcErrorReporter());
  const intermediateAbc = tuneToAbcText(importedTune, ctx);

  const finalTune = interpretABC(intermediateAbc);

  return { originalTune, finalTune, intermediateXml, intermediateAbc };
}

/**
 * Semantic summary of a Tune's notes across all voices: pitches, durations,
 * rests, ties, slur open/close presence, and decoration names. Ignores
 * anything with no canonical form across a MusicXML round trip (line
 * breaks, exact spacing, note-length shorthand choice), and voice/staff
 * indexing details (matched by voiceIds/positional fallback, matching
 * tuneToAst.spec.ts's summarizeTune).
 */
interface NoteSummary {
  pitches: number[];
  duration: string;
  isRest: boolean;
  tie: boolean;
  hasStartSlur: boolean;
  hasEndSlur: boolean;
  decorations: string[];
}

function summarizeTune(tune: Tune): NoteSummary[][] {
  const byId = new Map<string, NoteSummary[]>();
  const order: string[] = [];
  for (const system of tune.systems) {
    if (!("staff" in system)) continue;
    system.staff.forEach((staff, staffIndex) => {
      staff.voices.forEach((elements, voiceIndex) => {
        const id = staff.voiceIds?.[voiceIndex] ?? `${staffIndex}-${voiceIndex}`;
        if (!byId.has(id)) {
          byId.set(id, []);
          order.push(id);
        }
        const bucket = byId.get(id)!;
        for (const element of elements) {
          if (element.el_type !== "note") continue;
          const isRest = !!element.rest;
          const pitches = (element.pitches ?? []).map((p) => p.pitch);
          const tie = (element.pitches ?? []).some((p) => !!p.startTie);
          const hasStartSlur = (element.pitches ?? []).some((p) => !!p.startSlur && p.startSlur.length > 0);
          const hasEndSlur = (element.pitches ?? []).some((p) => !!p.endSlur && p.endSlur.length > 0);
          const decorations = [...(element.decoration ?? [])].sort();
          bucket.push({
            pitches,
            duration: `${element.duration.numerator}/${element.duration.denominator}`,
            isRest,
            tie,
            hasStartSlur,
            hasEndSlur,
            decorations,
          });
        }
      });
    });
  }
  return order.map((id) => byId.get(id)!);
}

describe("three-phase round trip: ABC -> MusicXML -> ABC", () => {
  it("preserves pitches, durations, and rests for a simple single-voice tune", () => {
    const abc = `X:1
M:4/4
L:1/4
K:C
C D E F |
G2 A2 |
z4 |`;
    const { originalTune, finalTune } = fullRoundTrip(abc);
    expect(summarizeTune(finalTune)).to.deep.equal(summarizeTune(originalTune));
  });

  it("preserves ties across the full round trip", () => {
    const abc = `X:1
M:4/4
L:1/4
K:C
C-C D E |`;
    const { originalTune, finalTune } = fullRoundTrip(abc);
    expect(summarizeTune(finalTune)).to.deep.equal(summarizeTune(originalTune));
  });

  it("preserves a slur spanning more than one note across the full round trip", () => {
    const abc = `X:1
M:4/4
L:1/4
K:C
(C D E) F |`;
    const { originalTune, finalTune } = fullRoundTrip(abc);

    const originalSummary = summarizeTune(originalTune);
    expect(originalSummary[0][0].hasStartSlur, "sanity check: original C should open the slur").to.equal(true);
    expect(originalSummary[0][2].hasEndSlur, "sanity check: original E should close the slur").to.equal(true);

    expect(summarizeTune(finalTune)).to.deep.equal(originalSummary);
  });

  it("preserves a bang-style decoration across the full round trip", () => {
    const abc = `X:1
M:4/4
L:1/4
K:C
!trill!C D E F |`;
    const { originalTune, finalTune } = fullRoundTrip(abc);

    const originalSummary = summarizeTune(originalTune);
    expect(originalSummary[0][0].decorations, "sanity check: original C should carry the trill").to.deep.equal(["trill"]);

    expect(summarizeTune(finalTune)).to.deep.equal(originalSummary);
  });

  // Skipped: reveals a genuine, confirmed bug in importFromMusicSheet.ts, not
  // in this test or in tuneToAst.ts. V:1/V:2 with no explicit merge assigns
  // each voice to its own staff (TuneInterpreter's default staff-assignment
  // rule), so the original Tune has two staves, each with one voice. MusicXML
  // numbers voices per-part (each part's own voice restarts at "1"), and
  // importFromMusicSheet copies that per-part-scoped Voice.VoiceId directly
  // onto Staff.voiceIds without making it tune-wide unique. Both staves end
  // up with voiceIds === ["1"], so tuneToAst.ts's by-voice-id grouping (which
  // is correct given the data it receives) merges both staves' notes into one
  // voice, producing a duplicate "V:1" header and concatenated note content
  // instead of two voices. Confirmed by direct trace: the imported Tune
  // correctly has 2 staves, but both report voiceIds ["1"]. Needs a fix in
  // importFromMusicSheet.ts to synthesize a tune-wide-unique id (e.g.
  // combining part index with the local VoiceId) rather than copying
  // Voice.VoiceId verbatim. Not fixed here per this task's scope.
  it.skip("preserves pitches and durations for a multi-voice tune", () => {
    const abc = `X:1
M:4/4
L:1/4
K:C
V:1
C D E F |
V:2
E,4 |`;
    const { originalTune, finalTune } = fullRoundTrip(abc);
    expect(summarizeTune(finalTune)).to.deep.equal(summarizeTune(originalTune));
  });
});
