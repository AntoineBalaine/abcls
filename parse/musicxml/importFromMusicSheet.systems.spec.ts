import { expect } from "chai";
import * as fc from "fast-check";
import { ABCContext } from "../parsers/Context";
import { AbcErrorReporter } from "../parsers/ErrorReporter";
import { parse } from "../parsers/parse";
import { Scanner } from "../parsers/scan";
import { TuneToAbcLineBreaks, tuneToAbcText } from "../tuneToAst";
import { BarType, ElementType, isBarElement, NoteElement, Tune, VoiceElement } from "../types/abcjs-ast";
import { importFromMusicSheet } from "./importFromMusicSheet";
import { note, scoreXml, staffSystems } from "./importFromMusicSheet.padding.spec";
import { parseMusicXmlToSheet } from "./testSupport/parseMusicXml";

const NEW_SYSTEM = `<print new-system="yes"/>`;

function wholeNote(step: string, voice = 1): string {
  return note(step, 4, voice, "whole");
}

/** A measure with a whole note in voice 1 and, optionally, one in voice 2. */
function measure(step: string, twoVoices: boolean, newSystem = false): string {
  const second = twoVoices ? `<backup><duration>4</duration></backup>${wholeNote(step, 2)}` : "";
  return `${newSystem ? NEW_SYSTEM : ""}${wholeNote(step)}${second}`;
}

function importXml(xml: string): Tune {
  return importFromMusicSheet(parseMusicXmlToSheet(xml));
}

/** Returns the body lines of an ABC text, i.e. the lines after K: that are not V: markers. */
function musicLines(text: string): string[] {
  const lines = text.split("\n");
  return lines.slice(lines.findIndex((l) => l.startsWith("K:")) + 1).filter((l) => l.trim() !== "" && !l.startsWith("V:"));
}

function closingBars(line: string): number {
  return (line.match(/\|/g) ?? []).length;
}

const SOURCE: TuneToAbcLineBreaks = { mode: "source", fallbackBarsPerLine: 4 };

describe("importFromMusicSheet system breaks", () => {
  it("splits tune.systems at each <print new-system>", () => {
    const measures = ["C", "D", "E", "F", "G", "A"].map((step, i) => measure(step, false, i === 2 || i === 4));
    const tune = importXml(scoreXml(measures));
    const systems = staffSystems(tune);
    expect(systems).to.have.length(3);
    for (const system of systems) {
      expect(system.staff[0].voices[0].filter(isBarElement)).to.have.length(2);
    }
    expect(tune.lineNum).to.equal(3);
  });

  it("keeps a single system when the source has no <print new-system>", () => {
    const tune = importXml(scoreXml(["C", "D", "E"].map((s) => measure(s, false))));
    expect(staffSystems(tune)).to.have.length(1);
  });

  it("keeps the output without options identical to the concatenated form", () => {
    const withBreaks = importXml(scoreXml(["C", "D", "E", "F"].map((s, i) => measure(s, true, i === 2))));
    const withoutBreaks = importXml(scoreXml(["C", "D", "E", "F"].map((s) => measure(s, true))));
    expect(tuneToAbcText(withBreaks, new ABCContext())).to.equal(tuneToAbcText(withoutBreaks, new ABCContext()));
  });
});

