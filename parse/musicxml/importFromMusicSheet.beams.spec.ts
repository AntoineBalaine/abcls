import { expect } from "chai";
import { ABCContext } from "../parsers/Context";
import { tuneToAbcText } from "../tuneToAst";
import { ElementType, NoteElement, StaffSystem, Tune } from "../types/abcjs-ast";
import { importFromMusicSheet } from "./importFromMusicSheet";
import { parseMusicXmlToSheet } from "./testSupport/parseMusicXml";

const ATTRIBUTES = `<attributes>
        <divisions>2</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>`;

function eighth(step: string, beam?: string, extra = ""): string {
  const beamXml = beam ? `<beam number="1">${beam}</beam>` : "";
  return `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type>${beamXml}${extra}</note>`;
}

function chordEighth(steps: string[], beam: string): string {
  return steps
    .map(
      (step, i) =>
        `<note>${i > 0 ? "<chord/>" : ""}<pitch><step>${step}</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><beam number="1">${beam}</beam></note>`
    )
    .join("");
}

function tupletEighth(step: string, beam: string, type: string): string {
  const notations = type ? `<notations><tuplet type="${type}"/></notations>` : "";
  return `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><beam number="1">${beam}</beam>${notations}</note>`;
}

function beamedRest(duration: number, beam: string): string {
  return `<note><rest/><duration>${duration}</duration><voice>1</voice><type>eighth</type><beam number="1">${beam}</beam></note>`;
}

function quarter(step: string): string {
  return `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type></note>`;
}

function restXml(duration: number): string {
  return `<note><rest/><duration>${duration}</duration><voice>1</voice></note>`;
}

function scoreXml(measures: string[]): string {
  const body = measures.map((content, i) => `<measure number="${i + 1}">${i === 0 ? ATTRIBUTES : ""}${content}</measure>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">${body}</part>
</score-partwise>`;
}

function convert(xml: string): { tune: Tune; body: string } {
  const tune = importFromMusicSheet(parseMusicXmlToSheet(xml));
  const text = tuneToAbcText(tune, new ABCContext());
  const lines = text.slice(text.indexOf("K:")).split("\n").slice(1);
  const body = lines
    .filter((line) => !line.startsWith("V:"))
    .join("\n")
    .trim();
  return { tune, body };
}

function notesOf(tune: Tune): NoteElement[] {
  const voice = (tune.systems[0] as StaffSystem).staff[0].voices[0];
  return voice.filter((e): e is NoteElement => e.el_type === ElementType.Note && !!(e as NoteElement).pitches);
}

describe("importFromMusicSheet beaming", () => {
  it("writes a beamed group without separating spaces", () => {
    const { tune, body } = convert(
      scoreXml([`${eighth("C", "begin")}${eighth("B", "continue")}${eighth("G", "end")}${eighth("E")}${quarter("C")}${quarter("D")}`])
    );
    expect(body).to.equal("cbg e c2 d2 |");
    const notes = notesOf(tune);
    expect(notes[0].startBeam).to.equal(true);
    expect(notes[2].endBeam).to.equal(true);
    expect(notes[3].startBeam).to.equal(undefined);
  });

  it("separates two consecutive groups with a space", () => {
    const groups = `${eighth("C", "begin")}${eighth("B", "continue")}${eighth("G", "end")}${eighth("B", "begin")}${eighth("G", "continue")}${eighth("D", "end")}`;
    const { body } = convert(scoreXml([`${groups}${quarter("C")}`]));
    expect(body).to.equal("cbg bgd c2 |");
  });

  it("beams chords", () => {
    const { body } = convert(scoreXml([`${chordEighth(["C", "E"], "begin")}${chordEighth(["D", "F"], "end")}${quarter("C")}${quarter("C")}${quarter("C")}`]));
    expect(body).to.equal("[ce][df] c2 c2 c2 |");
  });

  it("keeps a tuplet marker attached to its beamed group", () => {
    const xml = scoreXml([
      `${tupletEighth("C", "begin", "start")}${tupletEighth("D", "continue", "")}${tupletEighth("E", "end", "stop")}${quarter("C")}${quarter("C")}`,
    ]).replace("<divisions>2</divisions>", "<divisions>6</divisions>");
    const fixed = xml.replace(/<duration>2<\/duration><voice>1<\/voice><type>quarter/g, "<duration>6</duration><voice>1</voice><type>quarter");
    const { body } = convert(fixed);
    // Because the existing tuplet serialization writes explicit rhythms, only the grouping is checked here.
    expect(body).to.match(/^\(3\S*c\S*d\S*e\S* c2 c2 \|$/);
  });

  it("keeps unbeamed eighths separated", () => {
    const { body } = convert(scoreXml([`${eighth("C")}${eighth("D")}${eighth("E")}${eighth("F")}${quarter("C")}${quarter("C")}`]));
    expect(body).to.equal("c d e f c2 c2 |");
  });

  it("splits a beam that crosses a bar line, leaving single-note segments unbeamed", () => {
    const measure1 = `${quarter("C")}${quarter("C")}${quarter("C")}${eighth("C")}${eighth("D", "begin")}`;
    const measure2 = `${eighth("E", "end")}${eighth("F")}${quarter("C")}${quarter("C")}${quarter("C")}`;
    const { tune, body } = convert(scoreXml([measure1, measure2]));
    expect(body).to.equal("c2 c2 c2 c d | e f c2 c2 c2 |");
    for (const n of notesOf(tune)) {
      expect(n.startBeam).to.equal(undefined);
      expect(n.endBeam).to.equal(undefined);
    }
  });

  it("starts a new group after a rest that is part of the beam", () => {
    const content = `${eighth("C", "begin")}${beamedRest(1, "continue")}${eighth("D", "continue")}${eighth("E", "end")}${quarter("F")}${quarter("G")}`;
    const { body } = convert(scoreXml([content]));
    expect(body).to.equal("c z de f2 g2 |");
  });

  it("starts a new group after a silent stretch inside the beam", () => {
    const content = `${eighth("C", "begin")}<forward><duration>1</duration><voice>1</voice></forward>${eighth("D", "continue")}${eighth("E", "end")}${quarter("F")}${quarter("G")}`;
    const { body } = convert(scoreXml([content]));
    expect(body).to.equal("c z de f2 g2 |");
  });

  it("closes a group at a rest", () => {
    const content = `${eighth("C", "begin")}${eighth("D", "continue")}${restXml(1)}${eighth("E", "end")}${quarter("C")}${quarter("C")}`;
    const { body } = convert(scoreXml([content]));
    expect(body).to.equal("cd z e c2 c2 |");
  });
});
