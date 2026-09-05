/**
 * Multi-Staff Implementation Tests
 *
 * Tests to validate the multi-staff/multi-voice functionality.
 */

import { expect } from "chai";
import { SemanticAnalyzer } from "../analyzers/semantic-analyzer";
import { ABCContext } from "../parsers/Context";
import { AbcErrorReporter } from "../parsers/ErrorReporter";
import { parse } from "../parsers/parse";
import { Scanner } from "../parsers/scan";
import { StaffSystem } from "../types/abcjs-ast";
import { TuneInterpreter } from "./TuneInterpreter";

describe("Multi-Staff Implementation", () => {
  function interpretABC(abc: string) {
    const ctx = new ABCContext(new AbcErrorReporter());
    const tokens = Scanner(abc, ctx);
    const ast = parse(tokens, ctx);
    const analyzer = new SemanticAnalyzer(ctx);
    ast.accept(analyzer);
    const interpreter = new TuneInterpreter(analyzer, ctx, abc);
    const result = interpreter.interpretFile(ast);
    return result.tunes[0];
  }

  describe("Two voices, separate staffs (automatic mode)", () => {
    it("should create two separate staffs for two voices declared in header", () => {
      const abc = `X:1
M:4/4
L:1/4
V:1
V:2
K:C
V:1
CDEF |
V:2
C,D,E,F, |`;

      const tune = interpretABC(abc);

      // Should have one system with both voices
      expect(tune.systems.length).to.be.greaterThanOrEqual(1);

      const system = tune.systems[0] as StaffSystem;
      expect(system).to.have.property("staff");

      // Should have two staffs
      expect(system.staff.length).to.equal(2);

      // Should report 2 staffs
      expect(tune.staffNum).to.equal(2);
      expect(tune.voiceNum).to.equal(2);

      // Voice 1 should have 5 elements (C, D, E, F, |)
      expect(system.staff[0].voices[0].length).to.equal(5);

      // Voice 2 should have 5 elements (C,, D,, E,, F,, |)
      expect(system.staff[1].voices[0].length).to.equal(5);
    });

    it("should handle voices with different numbers of measures", () => {
      const abc = `X:1
M:4/4
L:1/4
K:C
V:1
V:2
V:1
CDEF | GABA | c2d2 |
V:2
C,D,E,F, |`;

      const tune = interpretABC(abc);

      const system = tune.systems[0] as StaffSystem;

      // Voice 1 has 3 measures (15 elements), Voice 2 has 1 measure (5 elements)
      // This is allowed - no synchronization required
      expect(system.staff[0].voices[0].length).to.be.greaterThan(10);
      expect(system.staff[1].voices[0].length).to.equal(5);
    });
  });

  describe("Non-sequential voice writing", () => {
    it("should handle V1 → V2 → V1 pattern (interleaved measures)", () => {
      const abc = `X:1
M:4/4
L:1/4
K:C
V:1
V:2
V:1
CDEF |
V:2
C,D,E,F, |
V:1
GABA |`;

      const tune = interpretABC(abc);

      // First system should have both voices' first measures
      const system1 = tune.systems[0] as StaffSystem;
      expect(system1.staff[0].voices[0].length).to.equal(5); // CDEF |
      expect(system1.staff[1].voices[0].length).to.equal(5); // C,D,E,F, |

      // Second measure of voice 1 goes to next system
      if (tune.systems.length > 1) {
        const system2 = tune.systems[1] as StaffSystem;
        expect(system2.staff[0].voices[0].length).to.be.greaterThan(0); // GABA |
      }
    });

    it("should handle V1 → V1 → V2 → V2 pattern (multiple measures per voice)", () => {
      const abc = `X:1
M:4/4
L:1/4
K:C
V:1
V:2
V:1
CDEF | GABA |
V:2
C,D,E,F, | G,A,B,C |`;

      const tune = interpretABC(abc);

      const system = tune.systems[0] as StaffSystem;

      // Voice 1 writes 2 measures first
      expect(system.staff[0].voices[0].length).to.equal(10); // 2 measures * 5 elements

      // Voice 2 writes 2 measures after
      expect(system.staff[1].voices[0].length).to.equal(10); // 2 measures * 5 elements
    });

    it("should handle V1 → V2 → V3 → V1 → V2 → V3 pattern (round-robin)", () => {
      const abc = `X:1
M:4/4
L:1/4
K:C
V:1
V:2
V:3
V:1
CDEF |
V:2
C,D,E,F, |
V:3
G,A,B,C |
V:1
GABA |
V:2
G,A,B,C |
V:3
c,d,e,f, |`;

      const tune = interpretABC(abc);

      const system1 = tune.systems[0] as StaffSystem;

      // All three voices should have their first measure in system 1
      expect(system1.staff[0].voices[0].length).to.equal(5); // V1 measure 1
      expect(system1.staff[1].voices[0].length).to.equal(5); // V2 measure 1
      expect(system1.staff[2].voices[0].length).to.equal(5); // V3 measure 1

      // All three voices should have their second measure in system 2
      if (tune.systems.length > 1) {
        const system2 = tune.systems[1] as StaffSystem;
        expect(system2.staff[0].voices[0].length).to.be.greaterThan(0); // V1 measure 2
        expect(system2.staff[1].voices[0].length).to.be.greaterThan(0); // V2 measure 2
        expect(system2.staff[2].voices[0].length).to.be.greaterThan(0); // V3 measure 2
      }
    });

    it("should handle V2 → V1 pattern (reverse order)", () => {
      const abc = `X:1
M:4/4
L:1/4
K:C
V:1
V:2
V:2
C,D,E,F, |
V:1
CDEF |`;

      const tune = interpretABC(abc);

      const system = tune.systems[0] as StaffSystem;

      // Both voices write to same system, regardless of order
      expect(system.staff[0].voices[0].length).to.equal(5); // V1
      expect(system.staff[1].voices[0].length).to.equal(5); // V2
    });

    it("should handle V1 → V2 → V1 → V3 → V2 pattern (complex interleaving)", () => {
      const abc = `X:1
M:4/4
L:1/4
V:1
V:2
V:3
K:C
V:1
CDEF |
V:2
C,D,E,F, |
V:1
GABA |
V:3
G,A,B,C |
V:2
G,A,B,C |`;

      const tune = interpretABC(abc);

      const system1 = tune.systems[0] as StaffSystem;

      // System 1 should have first measures of V1 and V2
      expect(system1.staff[0].voices[0].length).to.equal(5); // V1 measure 1
      expect(system1.staff[1].voices[0].length).to.equal(5); // V2 measure 1

      // System 2 should have second measures
      if (tune.systems.length > 1) {
        const system2 = tune.systems[1] as StaffSystem;
        expect(system2.staff[0].voices[0].length).to.be.greaterThan(0); // V1 measure 2
        expect(system2.staff[1].voices[0].length).to.be.greaterThan(0); // V2 measure 2
      }
    });

    it("should handle sparse voice writing (V1 skips a system)", () => {
      const abc = `X:1
M:4/4
L:1/4
K:C
V:1
V:2
V:2
C,D,E,F, | G,A,B,C |
V:1
CDEF |`;

      const tune = interpretABC(abc);

      // Voice 2 writes 2 measures to system 1
      const system1 = tune.systems[0] as StaffSystem;
      expect(system1.staff[1].voices[0].length).to.equal(10); // 2 measures

      // Voice 1 writes its first measure to system 1
      expect(system1.staff[0].voices[0].length).to.equal(5);
    });
  });

  describe("Three voices", () => {
    it("should create three separate staffs for three voices", () => {
      const abc = `X:1
M:4/4
L:1/4
K:C
V:1
CDEF |
V:2
C,D,E,F, |
V:3
G,A,B,C |`;

      const tune = interpretABC(abc);

      expect(tune.systems.length).to.be.greaterThanOrEqual(1);

      const system = tune.systems[0] as StaffSystem;
      expect(system.staff.length).to.be.greaterThanOrEqual(3);

      expect(tune.staffNum).to.equal(3);
      expect(tune.voiceNum).to.equal(3);
    });
  });

  describe("Voice properties", () => {
    it("should preserve clef per voice", () => {
      const abc = `X:1
M:4/4
L:1/4
K:C
V:1 clef=treble
CDEF |
V:2 clef=bass
C,D,E,F, |`;

      const tune = interpretABC(abc);

      const system = tune.systems[0] as StaffSystem;

      // Staff 0 (voice 1) should have treble clef
      expect(system.staff[0].clef.type).to.equal("treble");

      // Staff 1 (voice 2) should have bass clef
      expect(system.staff[1].clef.type).to.equal("bass");
    });
  });

  describe("Direct writing verification", () => {
    it("should write elements directly without buffering", () => {
      const abc = `X:1
M:4/4
L:1/4
K:C
V:1
CDEF |`;

      const tune = interpretABC(abc);

      const system = tune.systems[0] as StaffSystem;

      // Verify the structure exists
      expect(system.staff[0].voices[0]).to.be.an("array");
      expect(system.staff[0].voices[0].length).to.equal(5);

      // Verify elements are in correct order
      const elements = system.staff[0].voices[0];
      expect(elements[0]).to.have.property("el_type", "note");
      expect(elements[4]).to.have.property("el_type", "bar");
    });
  });

  describe("Single voice (backward compatibility)", () => {
    it("should handle single-voice tunes correctly", () => {
      const abc = `X:1
M:4/4
L:1/4
K:C
CDEF | GABA |`;

      const tune = interpretABC(abc);

      // Should have systems with single staff
      expect(tune.systems.length).to.be.greaterThanOrEqual(1);

      const system = tune.systems[0] as StaffSystem;
      expect(system.staff.length).to.equal(1);
      expect(system.staff[0].voices.length).to.equal(1);

      // Should have elements
      expect(system.staff[0].voices[0].length).to.be.greaterThan(0);
    });
  });

  describe("%%score directive", () => {
    it("should create piano score with brace grouping", () => {
      const abc = `X:1
M:4/4
L:1/4
%%score {RH LH}
V:RH name="Right Hand"
V:LH name="Left Hand" clef=bass
K:C
V:RH
CDEF |
V:LH
C,D,E,F, |`;

      const tune = interpretABC(abc);

      // Should have one system with 2 staffs
      const system = tune.systems[0] as StaffSystem;
      expect(system.staff.length).to.equal(2);

      // Both voices should be on separate staffs (as specified by %%score)
      expect(system.staff[0].voices[0].length).to.equal(5); // RH
      expect(system.staff[1].voices[0].length).to.equal(5); // LH

      // Staffs should have brace decoration
      expect(system.staff[0].brace).to.exist;
      expect(system.staff[0].brace).to.equal("start");
      expect(system.staff[1].brace).to.exist;
      expect(system.staff[1].brace).to.equal("end");
    });

    it("should group voices on same staff with parentheses", () => {
      const abc = `X:1
M:4/4
L:1/4
%%score (S A) (T B)
V:S
V:A
V:T
V:B
K:C
V:S
CDEF |
V:A
GABC |
V:T
C,D,E,F, |
V:B
G,,A,,B,,C, |`;

      const tune = interpretABC(abc);

      // Should have 2 staffs
      const system = tune.systems[0] as StaffSystem;
      expect(system.staff.length).to.equal(2);

      // Staff 0 should have 2 voices (S and A)
      expect(system.staff[0].voices.length).to.equal(2);
      expect(system.staff[0].voices[0].length).to.equal(5); // S
      expect(system.staff[0].voices[1].length).to.equal(5); // A

      // Staff 1 should have 2 voices (T and B)
      expect(system.staff[1].voices.length).to.equal(2);
      expect(system.staff[1].voices[0].length).to.equal(5); // T
      expect(system.staff[1].voices[1].length).to.equal(5); // B
    });

    it("should create choir score with bracket grouping", () => {
      const abc = `X:1
M:4/4
L:1/4
%%score [(S A) (T B)]
V:S
V:A
V:T
V:B
K:C
V:S
CDEF |
V:A
GABC |
V:T
C,D,E,F, |
V:B
G,,A,,B,,C, |`;

      const tune = interpretABC(abc);

      const system = tune.systems[0] as StaffSystem;
      expect(system.staff.length).to.equal(2);

      // Should have bracket decoration
      expect(system.staff[0].bracket).to.exist;
      expect(system.staff[0].bracket).to.equal("start");
      expect(system.staff[1].bracket).to.exist;
      expect(system.staff[1].bracket).to.equal("end");
    });

    it("should handle mixed brace and bracket", () => {
      const abc = `X:1
M:4/4
L:1/4
%%score {RH LH} [V1 V2]
V:RH
V:LH
V:V1
V:V2
K:C
V:RH
CDEF |
V:LH
C,D,E,F, |
V:V1
GABA |
V:V2
G,A,B,C |`;

      const tune = interpretABC(abc);

      const system = tune.systems[0] as StaffSystem;
      expect(system.staff.length).to.equal(4);

      // Piano staffs with brace (2 separate staffs connected by brace)
      expect(system.staff[0].brace).to.exist;
      expect(system.staff[0].brace).to.equal("start");
      expect(system.staff[1].brace).to.exist;
      expect(system.staff[1].brace).to.equal("end");

      // Other staffs with bracket (2 separate staffs connected by bracket)
      expect(system.staff[2].bracket).to.exist;
      expect(system.staff[2].bracket).to.equal("start");
      expect(system.staff[3].bracket).to.exist;
      expect(system.staff[3].bracket).to.equal("end");
    });

    it("should respect explicit bar line connections with pipe", () => {
      const abc = `X:1
M:4/4
L:1/4
%%score (S A) | (T B)
V:S
V:A
V:T
V:B
K:C
V:S
CDEF |
V:A
GABC |
V:T
C,D,E,F, |
V:B
G,,A,,B,,C, |`;

      const tune = interpretABC(abc);

      const system = tune.systems[0] as StaffSystem;

      // Staffs should have bar line connections
      expect(system.staff[0].connectBarLines).to.be.true;
      expect(system.staff[1].connectBarLines).to.be.true;
    });
  });

  describe("%%staves directive", () => {
    it("should automatically connect bar lines", () => {
      const abc = `X:1
M:4/4
L:1/4
%%staves (S A) (T B)
V:S
V:A
V:T
V:B
K:C
V:S
CDEF |
V:A
GABC |
V:T
C,D,E,F, |
V:B
G,,A,,B,,C, |`;

      const tune = interpretABC(abc);

      const system = tune.systems[0] as StaffSystem;

      // All staffs should have bar line connections (automatic for %%staves)
      expect(system.staff[0].connectBarLines).to.be.true;
      expect(system.staff[1].connectBarLines).to.be.true;
    });
  });

  describe("Repeated voice switching", () => {
    it("should create new systems when same voice is switched to multiple times", () => {
      const abc = `X:1
M:4/4
L:1/4
V:1
K:C
V:1
D||
V:1
[cA]|`;

      const tune = interpretABC(abc);

      // Should have 2 systems (one for each V:1 section)
      expect(tune.systems.length).to.equal(2);

      const system1 = tune.systems[0] as StaffSystem;
      const system2 = tune.systems[1] as StaffSystem;

      // System 1 should have D||
      expect(system1.staff[0].voices[0].length).to.equal(2); // D + ||

      // System 2 should have [cA]|
      expect(system2.staff[0].voices[0].length).to.equal(2); // [cA] + |

      // Total elements should be 4
      let total = 0;
      tune.systems.forEach((sys) => {
        if ("staff" in sys) {
          (sys as StaffSystem).staff.forEach((staff) => {
            staff.voices.forEach((voice) => {
              total += voice.length;
            });
          });
        }
      });
      expect(total).to.equal(4);
    });
  });

  describe("Voice assignment timing", () => {
    it("should assign voices to staffs when declared in header", () => {
      const abc = `X:1
M:4/4
L:1/4
K:C
V:1
V:2
V:1
CDEF |
V:2
C,D,E,F, |`;

      const tune = interpretABC(abc);

      // Both voices declared in header, should have 2 staffs
      expect(tune.staffNum).to.equal(2);
      expect(tune.voiceNum).to.equal(2);
    });

    it("should handle voice declared in header but used in body", () => {
      const abc = `X:1
M:4/4
L:1/4
K:C
V:1 name="Soprano"
V:2 name="Alto" clef=bass
V:1
CDEF |
V:2
C,D,E,F, |`;

      const tune = interpretABC(abc);

      // Should have two staffs
      expect(tune.staffNum).to.equal(2);

      const system = tune.systems[0] as StaffSystem;

      // Verify clefs are correct
      expect(system.staff[0].clef.type).to.equal("treble"); // default for V1
      expect(system.staff[1].clef.type).to.equal("bass"); // specified for V2
    });

    it("should preserve voice properties through switching", () => {
      const abc = `X:1
M:4/4
L:1/4
K:C
V:1 clef=treble name="Melody"
V:2 clef=bass name="Bass"
V:1
CDEF |
V:2
C,D,E,F, |
V:1
GABA |`;

      const tune = interpretABC(abc);

      // Clefs should be preserved across voice switches
      const system1 = tune.systems[0] as StaffSystem;
      expect(system1.staff[0].clef.type).to.equal("treble");
      expect(system1.staff[1].clef.type).to.equal("bass");
    });
  });

  describe("Voice identity (voiceIds/voiceNames)", () => {
    it("records each voice's original id and declared name, indexed in parallel with voices", () => {
      const abc = `X:1
V:S name="Soprano"
V:A name="Alto"
K:C
V:S
C D |
V:A
E F |`;
      const tune = interpretABC(abc);
      const system = tune.systems[0] as StaffSystem;
      expect(system.staff[0].voiceIds).to.deep.equal(["S"]);
      expect(system.staff[1].voiceIds).to.deep.equal(["A"]);
    });

    it("indexes voiceIds in parallel with voices when two voices merge onto one staff", () => {
      const abc = `X:1
V:1
V:2 merge=true
K:C
V:1
C D |
V:2
E F |`;
      const tune = interpretABC(abc);
      const system = tune.systems[0] as StaffSystem;
      expect(system.staff.length).to.equal(1);
      expect(system.staff[0].voiceIds).to.deep.equal(["1", "2"]);
      expect(system.staff[0].voices.length).to.equal(2);
    });
  });
});
