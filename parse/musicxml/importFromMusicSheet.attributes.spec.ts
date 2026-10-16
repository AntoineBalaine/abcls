import { readFileSync } from "fs";
import { join } from "path";
import * as abcjs from "abcjs";
import { expect } from "chai";
import * as fc from "fast-check";
import { SemanticAnalyzer } from "../analyzers/semantic-analyzer";
import { TuneInterpreter } from "../interpreter/TuneInterpreter";
import { ABCContext } from "../parsers/Context";
import { AbcErrorReporter } from "../parsers/ErrorReporter";
import { parse } from "../parsers/parse";
import { Scanner } from "../parsers/scan";
import { tuneToAbcText } from "../tuneToAst";
import { ClefType, ElementType, KeyElement, MeterElement, StaffSystem, Tune, VoiceElement } from "../types/abcjs-ast";
import { importFromMusicSheet } from "./importFromMusicSheet";
import { staffSystems } from "./importFromMusicSheet.padding.spec";
import { parseMusicXmlToSheet } from "./testSupport/parseMusicXml";

const CLEF_XML: Record<string, string> = {
  treble: "<sign>G</sign><line>2</line>",
  bass: "<sign>F</sign><line>4</line>",
  alto: "<sign>C</sign><line>3</line>",
};

interface StaffSpec {
  clef: string;
  voices: number[];
}

/**
 * Builds a one-part score whose staves are described by `staves`, with
 * `measureCount` measures of whole notes in every voice. `changes` maps a
 * measure index to extra <attributes> content (clef, key or time changes).
 */
/** Returns the <type> (and <dot/>) of a note that lasts `beats` quarter notes. */
function noteTypeXml(beats: number): string {
  if (beats === 4) return "<type>whole</type>";
  if (beats === 3) return "<type>half</type><dot/>";
  if (beats === 2) return "<type>half</type>";
  return "<type>quarter</type>";
}

