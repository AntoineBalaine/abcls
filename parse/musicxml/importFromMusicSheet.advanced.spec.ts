import { expect } from "chai";
import * as fc from "fast-check";
import { ABCContext } from "../parsers/Context";
import { tuneToAbcText } from "../tuneToAst";
import { ClefElement, ClefType, ElementType, isMusicLine, MeterElement, MeterType, NoteElement, VoiceElement } from "../types/abcjs-ast";
import { parseMusicXmlToSheet } from "./parseMusicXml";
import { importTune } from "./testSupport/unwrap";

const CHORD_TIE_SLUR_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Music</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>2</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>2</duration>
        <type>quarter</type>
        <tie type="start"/>
        <notations><tied type="start"/><slur type="start" number="1"/></notations>
      </note>
      <note>
        <chord/>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>2</duration>
        <type>quarter</type>
      </note>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>2</duration>
        <type>quarter</type>
        <tie type="stop"/>
        <notations><tied type="stop"/><slur type="stop" number="1"/></notations>
      </note>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>2</duration>
        <type>quarter</type>
      </note>
    </measure>
  </part>
</score-partwise>`;

const TWO_VOICE_XML = `<?xml version="1.0" encoding="UTF-8"?>
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
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
        <voice>1</voice>
      </note>
      <backup><duration>4</duration></backup>
      <note>
        <pitch><step>C</step><octave>3</octave></pitch>
        <duration>4</duration>
        <type>whole</type>
        <voice>2</voice>
      </note>
    </measure>
  </part>
</score-partwise>`;

const TRIPLET_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Music</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>6</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>2</duration>
        <type>eighth</type>
        <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>
        <notations><tuplet type="start" number="1"/></notations>
      </note>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>2</duration>
        <type>eighth</type>
        <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>
      </note>
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>2</duration>
        <type>eighth</type>
        <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>
        <notations><tuplet type="stop" number="1"/></notations>
      </note>
    </measure>
  </part>
</score-partwise>`;

function noteElements(voice: VoiceElement[]): NoteElement[] {
  return voice.filter((e): e is NoteElement => e.el_type === ElementType.Note);
}

describe("importFromMusicSheet: chords, ties, slurs", () => {
  it("marks the chord's first note only, ties across the barline-free repeat, and pairs the slur", () => {
    const sheet = parseMusicXmlToSheet(CHORD_TIE_SLUR_XML);
    const tune = importTune(sheet);
    const system = tune.systems[0];
    if (!isMusicLine(system)) throw new Error("expected music line");
    const notes = noteElements(system.staff[0].voices[0]);

    // First element is the C-E chord (two pitches in one NoteElement)
    const chordEl = notes[0];
    expect(chordEl.pitches?.length).to.equal(2);
    expect(chordEl.pitches?.[0].startTie).to.not.be.undefined;
    expect(chordEl.pitches?.[0].startSlur?.length).to.equal(1);
    // The chord's second pitch (E) carries no tie/slur of its own
    expect(chordEl.pitches?.[1].startTie).to.be.undefined;

    // Third note-element is the tied-to C, closing both the tie and the slur
    const secondC = notes[1];
    expect(secondC.pitches?.[0].endTie).to.not.be.undefined;
    expect(secondC.pitches?.[0].endSlur?.length).to.equal(1);
    expect(secondC.pitches?.[0].endSlur?.[0]).to.equal(chordEl.pitches?.[0].startSlur?.[0].label);
  });
});

describe("importFromMusicSheet: multiple voices", () => {
  it("splits backed-up voices into separate voice arrays on the same staff", () => {
    const sheet = parseMusicXmlToSheet(TWO_VOICE_XML);
    const tune = importTune(sheet);
    const system = tune.systems[0];
    if (!isMusicLine(system)) throw new Error("expected music line");
    const staff = system.staff[0];
    expect(staff.voices.length).to.equal(2);
    const v1notes = noteElements(staff.voices[0]);
    const v2notes = noteElements(staff.voices[1]);
    expect(v1notes[0].pitches?.[0].pitch).to.be.greaterThan(v2notes[0].pitches?.[0].pitch ?? 0);
  });
});

describe("importFromMusicSheet: tuplets", () => {
  it("marks the first and last note of a triplet with matching multiplier and count", () => {
    const sheet = parseMusicXmlToSheet(TRIPLET_XML);
    const tune = importTune(sheet);
    const system = tune.systems[0];
    if (!isMusicLine(system)) throw new Error("expected music line");
    const notes = noteElements(system.staff[0].voices[0]);
    expect(notes.length).to.equal(3);
    expect(notes[0].startTriplet).to.equal(3);
    expect(notes[0].tripletR).to.equal(3);
    expect(notes[0].tripletMultiplier).to.be.closeTo(2 / 3, 1e-9);
    expect(notes[1].startTriplet).to.be.undefined;
    expect(notes[2].endTriplet).to.equal(true);
  });
});