describe("tuneToAbcText line breaks", () => {
  it("writes one line per source system in source mode", () => {
    const measures = ["C", "D", "E", "F", "G", "A"].map((step, i) => measure(step, false, i === 2 || i === 4));
    const lines = musicLines(tuneToAbcText(importXml(scoreXml(measures)), new ABCContext(), { lineBreaks: SOURCE }));
    expect(lines).to.have.length(3);
    for (const line of lines) expect(line.trim().endsWith("|")).to.equal(true);
  });

  it("falls back to a fixed number of bars when the source has a single system", () => {
    const measures = ["C", "D", "E", "F", "G", "A", "B", "C"].map((s) => measure(s, false));
    const lines = musicLines(tuneToAbcText(importXml(scoreXml(measures)), new ABCContext(), { lineBreaks: SOURCE }));
    expect(lines.map(closingBars)).to.deep.equal([4, 4]);
  });

  it("breaks every N bars in fixed mode, ignoring the source systems", () => {
    const measures = ["C", "D", "E", "F", "G", "A", "B", "C"].map((s, i) => measure(s, false, i === 3));
    const lines = musicLines(tuneToAbcText(importXml(scoreXml(measures)), new ABCContext(), { lineBreaks: { mode: "fixed", barsPerLine: 2 } }));
    expect(lines.map(closingBars)).to.deep.equal([2, 2, 2, 2]);
  });

  it("interleaves the voices system by system", () => {
    const measures = ["C", "D", "E", "F", "G", "A", "B", "C"].map((s) => measure(s, true));
    const text = tuneToAbcText(importXml(scoreXml(measures)), new ABCContext(), { lineBreaks: { mode: "fixed", barsPerLine: 4 } });
    const body = text.split("\n").slice(text.split("\n").findIndex((l) => l.startsWith("K:")) + 1);
    const markers = body.filter((l) => l.startsWith("V:"));
    expect(markers).to.deep.equal(["V:1", "V:2", "V:1", "V:2"]);
  });

  it("keeps a slur that crosses a system boundary balanced", () => {
    const slurred = (step: string, type: string) =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><notations><slur number="1" type="${type}"/></notations></note>`;
    const xml = scoreXml([slurred("C", "start"), `${NEW_SYSTEM}${slurred("D", "stop")}`]);
    const lines = musicLines(tuneToAbcText(importXml(xml), new ABCContext(), { lineBreaks: SOURCE }));
    expect(lines).to.have.length(2);
    expect(lines[0]).to.contain("(");
    expect(lines[1]).to.contain(")");
  });

  it("does not end a line at a left-repeat bar", () => {
    const repeatStart = `<barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>`;
    const measures = ["C", "D", "E", "F"].map((s, i) => `${i === 1 ? repeatStart : ""}${wholeNote(s)}`);
    const text = tuneToAbcText(importXml(scoreXml(measures)), new ABCContext(), { lineBreaks: { mode: "fixed", barsPerLine: 2 } });
    const lines = musicLines(text);
    expect(lines).to.have.length(2);
    expect(lines[0]).to.match(/C8 \|.*D8/);
  });
});

/**
 * Generated single-staff tunes with one or two voices, a random number of
 * whole-note measures, and random system starts.
 */
const genLayoutCase = fc.record({
  measureCount: fc.integer({ min: 1, max: 10 }),
  twoVoices: fc.boolean(),
  breakMask: fc.array(fc.boolean(), { minLength: 10, maxLength: 10 }),
  lineBreaks: fc.oneof(
    fc.integer({ min: 1, max: 5 }).map((n): TuneToAbcLineBreaks => ({ mode: "fixed", barsPerLine: n })),
    fc.integer({ min: 1, max: 5 }).map((n): TuneToAbcLineBreaks => ({ mode: "source", fallbackBarsPerLine: n }))
  ),
});

function buildLayoutTune(measureCount: number, twoVoices: boolean, breakMask: boolean[]): Tune {
  const steps = ["C", "D", "E", "F", "G", "A", "B"];
  const measures = Array.from({ length: measureCount }, (_, i) => measure(steps[i % 7], twoVoices, i > 0 && breakMask[i]));
  return importXml(scoreXml(measures));
}

/** Splits an ABC body into systems: each system is the list of music lines of its voices. */
function systemsOf(text: string, voiceCount: number): string[][] {
  const lines = musicLines(text);
  const systems: string[][] = [];
  for (let i = 0; i < lines.length; i += voiceCount) systems.push(lines.slice(i, i + voiceCount));
  return systems;
}

function pitchSequence(tune: Tune, voiceIndex: number): string[] {
  const out: string[] = [];
  for (const system of staffSystems(tune)) {
    const voice: VoiceElement[] = system.staff[0].voices[voiceIndex] ?? [];
    for (const e of voice) {
      if (e.el_type === ElementType.Note && (e as NoteElement).pitches) out.push(String((e as NoteElement).pitches![0].pitch));
      if (isBarElement(e) && e.type !== BarType.BarLeftRepeat) out.push("|");
    }
  }
  return out;
}

describe("tuneToAbcText line break properties", () => {
  it("gives every voice of a system the same number of closing bars", () => {
    fc.assert(
      fc.property(genLayoutCase, ({ measureCount, twoVoices, breakMask, lineBreaks }) => {
        const text = tuneToAbcText(buildLayoutTune(measureCount, twoVoices, breakMask), new ABCContext(), { lineBreaks });
        for (const system of systemsOf(text, twoVoices ? 2 : 1)) {
          expect(new Set(system.map(closingBars)).size, text).to.equal(1);
        }
      }),
      { numRuns: 60 }
    );
  });

  it("restores each voice's element sequence when the systems are concatenated", () => {
    fc.assert(
      fc.property(genLayoutCase, ({ measureCount, twoVoices, breakMask, lineBreaks }) => {
        const tune = buildLayoutTune(measureCount, twoVoices, breakMask);
        const text = tuneToAbcText(tune, new ABCContext(), { lineBreaks });
        const voiceCount = twoVoices ? 2 : 1;
        const systems = systemsOf(text, voiceCount);
        for (let v = 0; v < voiceCount; v++) {
          const joined = systems.map((s) => s[v]).join(" ");
          const letters = (joined.match(/[A-Ga-g]/g) ?? []).length;
          const bars = closingBars(joined);
          const expected = pitchSequence(tune, v);
          expect(letters).to.equal(expected.filter((x) => x !== "|").length);
          expect(bars).to.equal(expected.filter((x) => x === "|").length);
        }
      }),
      { numRuns: 60 }
    );
  });

  it("writes exactly N closing bars on every line but the last in fixed mode", () => {
    fc.assert(
      fc.property(genLayoutCase, fc.integer({ min: 1, max: 5 }), ({ measureCount, twoVoices, breakMask }, barsPerLine) => {
        const text = tuneToAbcText(buildLayoutTune(measureCount, twoVoices, breakMask), new ABCContext(), { lineBreaks: { mode: "fixed", barsPerLine } });
        const systems = systemsOf(text, twoVoices ? 2 : 1);
        systems.forEach((system, k) => {
          for (const line of system) {
            if (k < systems.length - 1) expect(closingBars(line)).to.equal(barsPerLine);
            else expect(closingBars(line)).to.be.within(1, barsPerLine);
          }
        });
      }),
      { numRuns: 60 }
    );
  });

  it("always produces text that parses without errors", () => {
    fc.assert(
      fc.property(genLayoutCase, ({ measureCount, twoVoices, breakMask, lineBreaks }) => {
        const text = tuneToAbcText(buildLayoutTune(measureCount, twoVoices, breakMask), new ABCContext(), { lineBreaks });
        const reporter = new AbcErrorReporter();
        const ctx = new ABCContext(reporter);
        parse(Scanner(text, ctx), ctx);
        expect(reporter.getErrors(), text).to.deep.equal([]);
      }),
      { numRuns: 60 }
    );
  });
});