function partXml(staves: StaffSpec[], measureCount: number, changes: Record<number, string> = {}, beatsByMeasure: number[] = []): string {
  const measures: string[] = [];
  for (let m = 0; m < measureCount; m++) {
    const beats = beatsByMeasure[m] ?? 4;
    const clefs = staves.map((s, i) => `<clef number="${i + 1}">${CLEF_XML[s.clef]}</clef>`).join("");
    const head =
      m === 0
        ? `<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>${staves.length}</staves>${clefs}</attributes>`
        : changes[m]
          ? `<attributes>${changes[m]}</attributes>`
          : "";
    const notes: string[] = [];
    staves.forEach((staff, staffIndex) => {
      for (const voice of staff.voices) {
        if (notes.length > 0) notes.push(`<backup><duration>${beats}</duration></backup>`);
        const octave = staff.clef === "bass" ? 3 : 4;
        notes.push(
          `<note><pitch><step>C</step><octave>${octave}</octave></pitch><duration>${beats}</duration><voice>${voice}</voice>${noteTypeXml(beats)}<staff>${staffIndex + 1}</staff></note>`
        );
      }
    });
    measures.push(`<measure number="${m + 1}">${head}${notes.join("")}</measure>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">${measures.join("")}</part>
</score-partwise>`;
}

/** Two single-staff parts, so that the staves are not braced together. */
function singleStaffPartXml(id: string, clef: string, octave: number): string {
  return `<part id="${id}"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef>${CLEF_XML[clef]}</clef></attributes><note><pitch><step>C</step><octave>${octave}</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type></note></measure></part>`;
}

function twoPartsXml(clefs: [string, string]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>A</part-name></score-part><score-part id="P2"><part-name>B</part-name></score-part></part-list>
  ${singleStaffPartXml("P1", clefs[0], 4)}${singleStaffPartXml("P2", clefs[1], 3)}
</score-partwise>`;
}

function convert(xml: string): { tune: Tune; text: string } {
  const tune = importFromMusicSheet(parseMusicXmlToSheet(xml));
  return { tune, text: tuneToAbcText(tune, new ABCContext()) };
}

function headerOf(text: string): string[] {
  const lines = text.split("\n");
  return lines.slice(0, lines.findIndex((l) => l.startsWith("K:")) + 1);
}

/** Returns the music line that follows the `V:<id>` marker in the body. */
function bodyLineOf(text: string, voiceId: string): string {
  const lines = text.split("\n");
  const body = lines.slice(lines.findIndex((l) => l.startsWith("K:")) + 1);
  return body[body.indexOf(`V:${voiceId}`) + 1];
}

function interpretABC(abc: string): Tune {
  const ctx = new ABCContext(new AbcErrorReporter());
  const ast = parse(Scanner(abc, ctx), ctx);
  const analyzer = new SemanticAnalyzer(ctx);
  ast.accept(analyzer);
  return new TuneInterpreter(analyzer, ctx, abc).interpretFile(ast).tunes[0];
}

describe("importFromMusicSheet staff attributes", () => {
  it("copies a mid-tune clef change into every voice of the staff, as distinct objects", () => {
    const xml = partXml(
      [
        { clef: "treble", voices: [1, 2] },
        { clef: "bass", voices: [5] },
      ],
      2,
      { 1: `<clef number="1">${CLEF_XML.bass}</clef>` }
    );
    const { tune } = convert(xml);
    const voices = staffSystems(tune)[0].staff[0].voices;
    const clefChanges = voices.map((voice) => voice.filter((e) => e.el_type === ElementType.Clef && (e as { type: ClefType }).type === ClefType.Bass));
    expect(clefChanges[0]).to.have.length(1);
    expect(clefChanges[1]).to.have.length(1);
    expect(clefChanges[0][0]).to.not.equal(clefChanges[1][0]);
  });

  it("keeps the written time signature instead of reducing it", () => {
    const xml = partXml([{ clef: "treble", voices: [1] }], 1).replace("<beats>4</beats><beat-type>4</beat-type>", "<beats>6</beats><beat-type>8</beat-type>");
    const { tune, text } = convert(
      xml.replace(/<duration>4<\/duration>/g, "<duration>3</duration>").replace(/<type>whole<\/type>/g, "<type>half</type><dot/>")
    );
    expect((tune.systems[0] as StaffSystem).staff[0].meter?.value?.[0]).to.deep.equal({ numerator: 6, denominator: 8 });
    expect(text).to.contain("M:6/8");
  });
});

describe("tuneToAbcText clefs and staff grouping", () => {
  it("writes the staff clef on the V: lines, leaving treble implicit", () => {
    const { text } = convert(twoPartsXml(["treble", "bass"]));
    const header = headerOf(text);
    expect(header).to.include("V:1");
    expect(header.some((l) => /^V:\S+ clef=bass$/.test(l))).to.equal(true);
  });

  it("writes the clef of a single non-treble voice on its V: line", () => {
    const { text } = convert(partXml([{ clef: "bass", voices: [1] }], 1));
    expect(headerOf(text)).to.include("V:1 clef=bass");
  });

  it("groups voices that share a staff", () => {
    const { text } = convert(
      twoPartsXml(["treble", "bass"]).replace(
        "</note></measure></part><part",
        `</note><backup><duration>4</duration></backup><note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>2</voice><type>whole</type></note></measure></part><part`
      )
    );
    const score = headerOf(text).find((l) => l.startsWith("%%score"));
    expect(score).to.match(/^%%score \(1 2\) \S+$/);
  });

  it("braces the staves of a piano part", () => {
    const { text } = convert(
      partXml(
        [
          { clef: "treble", voices: [1, 2] },
          { clef: "bass", voices: [5, 6, 7] },
        ],
        1
      )
    );
    expect(headerOf(text)).to.include("%%score {(1 2) | (5 6 7)}");
  });

  it("writes no %%score for unbraced staves with one voice each", () => {
    const { text } = convert(twoPartsXml(["treble", "bass"]));
    expect(text).to.not.contain("%%score");
  });

  it("writes a mid-tune clef change as an inline field in every voice of the staff", () => {
    const xml = partXml(
      [
        { clef: "treble", voices: [1, 2] },
        { clef: "bass", voices: [5] },
      ],
      3,
      { 2: `<clef number="1">${CLEF_XML.bass}</clef>` }
    );
    const { text } = convert(xml);
    for (const id of ["1", "2"]) expect(bodyLineOf(text, id)).to.match(/\| \[K:clef=bass\] C,?8 \|$/);
    expect(bodyLineOf(text, "5")).to.not.contain("[K:");
  });

  it("writes key and meter changes, and nothing for a repeated identical meter", () => {
    const xml = partXml([{ clef: "treble", voices: [1] }], 4, {
      1: "<key><fifths>2</fifths></key>",
      2: "<time><beats>4</beats><beat-type>4</beat-type></time>",
      3: "<time><beats>3</beats><beat-type>4</beat-type></time>",
    }).replace(/(<measure number="4">.*?)<duration>4<\/duration>(.*?)<type>whole<\/type>/, "$1<duration>3</duration>$2<type>half</type><dot/>");
    const { text } = convert(xml);
    const body = text
      .split("\n")
      .slice(text.split("\n").findIndex((l) => l.startsWith("K:")) + 1)
      .join("\n");
    expect(body).to.contain("[K:D");
    expect(body).to.contain("[M:3/4]");
    expect(body.match(/\[M:/g)).to.have.length(1);
  });

  it("writes no inline field at the start of a voice that matches the header", () => {
    const { text } = convert(
      partXml(
        [
          { clef: "treble", voices: [1] },
          { clef: "bass", voices: [5] },
        ],
        2
      )
    );
    expect(text).to.not.contain("[K:");
    expect(text).to.not.contain("[M:");
  });
});

type AttributeChange = { kind: "meter"; value: number } | { kind: "key"; value: number };

/**
 * Lists the meter and key elements of a voice as "M<numerator>/<denominator>"
 * and "K<root><acc><mode>", so that keys with the same number of
 * accidentals (G major and F major) remain distinct.
 */
function attributeSequence(voice: VoiceElement[]): string[] {
  const out: string[] = [];
  for (const element of voice) {
    if (element.el_type === ElementType.Meter) {
      const value = (element as MeterElement).value?.[0];
      out.push(`M${value?.numerator}/${value?.denominator}`);
    } else if (element.el_type === ElementType.Key) {
      const key = element as KeyElement;
      out.push(`K${key.root}${key.acc}${key.mode}`);
    }
  }
  return out;
}

/** Returns the first key and the first meter of a sequence, keyed by "K" and "M". */
function initialAttributeState(sequence: string[]): Record<string, string> {
  const state: Record<string, string> = {};
  for (const item of sequence) if (state[item[0]] === undefined) state[item[0]] = item;
  return state;
}

/** Keeps only the items that change the key or the meter in effect. */
function changesFrom(sequence: string[], initial: Record<string, string>): string[] {
  const state = { ...initial };
  const out: string[] = [];
  for (const item of sequence) {
    if (state[item[0]] === item) continue;
    state[item[0]] = item;
    out.push(item);
  }
  return out;
}

/** Generates a sequence of optional meter or key changes, one per measure after the first. */
function genAttributeChanges(fifthsChoices: number[]): fc.Arbitrary<Array<AttributeChange | undefined>> {
  const genChange = fc.oneof(
    fc.constantFrom(2, 3, 4).map((beats): AttributeChange => ({ kind: "meter", value: beats })),
    fc.constantFrom(...fifthsChoices).map((fifths): AttributeChange => ({ kind: "key", value: fifths }))
  );
  return fc.array(fc.option(genChange, { nil: undefined }), { minLength: 1, maxLength: 6 });
}

/**
 * Imports a single-voice score with the given changes, converts it to ABC,
 * re-interprets the text, and compares the key and meter changes.
 */
function checkAttributeRoundTrip(changes: Array<AttributeChange | undefined>): void {
  const changeXml: Record<number, string> = {};
  const beatsByMeasure: number[] = [4];
  let beats = 4;
  changes.forEach((change, i) => {
    if (change?.kind === "meter") {
      changeXml[i + 1] = `<time><beats>${change.value}</beats><beat-type>4</beat-type></time>`;
      beats = change.value;
    } else if (change?.kind === "key") {
      changeXml[i + 1] = `<key><fifths>${change.value}</fifths></key>`;
    }
    beatsByMeasure.push(beats);
  });
  const { tune, text } = convert(partXml([{ clef: "treble", voices: [1] }], changes.length + 1, changeXml, beatsByMeasure));
  const sourceSequence = attributeSequence(staffSystems(tune)[0].staff[0].voices[0]);
  const roundTripSequence = attributeSequence(staffSystems(interpretABC(text)).flatMap((s) => s.staff[0].voices[0]));
  // Because the header states the initial key and meter, which the
  // interpreter does not repeat as elements, both sequences are compared as
  // changes relative to that initial state.
  const initial = initialAttributeState(sourceSequence);
  expect(changesFrom(roundTripSequence, initial), text).to.deep.equal(changesFrom(sourceSequence, initial));
}

const genStaves = fc
  .array(fc.record({ clef: fc.constantFrom("treble", "bass", "alto"), voiceCount: fc.integer({ min: 1, max: 3 }) }), { minLength: 1, maxLength: 3 })
  .map((staves): StaffSpec[] => {
    let next = 1;
    return staves.map((s) => ({ clef: s.clef, voices: Array.from({ length: s.voiceCount }, () => next++) }));
  });

function clefOfVoice(tune: Tune, voiceIndexGlobal: number): ClefType | undefined {
  const system = staffSystems(tune)[0];
  let index = 0;
  for (const staff of system.staff) {
    for (let v = 0; v < staff.voices.length; v++) {
      if (index === voiceIndexGlobal) return staff.clef?.type;
      index++;
    }
  }
  return undefined;
}

describe("tuneToAbcText clef and attribute properties", () => {
  it("gives every voice the clef of its source staff after a round trip", () => {
    fc.assert(
      fc.property(genStaves, (staves) => {
        const { text } = convert(partXml(staves, 1));
        const reparsed = interpretABC(text);
        const expected = staves.flatMap((s) => s.voices.map(() => s.clef));
        const actual = expected.map((_, i) => clefOfVoice(reparsed, i));
        expect(actual, text).to.deep.equal(expected);
      }),
      { numRuns: 40 }
    );
  });

  it("lists every voice exactly once in %%score when the directive is present", () => {
    fc.assert(
      fc.property(genStaves, (staves) => {
        const { text } = convert(partXml(staves, 1));
        const score = text.split("\n").find((l) => l.startsWith("%%score"));
        if (!score) return;
        const ids = score.replace("%%score", "").match(/\d+/g) ?? [];
        const expected = staves.flatMap((s) => s.voices.map(String));
        expect([...ids].sort(), text).to.deep.equal([...expected].sort());
      }),
      { numRuns: 40 }
    );
  });

  it("preserves the sequence of meter and key changes of a voice", () => {
    fc.assert(fc.property(genAttributeChanges([0, 1, 2, 3, 6, -1, -2, -3, -6]), checkAttributeRoundTrip), { numRuns: 60 });
  });
});

describe("importFromMusicSheet voice ids", () => {
  it("keeps the voices of two parts separate when both are numbered 1", () => {
    const { tune, text } = convert(twoPartsXml(["treble", "bass"]));
    const ids = staffSystems(tune)[0].staff.map((staff) => staff.voiceIds?.[0]);
    expect(ids).to.deep.equal(["1", "1_2"]);
    expect(bodyLineOf(text, "1")).to.equal("C8 |");
    expect(bodyLineOf(text, "1_2")).to.equal("C,8 |");
  });
});

describe("xml2abc end to end on an OMR-shaped excerpt", () => {
  const fixture = readFileSync(join(__dirname, "schema", "testFixtures", "omrPianoExcerpt.musicxml"), "utf8");
  const tune = importFromMusicSheet(parseMusicXmlToSheet(fixture));
  const text = tuneToAbcText(tune, new ABCContext(), { lineBreaks: { mode: "source", fallbackBarsPerLine: 4 } });

  it("groups the staves, writes the bass clef and drops the rest-only voice", () => {
    const header = headerOf(text);
    expect(header).to.include("%%score {(1 2) | 5}");
    expect(header).to.include("V:5 clef=bass");
    expect(text).to.not.contain("V:6");
  });

  it("follows the source's systems and keeps the beams and the clef change", () => {
    const body = text.split("\n").slice(text.split("\n").findIndex((l) => l.startsWith("K:")) + 1);
    expect(body.filter((l) => l.startsWith("V:"))).to.deep.equal(["V:1", "V:2", "V:5", "V:1", "V:2", "V:5"]);
    expect(text).to.contain("c_BG");
    expect(text).to.contain("[K:clef=treble]");
    expect(text).to.contain("z4");
  });

  it("parses without errors in abcls and without warnings in abcjs", () => {
    const reporter = new AbcErrorReporter();
    const ctx = new ABCContext(reporter);
    parse(Scanner(text, ctx), ctx);
    expect(reporter.getErrors()).to.deep.equal([]);
    expect(abcjs.parseOnly(text)[0].warnings ?? []).to.deep.equal([]);
  });
});
