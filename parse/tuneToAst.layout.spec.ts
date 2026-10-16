import { expect } from "chai";
import { createEmptyTune } from "./interpreter/InterpreterState";
import { ABCContext } from "./parsers/Context";
import { tuneToAbcText } from "./tuneToAst";
import {
  BarElement,
  BarType,
  BracketBracePosition,
  ClefType,
  ElementType,
  KeyAccidental,
  KeyRoot,
  Mode,
  NoteElement,
  Staff,
  StaffSystem,
  Tune,
  VoiceElement,
} from "./types/abcjs-ast";
import { createRational } from "./Visitors/fmt/rational";

function eighth(pitch: number): NoteElement {
  return { el_type: ElementType.Note, startChar: 0, endChar: 0, duration: createRational(1, 8), pitches: [{ pitch, name: "", verticalPos: pitch }] };
}

function bar(): BarElement {
  return { el_type: ElementType.Bar, startChar: 0, endChar: 0, type: BarType.BarThin };
}

/** A measure of `count` eighth notes followed by a bar line. */
function measure(count: number): VoiceElement[] {
  return [...Array.from({ length: count }, (_, i) => eighth(i)), bar()];
}

function staff(voiceIds: string[], voices: VoiceElement[][], extra: Partial<Staff> = {}): Staff {
  return {
    clef: { type: ClefType.Treble },
    workingClef: { type: ClefType.Treble },
    key: { root: KeyRoot.C, acc: KeyAccidental.None, mode: Mode.Major, accidentals: [] },
    voices,
    voiceIds,
    ...extra,
  };
}

function tuneOf(systems: StaffSystem[]): Tune {
  const tune = createEmptyTune();
  tune.systems = systems;
  return tune;
}

describe("tuneToAbcText layout robustness", () => {
  it("leaves out a voice that has nothing in a system, instead of writing a blank line", () => {
    const tune = tuneOf([{ staff: [staff(["1"], [[...measure(8), ...measure(8)]]), staff(["2"], [measure(8)]), staff(["3"], [measure(8)])] }]);
    const text = tuneToAbcText(tune, new ABCContext(), { lineBreaks: { mode: "fixed", barsPerLine: 1 } });
    expect(text.trimEnd()).to.not.contain("\n\n");
    const body = text.split("\n").slice(text.split("\n").findIndex((l) => l.startsWith("K:")) + 1);
    expect(body.filter((l) => l.startsWith("V:"))).to.deep.equal(["V:1", "V:2", "V:3", "V:1"]);
  });

  it("lists in %%score a voice whose staff only appears in a later system", () => {
    const tune = tuneOf([
      { staff: [staff(["1", "2"], [measure(8), measure(8)])] },
      { staff: [staff(["1", "2"], [measure(8), measure(8)]), staff(["3"], [measure(8)])] },
    ]);
    const score = tuneToAbcText(tune, new ABCContext())
      .split("\n")
      .find((l) => l.startsWith("%%score"));
    expect(score).to.equal("%%score (1 2) 3");
  });

  it("closes an open group when a new group starts", () => {
    const tune = tuneOf([
      {
        staff: [
          staff(["1"], [measure(8)], { brace: BracketBracePosition.Start }),
          staff(["2"], [measure(8)], { brace: BracketBracePosition.Start }),
          staff(["3"], [measure(8)], { brace: BracketBracePosition.End }),
        ],
      },
    ]);
    const score = tuneToAbcText(tune, new ABCContext())
      .split("\n")
      .find((l) => l.startsWith("%%score"));
    expect(score).to.equal("%%score {1} {2 | 3}");
  });

  it("keeps an unmarked staff after the group it interrupts", () => {
    const tune = tuneOf([
      {
        staff: [
          staff(["1"], [measure(8)], { bracket: BracketBracePosition.Start }),
          staff(["2"], [measure(8)]),
          staff(["3"], [measure(8)], { bracket: BracketBracePosition.End }),
        ],
      },
    ]);
    const score = tuneToAbcText(tune, new ABCContext())
      .split("\n")
      .find((l) => l.startsWith("%%score"));
    expect(score).to.equal("%%score [1] 2 3");
  });
});
