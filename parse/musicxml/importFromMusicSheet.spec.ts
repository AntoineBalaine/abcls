import { expect } from "chai";
import { AccidentalType, ClefType, ElementType, isMusicLine, Mode, RestType } from "../types/abcjs-ast";
import { importFromMusicSheet, stepOctaveToDiatonic } from "./importFromMusicSheet";
import { diatonicToStepOctave } from "./normalize";
import { parseMusicXmlToSheet } from "./testSupport/parseMusicXml";

const SINGLE_VOICE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Music</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
      <note>
        <pitch><step>D</step><octave>4</octave><alter>-1</alter></pitch>
        <duration>1</duration>
        <type>quarter</type>
        <accidental>flat</accidental>
      </note>
      <note>
        <rest/>
        <duration>2</duration>
        <type>half</type>
      </note>
    </measure>
    <measure number="2">
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
    </measure>
  </part>
</score-partwise>`;

describe("importFromMusicSheet", () => {
  it("maps a single-voice score into a Tune with the expected pitches, durations, and rest", () => {
    const sheet = parseMusicXmlToSheet(SINGLE_VOICE_XML);
    const tune = importFromMusicSheet(sheet);

    expect(tune.systems.length).to.equal(1);
    const system = tune.systems[0];
    if (!isMusicLine(system)) throw new Error("expected a music line");
    expect(system.staff.length).to.equal(1);
    const staff = system.staff[0];
    expect(staff.voices.length).to.equal(1);

    const elements = staff.voices[0];
    const clefEl = elements.find((e) => e.el_type === ElementType.Clef);
    expect(clefEl && "type" in clefEl ? clefEl.type : undefined).to.equal(ClefType.Treble);
    const keyEl = elements.find((e) => e.el_type === ElementType.Key);
    expect(keyEl && "mode" in keyEl ? keyEl.mode : undefined).to.equal(Mode.Major);

    const notes = elements.filter((e) => e.el_type === ElementType.Note);
    expect(notes.length).to.equal(4);

    const cNote = notes[0];
    if (!("pitches" in cNote) || !cNote.pitches) throw new Error("expected pitches");
    expect(cNote.pitches[0].pitch).to.equal(stepOctaveToDiatonic(0, 4));
    expect(cNote.pitches[0].accidental).to.be.undefined;

    const dFlatNote = notes[1];
    if (!("pitches" in dFlatNote) || !dFlatNote.pitches) throw new Error("expected pitches");
    expect(dFlatNote.pitches[0].pitch).to.equal(stepOctaveToDiatonic(1, 4));
    expect(dFlatNote.pitches[0].accidental).to.equal(AccidentalType.Flat);

    const restNote = notes[2];
    if (!("rest" in restNote) || !restNote.rest) throw new Error("expected a rest");
    expect(restNote.rest.type).to.equal(RestType.Rest);
    expect(restNote.duration).to.deep.equal({ numerator: 1, denominator: 2 });

    const eNote = notes[3];
    if (!("pitches" in eNote) || !eNote.pitches) throw new Error("expected pitches");
    expect(eNote.pitches[0].pitch).to.equal(stepOctaveToDiatonic(2, 4));
    expect(eNote.duration).to.deep.equal({ numerator: 1, denominator: 1 });

    const bars = elements.filter((e) => e.el_type === ElementType.Bar);
    expect(bars.length).to.equal(2);
  });

  it("maps stepOctaveToDiatonic as the exact inverse of phase 1's diatonicToStepOctave across octaves", () => {
    for (let pitchNumber = -14; pitchNumber <= 14; pitchNumber++) {
      const { step, octave } = diatonicToStepOctave(pitchNumber);
      const stepIndex = ["C", "D", "E", "F", "G", "A", "B"].indexOf(step);
      expect(stepOctaveToDiatonic(stepIndex, octave)).to.equal(pitchNumber);
    }
  });
});
