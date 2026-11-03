import { expect } from "chai";
import * as fc from "fast-check";
import { SemanticAnalyzer } from "../analyzers/semantic-analyzer";
import { TuneInterpreter } from "../interpreter/TuneInterpreter";
import { tuneToAbcText } from "../interpreter/tuneToAst";
import { ABCContext } from "../parsers/Context";
import { AbcErrorReporter } from "../parsers/ErrorReporter";
import { parse } from "../parsers/parse";
import { Scanner } from "../parsers/scan";
import { Tune } from "../types/abcjs-ast";
import { parseMusicXmlToSheet } from "./parseMusicXml";
import { serializeScorePartwise } from "./serialize";
import { importTune, normalizeTune } from "./testSupport/unwrap";

/**
 * Property: a generated ABC tune keeps its notes through ABC -> MusicXML -> ABC.
 *
 * The tune is exported to MusicXML, the export is imported, written as ABC, read back and exported again, and both
 * exports must hold the same notes in every part. Because the comparison reads the MusicXML notes (step, alter, octave,
 * duration, rest, chord), it does not depend on how the ABC writer spells accidentals: an accidental that the writer
 * leaves implied still exports as the same alter.
 */

/** The number of eighth notes in a 4/4 bar, with L:1/8. */
const BAR_LENGTH = 8;

/** The lengths that a single ABC note can have without a tie: 1, 2, 3 (dotted), 4, 6 (dotted) and 8 eighths. */
const SINGLE_NOTE_LENGTHS = [1, 2, 3, 4, 6, 8];

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

/**
 * Writes a duration of `duration` divisions as a reduced fraction of a quarter note, such as "3:2" for a dotted quarter.
 */
export function quarterFraction(duration: number, divisions: number): string {
  const divisor = greatestCommonDivisor(duration, divisions) || 1;
  return `${duration / divisor}:${divisions / divisor}`;
}

function interpretAbc(abc: string): Tune {
  const ctx = new ABCContext(new AbcErrorReporter());
  const ast = parse(Scanner(abc, ctx), ctx);
  const analyzer = new SemanticAnalyzer(ctx);
  ast.accept(analyzer);
  return new TuneInterpreter(analyzer, ctx, abc).interpretFile(ast).tunes[0];
}

/**
 * Cuts a list of wished lengths into lengths that fill one bar exactly. Because a note of 5 or 7 eighths needs a tie,
 * a remainder of that size takes a half note instead, and the rest of the bar is filled by the following lengths.
 */
export function fillBar(wished: number[]): number[] {
  const lengths: number[] = [];
  let remaining = BAR_LENGTH;
  let index = 0;
  while (remaining > 0) {
    let length = Math.min(wished[index % wished.length], remaining);
    if (!SINGLE_NOTE_LENGTHS.includes(length)) length = 4;
    lengths.push(length);
    remaining -= length;
    index++;
  }
  return lengths;
}

const pitchArb = fc.record({
  accidental: fc.constantFrom("", "", "^", "_", "="),
  letter: fc.constantFrom("C", "D", "E", "F", "G", "A", "B", "c", "d", "e", "f", "g", "a", "b"),
});

const eventArb = fc.oneof(
  { weight: 1, arbitrary: fc.constant("z") },
  { weight: 4, arbitrary: pitchArb.map((p) => p.accidental + p.letter) },
  {
    weight: 1,
    arbitrary: fc
      .uniqueArray(pitchArb, { minLength: 2, maxLength: 3, selector: (p) => p.letter.toUpperCase() })
      .map((ps) => `[${ps.map((p) => p.accidental + p.letter).join("")}]`),
  }
);

const barArb = fc
  .record({
    wished: fc.array(fc.constantFrom(...SINGLE_NOTE_LENGTHS), { minLength: 8, maxLength: 8 }),
    events: fc.array(eventArb, { minLength: 8, maxLength: 8 }),
  })
  .map(({ wished, events }) =>
    fillBar(wished)
      .map((length, index) => events[index] + (length === 1 ? "" : String(length)))
      .join(" ")
  );

const tuneArb = fc.integer({ min: 1, max: 4 }).chain((barCount) =>
  fc.array(fc.array(barArb, { minLength: barCount, maxLength: barCount }), { minLength: 1, maxLength: 3 }).map((voices) => {
    const header = ["X:1", "M:4/4", "L:1/8", ...voices.map((_, index) => `V:${index + 1}`), "K:C"];
    const body = voices.flatMap((bars, index) => [`V:${index + 1}`, bars.join(" | ") + " |"]);
    return [...header, ...body, ""].join("\n");
  })
);

/**
 * Returns the events of every part of a MusicXML export, as text: the content of each <pitch> (or the word rest) and
 * the duration. Because the importer writes the notes of a chord from the lowest to the highest, while the source may
 * list them in any order, the notes of a chord (a note and the <chord/> notes that follow it) are sorted into one event.
 * Because the importer drops a voice without any pitched note (see KNOWN_GAPS.md), a part made only of rests is left out.
 * Because a <duration> counts in the <divisions> that the exporter picks from every duration of the tune, durations are
 * written as fractions of a quarter note, which do not depend on the divisions.
 */
export function notesByPart(xml: string): string[][] {
  const divisions = Number(/<divisions>(\d+)<\/divisions>/.exec(xml)?.[1] ?? "1");
  return xml
    .split(/<part id=/)
    .slice(1)
    .map((part) => {
      const events: string[][] = [];
      for (const match of part.matchAll(/<note>([\s\S]*?)<\/note>/g)) {
        const note = match[1];
        const pitch = /<pitch>([\s\S]*?)<\/pitch>/.exec(note)?.[1].replace(/\s+/g, "") ?? "rest";
        const duration = quarterFraction(Number(/<duration>(\d+)<\/duration>/.exec(note)?.[1] ?? "0"), divisions);
        if (note.includes("<chord/>") && events.length > 0) events[events.length - 1].push(`${pitch}/${duration}`);
        else events.push([`${pitch}/${duration}`]);
      }
      return events.map((event) => event.sort().join(" + "));
    })
    .filter((events) => !events.every((event) => event.startsWith("rest/")));
}

describe("ABC -> MusicXML -> ABC property-based round trip", () => {
  it("keeps the notes of every part of a generated tune", () => {
    fc.assert(
      fc.property(tuneArb, (abc) => {
        const firstExport = serializeScorePartwise(normalizeTune(interpretAbc(abc)));
        const writtenAbc = tuneToAbcText(importTune(parseMusicXmlToSheet(firstExport)), new ABCContext());
        const secondExport = serializeScorePartwise(normalizeTune(interpretAbc(writtenAbc)));
        expect(notesByPart(secondExport), `${abc}\n--- written back as ---\n${writtenAbc}`).to.deep.equal(notesByPart(firstExport));
      }),
      { numRuns: 60 }
    );
  });
});
