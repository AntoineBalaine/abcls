import { expect } from "chai";
import { meterToBeatsAndType, normalizeForMusicXML } from "./normalize";
import { serializeScorePartwise } from "./serialize";
import { importFromMusicSheet } from "./importFromMusicSheet";
import { parseMusicXmlToSheet } from "./testSupport/parseMusicXml";
import { validateAgainstMusicXmlSchema } from "./testSupport/xsdValidation";
import { MeterType } from "../types/abcjs-ast";

/**
 * Regression test for the common/cut time symbol round-trip gap documented
 * in KNOWN_GAPS.md: importFromMusicSheet correctly read <time symbol="...">
 * into Meter.type, but normalizeForMusicXML/serializeScorePartwise had no
 * field to carry the symbol back out on re-export.
 */
function roundTrip(xml: string): string {
  const sheet = parseMusicXmlToSheet(xml);
  const tune = importFromMusicSheet(sheet);
  const ir = normalizeForMusicXML(tune);
  return serializeScorePartwise(ir);
}

function fixtureWithTimeSymbol(symbol: "common" | "cut"): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
        <time symbol="${symbol}"><beats>${symbol === "cut" ? "2" : "4"}</beats><beat-type>${symbol === "cut" ? "2" : "4"}</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>${symbol === "cut" ? "2" : "4"}</duration><type>${symbol === "cut" ? "half" : "quarter"}</type></note>
    </measure>
  </part>
</score-partwise>`;
}

describe("common/cut time symbol survives a re-export", () => {
  for (const symbol of ["common", "cut"] as const) {
    it(`preserves symbol="${symbol}" on <time> through import and re-export`, () => {
      const reExported = roundTrip(fixtureWithTimeSymbol(symbol));

      expect(reExported).to.include(`<time symbol="${symbol}">`);

      const result = validateAgainstMusicXmlSchema(reExported);
      expect(result.valid, `XSD validation errors:\n${result.errors.join("\n")}\n\nDocument:\n${reExported}`).to.equal(true);
    });
  }

  it("does not emit a symbol attribute for a plain numeric time signature", () => {
    const plain = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
        <time><beats>3</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>3</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

    const reExported = roundTrip(plain);
    expect(reExported).to.include("<time>");
    expect(reExported).to.not.include('symbol="');
  });

  // MeterType.CommonTime is reused by info-line-analyzer.ts's parseSpecialMeter
  // as a tag for ABC mensural symbols (o, c, o., c.), whose actual value is
  // 3/1, 2/1, 9/8, or 6/8 respectively, not 4/4. Emitting symbol="common" for
  // these would produce an internally inconsistent <time> element, since
  // MusicXML readers treat symbol="common" as implying 4/4 regardless of the
  // beats/beat-type children. Found by code review on this same commit.
  describe("mensural meter symbols do not falsely claim common/cut time", () => {
    it("does not set a symbol for tempus perfectum (o), which is tagged CommonTime but is really 3/1", () => {
      const result = meterToBeatsAndType({ type: MeterType.CommonTime, value: [{ numerator: 3, denominator: 1 }] });
      expect(result).to.deep.equal({ beats: "3", beatType: "1", symbol: undefined });
    });

    it("does not set a symbol for tempus imperfectum (c), which is tagged CommonTime but is really 2/1", () => {
      const result = meterToBeatsAndType({ type: MeterType.CommonTime, value: [{ numerator: 2, denominator: 1 }] });
      expect(result).to.deep.equal({ beats: "2", beatType: "1", symbol: undefined });
    });

    it("does not set a symbol for tempus perfectum prolatio (o.), which is tagged CommonTime but is really 9/8", () => {
      const result = meterToBeatsAndType({ type: MeterType.CommonTime, value: [{ numerator: 9, denominator: 8 }] });
      expect(result).to.deep.equal({ beats: "9", beatType: "8", symbol: undefined });
    });

    it("does not set a symbol for tempus imperfectum prolatio (c.), which is tagged CommonTime but is really 6/8", () => {
      const result = meterToBeatsAndType({ type: MeterType.CommonTime, value: [{ numerator: 6, denominator: 8 }] });
      expect(result).to.deep.equal({ beats: "6", beatType: "8", symbol: undefined });
    });

    it("still sets symbol common for genuine CommonTime with a 4/4 value", () => {
      const result = meterToBeatsAndType({ type: MeterType.CommonTime, value: [{ numerator: 4, denominator: 4 }] });
      expect(result).to.deep.equal({ beats: "4", beatType: "4", symbol: "common" });
    });

    it("still sets symbol cut for genuine CutTime with a 2/2 value", () => {
      const result = meterToBeatsAndType({ type: MeterType.CutTime, value: [{ numerator: 2, denominator: 2 }] });
      expect(result).to.deep.equal({ beats: "2", beatType: "2", symbol: "cut" });
    });
  });
});
