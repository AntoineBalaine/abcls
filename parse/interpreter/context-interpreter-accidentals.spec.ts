import { expect } from "chai";
import * as fc from "fast-check";
import { SemanticAnalyzer } from "../analyzers/semantic-analyzer";
import { ABCContext } from "../parsers/Context";
import { AbcErrorReporter } from "../parsers/ErrorReporter";
import { parse } from "../parsers/parse";
import { Scanner } from "../parsers/scan";
import { AccidentalType } from "../types/abcjs-ast";
import { ContextInterpreter, getSnapshotAtPosition, encode } from "./ContextInterpreter";

function parseAndInterpret(input: string, snapshotAccidentals = true) {
  const ctx = new ABCContext(new AbcErrorReporter());
  const tokens = Scanner(input, ctx);
  const ast = parse(tokens, ctx);
  const analyzer = new SemanticAnalyzer(ctx);
  ast.accept(analyzer);
  const interpreter = new ContextInterpreter();
  const snapshots = interpreter.interpret(ast, analyzer.data, ctx, { snapshotAccidentals });
  return { snapshots, ctx };
}

describe("ContextInterpreter measure accidentals", () => {
  it("should record sharp accidental", () => {
    const input = "X:1\nK:C\n^F G A|";
    const { snapshots } = parseAndInterpret(input);

    // Find snapshot after ^F (line 2, around char 0-2)
    const snapshot = getSnapshotAtPosition(snapshots, encode(2, 2));
    expect(snapshot?.measureAccidentals?.get("F")).to.equal(AccidentalType.Sharp);
  });

  it("should record flat accidental", () => {
    const input = "X:1\nK:C\n_B G A|";
    const { snapshots } = parseAndInterpret(input);

    const snapshot = getSnapshotAtPosition(snapshots, encode(2, 2));
    expect(snapshot?.measureAccidentals?.get("B")).to.equal(AccidentalType.Flat);
  });

  it("should record natural accidental", () => {
    const input = "X:1\nK:G\n=F G A|";
    const { snapshots } = parseAndInterpret(input);

    const snapshot = getSnapshotAtPosition(snapshots, encode(2, 2));
    expect(snapshot?.measureAccidentals?.get("F")).to.equal(AccidentalType.Natural);
  });

  it("should record double sharp accidental", () => {
    const input = "X:1\nK:C\n^^F G A|";
    const { snapshots } = parseAndInterpret(input);

    const snapshot = getSnapshotAtPosition(snapshots, encode(2, 3));
    expect(snapshot?.measureAccidentals?.get("F")).to.equal(AccidentalType.DblSharp);
  });

  it("should record double flat accidental", () => {
    const input = "X:1\nK:C\n__B G A|";
    const { snapshots } = parseAndInterpret(input);

    const snapshot = getSnapshotAtPosition(snapshots, encode(2, 3));
    expect(snapshot?.measureAccidentals?.get("B")).to.equal(AccidentalType.DblFlat);
  });

  it("should update accidental when overridden", () => {
    const input = "X:1\nK:C\n^F G =F|";
    const { snapshots } = parseAndInterpret(input);

    // Because the barline pushes its own snapshot, we read the snapshot at the =F rather than the last one.
    const snapshot = getSnapshotAtPosition(snapshots, encode(2, 6));
    expect(snapshot.measureAccidentals?.get("F")).to.equal(AccidentalType.Natural);
  });

  it("should clear accidentals at barline", () => {
    const input = "X:1\nK:C\n^F G|A B|";
    const { snapshots } = parseAndInterpret(input);

    // Find a snapshot in the second bar - after the barline
    // The barline clears accidentals, so subsequent snapshots shouldn't have F
    const snapshotsAfterBarline = snapshots.filter((s) => s.snapshot.measureNumber > 1);

    // If there are snapshots after the barline, F should not be in measureAccidentals
    // (unless there's a new accidental on F in the second bar)
    for (const { snapshot } of snapshotsAfterBarline) {
      if (snapshot.measureAccidentals) {
        expect(snapshot.measureAccidentals.has("F")).to.be.false;
      }
    }
  });

  it("should record the barline reset in a snapshot", () => {
    const input = "X:1\nK:C\n^F G|A F|";
    const { snapshots } = parseAndInterpret(input);

    // Because no accidental appears in the second bar, only a snapshot pushed at the
    // barline can tell that the ^F of the first bar no longer applies.
    const snapshot = getSnapshotAtPosition(snapshots, encode(2, 6));
    expect(snapshot.measureAccidentals?.has("F")).to.be.false;
  });

  it("should record the line-end reset in a snapshot", () => {
    const input = "X:1\nK:C\n^F G\nA F|";
    const { snapshots } = parseAndInterpret(input);

    const snapshot = getSnapshotAtPosition(snapshots, encode(3, 1));
    expect(snapshot.measureAccidentals?.has("F")).to.be.false;
  });

  it("should record accidentals inside chords", () => {
    const input = "X:1\nK:C\n[^FAC]|";
    const { snapshots } = parseAndInterpret(input);

    // Find snapshot for the chord
    const chordSnapshot = snapshots.find((s) => s.snapshot.measureAccidentals?.has("F"));
    expect(chordSnapshot?.snapshot.measureAccidentals?.get("F")).to.equal(AccidentalType.Sharp);
  });

  it("should record multiple accidentals inside chords", () => {
    const input = "X:1\nK:C\n[^F_AC]|";
    const { snapshots } = parseAndInterpret(input);

    const chordSnapshot = snapshots.find((s) => s.snapshot.measureAccidentals?.has("F") && s.snapshot.measureAccidentals?.has("A"));
    expect(chordSnapshot?.snapshot.measureAccidentals?.get("F")).to.equal(AccidentalType.Sharp);
    expect(chordSnapshot?.snapshot.measureAccidentals?.get("A")).to.equal(AccidentalType.Flat);
  });

  it("should not include measureAccidentals when config is disabled", () => {
    const input = "X:1\nK:C\n^F G A|";
    const { snapshots } = parseAndInterpret(input, false);

    for (const { snapshot } of snapshots) {
      expect(snapshot.measureAccidentals).to.be.undefined;
    }
  });

  it("should handle multiple notes with same pitch class", () => {
    const input = "X:1\nK:C\n^F G ^f|";
    const { snapshots } = parseAndInterpret(input);

    // Both F and f should map to "F" (uppercase)
    const snapshot = getSnapshotAtPosition(snapshots, encode(2, 6));
    expect(snapshot.measureAccidentals?.get("F")).to.equal(AccidentalType.Sharp);
  });

  it("should clear accidentals at system break", () => {
    // $ is the system break in ABC notation
    const input = "X:1\nK:C\n^F G$\nA B|";
    const { snapshots } = parseAndInterpret(input);

    // After the system break, F should not have an accidental
    // Line 3 is after the system break
    const snapshotsAfterSystemBreak = snapshots.filter((s) => s.snapshot.line > 2);
    for (const { snapshot } of snapshotsAfterSystemBreak) {
      if (snapshot.measureAccidentals) {
        expect(snapshot.measureAccidentals.has("F")).to.be.false;
      }
    }
  });

  it("should clear accidentals at line end (EOL)", () => {
    // When a line ends without a barline, accidentals should still be cleared
    const input = "X:1\nK:C\n^F G\nA B|";
    const { snapshots } = parseAndInterpret(input);

    // Line 3 is after the EOL, so F should not have an accidental
    const snapshotsOnLine3 = snapshots.filter((s) => s.snapshot.line === 3);
    for (const { snapshot } of snapshotsOnLine3) {
      if (snapshot.measureAccidentals) {
        expect(snapshot.measureAccidentals.has("F")).to.be.false;
      }
    }
  });

  it("should maintain separate accidentals per voice", () => {
    const input = "X:1\nK:C\nV:1\n^F G|\nV:2\n_B A|";
    const { snapshots } = parseAndInterpret(input);

    // Voice 1 snapshots should have F sharp, not B flat
    const v1Snapshots = snapshots.filter((s) => s.snapshot.voiceId === "1");
    const v1WithF = v1Snapshots.find((s) => s.snapshot.measureAccidentals?.has("F"));
    expect(v1WithF).to.not.be.undefined;
    expect(v1WithF?.snapshot.measureAccidentals?.has("B")).to.be.false;

    // Voice 2 snapshots should have B flat, not F sharp
    const v2Snapshots = snapshots.filter((s) => s.snapshot.voiceId === "2");
    const v2WithB = v2Snapshots.find((s) => s.snapshot.measureAccidentals?.has("B"));
    expect(v2WithB).to.not.be.undefined;
    expect(v2WithB?.snapshot.measureAccidentals?.has("F")).to.be.false;
  });

  it("should produce independent snapshot maps (not shared references)", () => {
    const input = "X:1\nK:C\n^F G =F|";
    const { snapshots } = parseAndInterpret(input);

    const snapshotsWithAccidentals = snapshots.filter((s) => s.snapshot.measureAccidentals?.size);
    if (snapshotsWithAccidentals.length >= 2) {
      const first = snapshotsWithAccidentals[0].snapshot.measureAccidentals!;
      const second = snapshotsWithAccidentals[1].snapshot.measureAccidentals!;

      // Mutating one should not affect the other
      first.set("D", AccidentalType.Sharp);
      expect(second.has("D")).to.be.false;
    }
  });
});

