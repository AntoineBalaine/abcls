import { expect } from "chai";
import { normalizeForMusicXML } from "./normalize";
import { serializeScorePartwise } from "./serialize";
import { importFromMusicSheet } from "./importFromMusicSheet";
import { parseMusicXmlToSheet } from "./testSupport/parseMusicXml";
import { validateAgainstMusicXmlSchema } from "./testSupport/xsdValidation";

/**
 * Schema round-trip: fixture XML -> MusicSheetReader -> importFromMusicSheet
 * -> Tune -> normalizeForMusicXML -> serializeScorePartwise -> re-exported
 * XML, validated against the MusicXML 4.0 XSD. This is a floor, not a
 * completeness claim: passing schema validation on the re-exported document
 * does not prove semantic fidelity, since the schema permits many
 * structures this exporter does not attempt to reproduce exactly.
 */
function roundTrip(xml: string): string {
  const sheet = parseMusicXmlToSheet(xml);
  const tune = importFromMusicSheet(sheet);
  const ir = normalizeForMusicXML(tune);
  return serializeScorePartwise(ir);
}

const FIXTURES: Record<string, string> = {
  "single voice, mixed durations and a rest": `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>2</divisions>
        <key><fifths>2</fifths><mode>major</mode></key>
        <time><beats>3</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type></note>
      <note><rest/><duration>2</duration><type>quarter</type></note>
      <note><pitch><step>F</step><octave>4</octave><alter>1</alter></pitch><duration>2</duration><type>quarter</type><accidental>sharp</accidental></note>
    </measure>
  </part>
</score-partwise>`,
  "two voices with backup": `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type><voice>1</voice></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>C</step><octave>2</octave></pitch><duration>4</duration><type>whole</type><voice>2</voice></note>
    </measure>
  </part>
</score-partwise>`,
  "grand staff, two instruments braced": `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <part-group type="start" number="1"><group-symbol>brace</group-symbol><group-barline>yes</group-barline></part-group>
    <score-part id="P1"><part-name>Piano-RH</part-name></score-part>
    <score-part id="P2"><part-name>Piano-LH</part-name></score-part>
    <part-group type="stop" number="1"/>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
  </part>
  <part id="P2">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`,
};

describe("MusicXML import/export schema round-trip", () => {
  for (const [name, xml] of Object.entries(FIXTURES)) {
    it(`re-exports valid MusicXML for: ${name}`, () => {
      const reExported = roundTrip(xml);
      const result = validateAgainstMusicXmlSchema(reExported);
      expect(result.valid, `XSD validation errors:\n${result.errors.join("\n")}\n\nDocument:\n${reExported}`).to.equal(true);
    });
  }
});