describe("importFromMusicSheet: clef and meter symbol regressions", () => {
  it("distinguishes a tenor C-clef (line 4) from an alto C-clef (line 3)", () => {
    const tenorXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Cello</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>C</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;
    const sheet = parseMusicXmlToSheet(tenorXml);
    const tune = importTune(sheet);
    const system = tune.systems[0];
    if (!isMusicLine(system)) throw new Error("expected music line");
    const clefEl = system.staff[0].voices[0].find((e): e is ClefElement => e.el_type === ElementType.Clef);
    expect(clefEl?.type).to.equal(ClefType.Tenor);
  });

  it("maps a cut-time symbol to MeterType.CutTime, not a plain specified meter", () => {
    const cutTimeXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
        <time symbol="cut"><beats>2</beats><beat-type>2</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>
    </measure>
  </part>
</score-partwise>`;
    const sheet = parseMusicXmlToSheet(cutTimeXml);
    const tune = importTune(sheet);
    const system = tune.systems[0];
    if (!isMusicLine(system)) throw new Error("expected music line");
    const meterEl = system.staff[0].voices[0].find((e): e is MeterElement => e.el_type === ElementType.Meter);
    expect(meterEl?.type).to.equal(MeterType.CutTime);
  });
});

/**
 * Builds a one-measure score in the given key, from notes written as [step, alter, octave, displayed accidental].
 */
function oneMeasureXml(fifths: number, notes: Array<[string, number, number, string | null]>): string {
  const body = notes
    .map(
      ([step, alter, octave, shown]) =>
        `<note><pitch><step>${step}</step>${alter !== 0 ? `<alter>${alter}</alter>` : ""}<octave>${octave}</octave></pitch>` +
        `<duration>1</duration><voice>1</voice><type>quarter</type>${shown !== null ? `<accidental>${shown}</accidental>` : ""}</note>`
    )
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>M</part-name></score-part></part-list>` +
    `<part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>${fifths}</fifths></key>` +
    `<time><beats>${notes.length}</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${body}</measure></part></score-partwise>`
  );
}

function importedBody(xml: string): string {
  const text = tuneToAbcText(importTune(parseMusicXmlToSheet(xml)), new ABCContext());
  return text
    .split("\n")
    .filter((line) => line.includes("|"))[0]
    .trim();
}

describe("importFromMusicSheet: written accidentals", () => {
  it("writes a natural on a note that the key signature would otherwise sharpen", () => {
    // The F has no <accidental> element: its <alter> of 0 alone says that it is natural.
    expect(
      importedBody(
        oneMeasureXml(1, [
          ["F", 0, 4, null],
          ["G", 0, 4, null],
        ])
      )
    ).to.equal("=F2 G2 |");
  });

  it("leaves out the accidental that the key signature or the bar already gives", () => {
    expect(
      importedBody(
        oneMeasureXml(1, [
          ["F", 1, 4, null],
          ["F", 1, 4, null],
        ])
      )
    ).to.equal("F2 F2 |");
    expect(
      importedBody(
        oneMeasureXml(0, [
          ["F", 1, 4, "sharp"],
          ["F", 1, 4, null],
          ["F", 0, 4, "natural"],
        ])
      )
    ).to.equal("^F2 F2 =F2 |");
  });

  it("gives back the alteration of every note when the ABC is read with its key and bar accidentals", () => {
    const letters = ["C", "D", "E", "F", "G", "A", "B"];
    const noteArb = fc.tuple(fc.constantFrom(...letters), fc.constantFrom(-1, 0, 0, 1), fc.constantFrom(4, 5));
    fc.assert(
      fc.property(fc.constantFrom(-3, -1, 0, 2, 4), fc.array(noteArb, { minLength: 1, maxLength: 6 }), (fifths, notes) => {
        const tune = importTune(
          parseMusicXmlToSheet(
            oneMeasureXml(
              fifths,
              notes.map(([s, a, o]) => [s, a, o, null])
            )
          )
        );
        const system = tune.systems[0];
        if (!isMusicLine(system)) throw new Error("expected music line");
        const keyAlter = (letter: string): number => {
          const sharps = "FCGDAEB".slice(0, Math.max(0, fifths));
          const flats = "BEADGCF".slice(0, Math.max(0, -fifths));
          return sharps.includes(letter) ? 1 : flats.includes(letter) ? -1 : 0;
        };
        const ALTER: Record<string, number> = { sharp: 1, flat: -1, natural: 0 };
        const bar = new Map<number, number>();
        const read = noteElements(system.staff[0].voices[0]).map((element) => {
          const pitch = element.pitches![0];
          if (pitch.accidental !== undefined) bar.set(pitch.pitch, ALTER[pitch.accidental]);
          return bar.get(pitch.pitch) ?? keyAlter(letters[((pitch.pitch % 7) + 7) % 7]);
        });
        expect(read).to.deep.equal(notes.map(([, alter]) => alter));
      }),
      { numRuns: 80 }
    );
  });
});

describe("importFromMusicSheet: tuplet lengths", () => {
  it("keeps the written length of a tuplet note, so that the ratio applies only once", () => {
    const tune = importTune(parseMusicXmlToSheet(TRIPLET_XML));
    const system = tune.systems[0];
    if (!isMusicLine(system)) throw new Error("expected music line");
    const notes = noteElements(system.staff[0].voices[0]);
    expect(notes.map((note) => note.duration.numerator / note.duration.denominator)).to.deep.equal([1 / 8, 1 / 8, 1 / 8]);
    const text = tuneToAbcText(tune, new ABCContext());
    expect(text).to.contain("(3:2:3C D E");
  });
});
