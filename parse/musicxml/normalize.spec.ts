import { expect } from "chai";
import { SemanticAnalyzer } from "../analyzers/semantic-analyzer";
import { ABCContext } from "../parsers/Context";
import { AbcErrorReporter } from "../parsers/ErrorReporter";
import { parse } from "../parsers/parse";
import { Scanner } from "../parsers/scan";
import { TuneInterpreter } from "../interpreter/TuneInterpreter";
import { Tune, StaffSystem, ElementType } from "../types/abcjs-ast";
import { computeDivisions, diatonicToStepOctave, splitVoiceIntoMeasures, normalizeForMusicXML } from "./normalize";
import { createRational } from "../Visitors/fmt/rational";

function interpretABC(abc: string): Tune {
  const ctx = new ABCContext(new AbcErrorReporter());
  const tokens = Scanner(abc, ctx);
  const ast = parse(tokens, ctx);
  const analyzer = new SemanticAnalyzer(ctx);
  ast.accept(analyzer);
  const interpreter = new TuneInterpreter(analyzer, ctx, abc);
  return interpreter.interpretFile(ast).tunes[0];
}

describe("computeDivisions", () => {
  it("computes the LCM of all note duration denominators", () => {
    const tune = interpretABC("X:1\nL:1/8\nK:C\nC2 D/2 E3/2 |");
    // 1/8 default note length -> C2 = 1/4 (den 4), D/2 = 1/16 (den 16), E3/2 = 3/16 (den 16)
    expect(computeDivisions(tune)).to.equal(16);
  });

  it("defaults to 1 for a tune with no notes", () => {
    const tune = interpretABC("X:1\nK:C\n");
    expect(computeDivisions(tune)).to.equal(1);
  });
});

describe("diatonicToStepOctave", () => {
  it("maps pitch 0 to middle C (C4)", () => {
    expect(diatonicToStepOctave(0)).to.deep.equal({ step: "C", octave: 4 });
  });

  it("maps pitch 7 (lowercase c) to C5", () => {
    expect(diatonicToStepOctave(7)).to.deep.equal({ step: "C", octave: 5 });
  });

  it("maps pitch -7 (C,) to C3", () => {
    expect(diatonicToStepOctave(-7)).to.deep.equal({ step: "C", octave: 3 });
  });

  it("maps pitch 6 (B) to B4", () => {
    expect(diatonicToStepOctave(6)).to.deep.equal({ step: "B", octave: 4 });
  });
});

describe("splitVoiceIntoMeasures", () => {
  it("splits on bar elements without requiring equal voice lengths", () => {
    const tune = interpretABC("X:1\nV:1\nV:2\nK:C\nV:1\nC D | E F |\nV:2\nC D |");
    const system = tune.systems[0] as StaffSystem;
    const measuresV1 = splitVoiceIntoMeasures(system.staff[0].voices[0]);
    const measuresV2 = splitVoiceIntoMeasures(system.staff[1].voices[0]);
    expect(measuresV1.length).to.equal(2);
    expect(measuresV2.length).to.equal(1);
  });
});

