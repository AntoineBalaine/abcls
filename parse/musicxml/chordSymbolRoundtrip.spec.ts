import * as fs from "fs";
import * as path from "path";
import { expect } from "chai";
import * as fc from "fast-check";
import { SemanticAnalyzer } from "../analyzers/semantic-analyzer";
import { TuneInterpreter } from "../interpreter/TuneInterpreter";
import { ABCContext } from "../parsers/Context";
import { AbcErrorReporter } from "../parsers/ErrorReporter";
import { parse } from "../parsers/parse";
import { Scanner } from "../parsers/scan";
import { tuneToAbcText } from "../tuneToAst";
import { ElementType, isMusicLine, NoteElement, StaffSystem, Tune } from "../types/abcjs-ast";
import { importFromMusicSheet } from "./importFromMusicSheet";
import { normalizeForMusicXML } from "./normalize";
import { serializeScorePartwise } from "./serialize";
import { parseMusicXmlToSheet } from "./testSupport/parseMusicXml";
import { validateAgainstMusicXmlSchema } from "./testSupport/xsdValidation";

function interpretAbc(abc: string): Tune {
  const ctx = new ABCContext(new AbcErrorReporter());
  const ast = parse(Scanner(abc, ctx), ctx);
  const analyzer = new SemanticAnalyzer(ctx);
  ast.accept(analyzer);
  return new TuneInterpreter(analyzer, ctx, abc).interpretFile(ast).tunes[0];
}

function noteElementsOf(tune: Tune): NoteElement[] {
  const out: NoteElement[] = [];
  for (const system of tune.systems) {
    if (!isMusicLine(system)) continue;
    for (const staff of (system as StaffSystem).staff) {
      for (const voice of staff.voices) {
        for (const element of voice) {
          if (element.el_type === ElementType.Note) out.push(element as NoteElement);
        }
      }
    }
  }
  return out;
}

function chordNamesOf(tune: Tune): string[] {
  return noteElementsOf(tune).flatMap((element) => (element.chord ?? []).map((chord) => chord.name));
}

function abcToXml(abc: string): string {
  return serializeScorePartwise(normalizeForMusicXML(interpretAbc(abc)));
}

function xmlToTune(xml: string): Tune {
  return importFromMusicSheet(parseMusicXmlToSheet(xml));
}

const ATTRIBUTES =
  "<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>";

function harmonyXml(step: string, kind: string): string {
  return `<harmony><root><root-step>${step}</root-step></root><kind>${kind}</kind></harmony>`;
}

function noteXml(step: string, voice = 1): string {
  return `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>2</duration><voice>${voice}</voice><type>half</type></note>`;
}

function restXml(voice = 1): string {
  return `<note><rest/><duration>2</duration><voice>${voice}</voice><type>half</type></note>`;
}

