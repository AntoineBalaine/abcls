import { expect } from "chai";
import { ABCContext } from "../parsers/Context";
import { tuneToAbcText } from "../tuneToAst";
import { BarType, ElementType, isBarElement, isMusicLine, NoteElement, RestType, StaffSystem, Tune, VoiceElement } from "../types/abcjs-ast";
import { importFromMusicSheet } from "./importFromMusicSheet";
import { parseMusicXmlToSheet } from "./testSupport/parseMusicXml";

const ATTRIBUTES_4_4 = `<attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>`;

function note(step: string, duration: number, voice = 1, type = "quarter"): string {
  return `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration><voice>${voice}</voice><type>${type}</type></note>`;
}

function rest(duration: number, voice = 1): string {
  return `<note><rest/><duration>${duration}</duration><voice>${voice}</voice></note>`;
}

function scoreXml(measures: string[], extraAttributes = ""): string {
  const body = measures
    .map(
      (content, i) =>
        `<measure number="${i + 1}">${i === 0 ? ATTRIBUTES_4_4.replace("</attributes>", `${extraAttributes}</attributes>`) : ""}${content}</measure>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">${body}</part>
</score-partwise>`;
}

function importXml(xml: string): Tune {
  return importFromMusicSheet(parseMusicXmlToSheet(xml));
}

function staffSystems(tune: Tune): StaffSystem[] {
  return tune.systems.filter(isMusicLine) as StaffSystem[];
}

/** Splits a voice's elements into measures, using the closing bars as separators. */
function measuresOf(voice: VoiceElement[]): NoteElement[][] {
  const out: NoteElement[][] = [[]];
  for (const element of voice) {
    if (isBarElement(element)) {
      if (element.type !== BarType.BarLeftRepeat) out.push([]);
      continue;
    }
    if (element.el_type === ElementType.Note) out[out.length - 1].push(element as NoteElement);
  }
  if (out[out.length - 1].length === 0) out.pop();
  return out;
}

function durationSum(notes: NoteElement[]): number {
  return notes.reduce((sum, n) => sum + n.duration.numerator / n.duration.denominator, 0);
}

describe("importFromMusicSheet rest padding", () => {
  it("fills a measure in which a voice has no entry with one invisible rest", () => {
    const xml = scoreXml([`${note("C", 4, 1, "whole")}<backup><duration>4</duration></backup>${note("E", 4, 2, "whole")}`, `${note("D", 4, 1, "whole")}`]);
    const tune = importXml(xml);
    const voice2 = staffSystems(tune)[0].staff[0].voices[1];
    const measure2 = measuresOf(voice2)[1];
    expect(measure2).to.have.length(1);
    expect(measure2[0].rest?.type).to.equal(RestType.Invisible);
    expect(measure2[0].duration).to.deep.equal({ numerator: 1, denominator: 1 });
    const abc = tuneToAbcText(tune, new ABCContext());
    expect(abc).to.match(/\bX\b/);
    expect(abc).not.to.contain("x8");
  });

  it("pads the silent stretch before a lone note with a visible rest", () => {
    const xml = scoreXml([
      `${note("C", 4, 1, "whole")}<backup><duration>4</duration></backup><forward><duration>2</duration><voice>2</voice></forward>${note("D", 1, 2)}`,
    ]);
    const tune = importXml(xml);
    const measure = measuresOf(staffSystems(tune)[0].staff[0].voices[1])[0];
    expect(measure.map((n) => (n.rest ? `z${n.duration.numerator}/${n.duration.denominator}` : "note"))).to.deep.equal(["z1/2", "note", "z1/4"]);
    expect(tuneToAbcText(tune, new ABCContext())).to.contain("z4 D2 z2");
  });

  it("pads a trailing gap with a visible rest", () => {
    // Because OSMD treats a short first measure as a pickup, the gap is
    // created in a second voice of a full measure instead.
    const xml = scoreXml([`${note("C", 4, 1, "whole")}<backup><duration>4</duration></backup>${note("D", 1, 2)}${note("E", 1, 2)}${note("F", 1, 2)}`]);
    const tune = importXml(xml);
    const firstMeasure = measuresOf(staffSystems(tune)[0].staff[0].voices[1])[0];
    const last = firstMeasure[firstMeasure.length - 1];
    expect(last.rest?.type).to.equal(RestType.Rest);
    expect(last.duration).to.deep.equal({ numerator: 1, denominator: 4 });
  });

  it("pads to the longest voice when the last voice read ends early", () => {
    // Because OSMD sets the measure's Duration from the last voice it read,
    // this measure reports 3/4 although voice 1 fills the whole measure.
    const xml = scoreXml([
      `${note("C", 4, 1, "whole")}`,
      `${note("D", 2, 1, "half")}${note("E", 2, 1, "half")}<backup><duration>4</duration></backup>${note("F", 1, 2)}${note("G", 2, 2, "half")}`,
    ]);
    const tune = importXml(xml);
    const measure = measuresOf(staffSystems(tune)[0].staff[0].voices[1])[1];
    expect(durationSum(measure)).to.equal(1);
  });

  it("drops a voice that only contains rests", () => {
    const xml = scoreXml([`${note("C", 4, 1, "whole")}<backup><duration>4</duration></backup>${rest(4, 2)}`]);
    const tune = importXml(xml);
    const staff = staffSystems(tune)[0].staff[0];
    expect(staff.voices).to.have.length(1);
    expect(tune.voiceNum).to.equal(1);
    const text = tuneToAbcText(tune, new ABCContext());
    expect(text).to.not.contain("V:2");
  });

  it("drops a staff whose voices only contain rests, together with its brace", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <note><rest/><duration>4</duration><voice>5</voice><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;
    const tune = importXml(xml);
    const staves = staffSystems(tune)[0].staff;
    expect(staves).to.have.length(1);
    expect(staves[0].brace).to.equal(undefined);
    expect(tune.staffNum).to.equal(1);
  });

  it("does not pad a pickup measure to a full measure", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="0" implicit="yes">${ATTRIBUTES_4_4}${note("G", 1)}</measure>
    <measure number="1">${note("C", 4, 1, "whole")}</measure>
  </part>
</score-partwise>`;
    const tune = importXml(xml);
    const pickup = measuresOf(staffSystems(tune)[0].staff[0].voices[0])[0];
    expect(pickup).to.have.length(1);
    expect(pickup[0].rest).to.equal(undefined);
  });

  it("keeps one voice for a score that only contains rests", () => {
    const xml = scoreXml([rest(4)]);
    const tune = importXml(xml);
    expect(staffSystems(tune)[0].staff).to.have.length(1);
    expect(staffSystems(tune)[0].staff[0].voices).to.have.length(1);
  });

  it("keeps the staff attributes when the first voice is dropped", () => {
    const xml = scoreXml([`${rest(4, 1)}<backup><duration>4</duration></backup>${note("E", 4, 2, "whole")}`]);
    const tune = importXml(xml);
    const voice = staffSystems(tune)[0].staff[0].voices[0];
    expect(voice.some((e) => e.el_type === ElementType.Key)).to.equal(true);
  });
});

export { measuresOf, durationSum, staffSystems, scoreXml, note, rest };