describe("ContextInterpreter measure accidentals properties", () => {
  it("property: snapshot measureAccidentals only contains valid pitch classes", () => {
    const noteWithAccidental = fc.constantFrom("^C", "_D", "=E", "^^F", "__G", "^A", "_B");
    const noteWithoutAccidental = fc.constantFrom("A", "B", "C", "D", "E", "F", "G", "a", "b", "c", "d", "e", "f", "g");
    const note = fc.oneof(noteWithAccidental, noteWithoutAccidental);
    const measure = fc.array(note, { minLength: 1, maxLength: 8 }).map((notes) => notes.join(" ") + "|");
    const body = fc.array(measure, { minLength: 1, maxLength: 4 }).map((measures) => measures.join(""));
    const tune = body.map((b) => `X:1\nK:C\n${b}`);

    fc.assert(
      fc.property(tune, (input) => {
        const { snapshots } = parseAndInterpret(input);

        // Verify: every snapshot with measureAccidentals has valid pitch classes
        for (const { snapshot } of snapshots) {
          if (snapshot.measureAccidentals !== undefined) {
            for (const key of snapshot.measureAccidentals.keys()) {
              if (!/^[A-G]$/.test(key)) return false;
            }
          }
        }
        return true;
      })
    );
  });

  it("property: accidentals are cleared at barlines", () => {
    const accidental = fc.constantFrom("^", "_", "=");
    const pitchClass = fc.constantFrom("C", "D", "E", "F", "G", "A", "B");
    const noteWithAccidental = fc.tuple(accidental, pitchClass).map(([acc, pc]) => acc + pc);

    fc.assert(
      fc.property(noteWithAccidental, (note) => {
        // Create a tune with the note in first bar, then check second bar
        const input = `X:1\nK:C\n${note} G|A B|`;
        const { snapshots } = parseAndInterpret(input);

        // Get the pitch class from the note
        const pc = note.slice(-1).toUpperCase() as "C" | "D" | "E" | "F" | "G" | "A" | "B";

        // Find snapshots in measure 2
        const measure2Snapshots = snapshots.filter((s) => s.snapshot.measureNumber === 2);

        // None of them should have the pitch class from measure 1
        for (const { snapshot } of measure2Snapshots) {
          if (snapshot.measureAccidentals?.has(pc)) {
            return false;
          }
        }
        return true;
      })
    );
  });
});