function scoreXml(measureContent: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1"><measure number="1">${ATTRIBUTES}${measureContent}</measure></part>
</score-partwise>`;
}

describe("MusicXML chord symbols", () => {
  describe("import", () => {
    it("attaches each <harmony> to the note it precedes", () => {
      const tune = xmlToTune(scoreXml(harmonyXml("A", "minor") + noteXml("A") + harmonyXml("D", "dominant") + noteXml("D")));
      expect(chordNamesOf(tune)).to.deep.equal(["Am", "D7"]);
    });

    it("writes the chord symbols as ABC annotations before their notes", () => {
      const abc = tuneToAbcText(xmlToTune(scoreXml(harmonyXml("A", "minor") + noteXml("A") + harmonyXml("D", "dominant") + noteXml("D"))), new ABCContext());
      expect(abc).to.match(/"Am"\s*A/);
      expect(abc).to.match(/"D7"\s*D/);
    });

    it("attaches a <harmony> that precedes a rest to that rest", () => {
      const tune = xmlToTune(scoreXml(noteXml("C") + harmonyXml("G", "dominant") + restXml()));
      const rest = noteElementsOf(tune).find((element) => element.rest)!;
      expect(rest.chord?.map((chord) => chord.name)).to.deep.equal(["G7"]);
    });

    it("attaches a <harmony> to the main note rather than to its grace note", () => {
      const grace = "<note><grace/><pitch><step>B</step><octave>4</octave></pitch><voice>1</voice><type>eighth</type></note>";
      const tune = xmlToTune(scoreXml(harmonyXml("C", "major") + grace + noteXml("C") + noteXml("D")));
      const withChord = noteElementsOf(tune).filter((element) => element.chord);
      expect(withChord).to.have.length(1);
      expect(withChord[0].gracenotes).to.have.length(1);
    });

    it("leaves notes without a <harmony> without chord symbols", () => {
      const tune = xmlToTune(scoreXml(noteXml("C") + noteXml("D")));
      expect(chordNamesOf(tune)).to.deep.equal([]);
    });
  });

  describe("export", () => {
    it("writes a schema-valid <harmony> before the note that carries the chord symbol", () => {
      const xml = abcToXml('X:1\nL:1/4\nM:4/4\nK:C\n"Am7"A "D7(b9)"D "G/B"B "N.C."z|\n');
      const validation = validateAgainstMusicXmlSchema(xml);
      expect(validation.valid, validation.errors.join("\n")).to.equal(true);
      expect(xml.match(/<harmony>/g)).to.have.length(4);
      expect(xml).to.match(/<\/harmony>\s*<note>\s*<rest\/>/);
    });

    it("does not export a positioned annotation as a <harmony>", () => {
      const xml = abcToXml('X:1\nL:1/4\nM:4/4\nK:C\n"^allegro"A B c d|\n');
      expect(xml).not.to.contain("<harmony>");
    });

    it("keeps the chord symbol of a rest on the rest instead of the next note", () => {
      const tune = interpretAbc('X:1\nL:1/4\nM:4/4\nK:C\n"G7"z A B c|\n');
      const rest = noteElementsOf(tune).find((element) => element.rest)!;
      expect(rest.chord?.map((chord) => chord.name)).to.deep.equal(["G7"]);
    });
  });

  describe("round trip", () => {
    // Every spelling opensheetmusicdisplay writes on import, so that a symbol
    // read from MusicXML and written back out keeps its kind.
    const OSMD_SPELLINGS = [
      "",
      "m",
      "aug",
      "dim",
      "7",
      "maj7",
      "m7",
      "dim7",
      "aug7",
      "m7b5",
      "m(maj7)",
      "maj6",
      "m6",
      "9",
      "maj9",
      "m9",
      "11",
      "maj11",
      "m11",
      "13",
      "maj13",
      "m13",
      "sus2",
      "sus4",
      "5",
      "7(b9)",
      "7(b9,#11)",
    ];

    it("brings every chord symbol spelled the way opensheetmusicdisplay spells it back unchanged through ABC -> XML -> Tune", () => {
      fc.assert(
        fc.property(
          fc.constantFrom("C", "D", "Eb", "F#", "G", "A", "Bb"),
          fc.constantFrom(...OSMD_SPELLINGS),
          fc.option(fc.constantFrom("/E", "/Bb", "/G"), { nil: "" }),
          (root, spelling, bass) => {
            const name = `${root}${spelling}${bass}`;
            const xml = abcToXml(`X:1\nL:1/4\nM:4/4\nK:C\n"${name}"C D E F|\n`);
            expect(chordNamesOf(xmlToTune(xml))).to.deep.equal([name]);
          }
        ),
        { numRuns: 60 }
      );
    });

    const FIXTURE_DIR = path.join(__dirname, "schema/testFixtures/musicxmlTestSuite");
    const harmonyFixtures = fs.readdirSync(FIXTURE_DIR).filter((file) => fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8").includes("<harmony"));

    it("finds the MusicXML Test Suite fixtures that contain chord symbols", () => {
      expect(harmonyFixtures.length).to.be.greaterThan(0);
    });

    for (const file of harmonyFixtures) {
      it(`keeps every chord symbol and stays schema-valid through XML -> Tune -> XML -> Tune: ${file}`, () => {
        const first = xmlToTune(fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8"));
        const reExported = serializeScorePartwise(normalizeForMusicXML(first));
        const validation = validateAgainstMusicXmlSchema(reExported);
        expect(validation.valid, validation.errors.join("\n")).to.equal(true);
        const firstNames = chordNamesOf(first);
        expect(firstNames.length).to.equal((fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8").match(/<harmony/g) ?? []).length);
        expect(chordNamesOf(xmlToTune(reExported))).to.deep.equal(firstNames);
      });
    }

    it("brings N.C. back unchanged", () => {
      const xml = abcToXml('X:1\nL:1/4\nM:4/4\nK:C\n"N.C."C D E F|\n');
      expect(chordNamesOf(xmlToTune(xml))).to.deep.equal(["N.C."]);
    });
  });
});