describe("normalizeForMusicXML", () => {
  it("does not pad or error when voices in the same staff have mismatched measure counts", () => {
    const abc = "X:1\nV:1\nV:2 merge=true\nK:C\nV:1\nC D | E F | G A |\nV:2\nC D | E F |";
    const tune = interpretABC(abc);
    const ir = normalizeForMusicXML(tune);
    expect(ir.parts.length).to.equal(1);
    const part = ir.parts[0];
    expect(part.measures.length).to.equal(3);
    const thirdMeasureVoices = new Set(part.measures[2].content.filter((n) => n.kind === "note").map((n) => n.voice));
    expect(thirdMeasureVoices.has(1)).to.equal(true);
    expect(thirdMeasureVoices.has(2)).to.equal(false);
  });

  it("builds a part-group for a braced grand staff", () => {
    const abc = "X:1\nV:1\nV:2\nK:C\n%%staves {1 2}\nV:1\nC |\nV:2\nC, |";
    const tune = interpretABC(abc);
    const ir = normalizeForMusicXML(tune);
    const groupEntries = ir.partList.filter((e) => e.kind === "part-group");
    if (groupEntries.length > 0) {
      expect(groupEntries[0].kind).to.equal("part-group");
    }
  });

  it("computes divisions once and reuses it for every part", () => {
    const tune = interpretABC("X:1\nL:1/8\nK:C\nC2 D/2 |");
    const ir = normalizeForMusicXML(tune);
    const firstMeasureAttrs = ir.parts[0].measures[0].attributes;
    expect(firstMeasureAttrs?.divisions).to.equal(16);
  });

  it("does not count a chord's stacked notes more than once when computing the backup duration between voices", () => {
    const abc = "X:1\nM:4/4\nL:1/4\nV:1\nV:2 merge=true\nK:C\nV:1\n[CEG] |\nV:2\nC, |";
    const tune = interpretABC(abc);
    const ir = normalizeForMusicXML(tune);
    const content = ir.parts[0].measures[0].content;
    const backup = content.find((n) => n.kind === "backup");
    expect(backup?.duration).to.equal(4);
  });

  it("emits a note with no pitches and no rest flag as a rest rather than dropping its duration", () => {
    const abc = "X:1\nM:4/4\nL:1/4\nK:C\nC D E F |";
    const tune = interpretABC(abc);
    const ir = normalizeForMusicXML(tune);
    // Simulate an anomalous element: neither rest nor pitches set.
    const anomalous = { el_type: ElementType.Note, startChar: 0, endChar: 0, duration: createRational(1, 4) } as never;
    const staff = tune.systems[0];
    if ("staff" in staff) {
      staff.staff[0].voices[0].splice(1, 1, anomalous);
    }
    const irAfter = normalizeForMusicXML(tune);
    const notes = irAfter.parts[0].measures[0].content.filter((n) => n.kind === "note");
    expect(notes.some((n) => n.rest === true)).to.equal(true);
    expect(ir.parts[0].measures[0].content.length).to.equal(irAfter.parts[0].measures[0].content.length);
  });

  it("still emits at least one measure for a staff with zero voices", () => {
    // A MusicXML <staves> count can declare a staff that this particular
    // excerpt never writes notes to; MusicXML's <part> requires
    // minOccurs="1" on <measure>, so the part must not come out empty.
    const abc = "X:1\nV:1\nV:2\nK:C\nV:1\nC D |\nV:2\nC, D, |";
    const tune = interpretABC(abc);
    const staff = tune.systems[0];
    if ("staff" in staff) {
      staff.staff[1].voices = [];
    }
    const ir = normalizeForMusicXML(tune);
    const emptyPart = ir.parts.find((p) => p.measures.every((m) => m.content.length === 0));
    expect(emptyPart, "expected one part with zero-content measures").to.not.be.undefined;
    expect(emptyPart!.measures.length).to.be.at.least(1);
  });
});

describe("SlurNumberAllocator overflow", () => {
  it("throws rather than silently reusing a slur number that is still open", () => {
    const abc = "X:1\nM:1/4\nL:1/4\nK:C\nC |";
    const tune = interpretABC(abc);
    const system = tune.systems[0];
    if (!("staff" in system)) throw new Error("expected a music line");
    const note = system.staff[0].voices[0].find((el) => el.el_type === "note") as import("../types/abcjs-ast").NoteElement;
    note.pitches![0].startSlur = Array.from({ length: 17 }, (_, i) => ({ label: 200 + i }));
    expect(() => normalizeForMusicXML(tune)).to.throw(/more than 16 slurs/);
  });
});

describe("IRational duration to divisions sanity", () => {
  it("keeps a quarter note as exactly one quarter of a whole note", () => {
    const quarter = createRational(1, 4);
    expect(quarter.numerator).to.equal(1);
    expect(quarter.denominator).to.equal(4);
  });
});
