/**
 * Regression tests for two pre-existing interpreter bugs found while planning
 * MusicXML export/import: bang-delimited decorations (e.g. !trill!) were
 * silently dropped, and slur closes were lost because pendingStartSlurs was
 * cleared before the matching close token was visited.
 */

import { expect } from "chai";
import { SemanticAnalyzer } from "../analyzers/semantic-analyzer";
import { ABCContext } from "../parsers/Context";
import { AbcErrorReporter } from "../parsers/ErrorReporter";
import { parse } from "../parsers/parse";
import { Scanner } from "../parsers/scan";
import { Decorations, NoteElement, StaffSystem } from "../types/abcjs-ast";
import { TuneInterpreter } from "./TuneInterpreter";

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

function firstVoiceElements(tune: ReturnType<typeof interpretABC>): NoteElement[] {
  const system = tune.systems[0] as StaffSystem;
  return system.staff[0].voices[0] as NoteElement[];
}

describe("Bang-delimited decorations", () => {
  it("attaches a known !decoration! to the following note instead of dropping it", () => {
    const tune = interpretABC(`X:1\nK:C\n!trill!C D E F |`);
    const elements = firstVoiceElements(tune);
    const noteC = elements[0];
    expect(noteC.pitches?.[0]).to.exist;
    expect(noteC.decoration).to.deep.equal([Decorations.Trill]);
  });

  it("attaches a known +decoration+ (old-style) to the following note", () => {
    const tune = interpretABC(`X:1\nK:C\n+trill+C D E F |`);
    const elements = firstVoiceElements(tune);
    expect(elements[0].decoration).to.deep.equal([Decorations.Trill]);
  });

  it("still ignores unrecognized bang-delimited content rather than treating it as a decoration", () => {
    const tune = interpretABC(`X:1\nK:C\n!unknownvendorext!C D E F |`);
    const elements = firstVoiceElements(tune);
    expect(elements[0].decoration).to.be.undefined;
  });

  it("continues to support single-character decorations unaffected by this fix", () => {
    const tune = interpretABC(`X:1\nK:C\n.C D E F |`);
    const elements = firstVoiceElements(tune);
    expect(elements[0].decoration).to.deep.equal([Decorations.Staccato]);
  });
});

describe("Slur closes", () => {
  it("sets endSlur on the note carrying the closing paren, not just startSlur on the opening note", () => {
    const tune = interpretABC(`X:1\nK:C\n(C D E) F |`);
    const elements = firstVoiceElements(tune);
    const [noteC, , noteE] = elements;

    expect(noteC.pitches?.[0].startSlur).to.exist;
    expect(noteC.pitches?.[0].startSlur?.length).to.equal(1);
    const label = noteC.pitches![0].startSlur![0].label;

    expect(noteE.pitches?.[0].endSlur).to.exist;
    expect(noteE.pitches?.[0].endSlur).to.deep.equal([label]);
  });

  it("handles two sequential, non-overlapping slurs with distinct labels", () => {
    const tune = interpretABC(`X:1\nK:C\n(C D) (E F) |`);
    const elements = firstVoiceElements(tune);
    const [noteC, noteD, noteE, noteF] = elements;

    const firstLabel = noteC.pitches![0].startSlur![0].label;
    const secondLabel = noteE.pitches![0].startSlur![0].label;

    expect(firstLabel).to.not.equal(secondLabel);
    expect(noteD.pitches?.[0].endSlur).to.deep.equal([firstLabel]);
    expect(noteF.pitches?.[0].endSlur).to.deep.equal([secondLabel]);
  });

  it("pairs nested slurs correctly, closing the inner slur before the outer one", () => {
    const tune = interpretABC(`X:1\nK:C\n(C (D E) F) |`);
    const elements = firstVoiceElements(tune);
    const [noteC, noteD, noteE, noteF] = elements;

    const outerLabel = noteC.pitches![0].startSlur![0].label;
    const innerLabel = noteD.pitches![0].startSlur![0].label;

    expect(innerLabel).to.not.equal(outerLabel);
    expect(noteE.pitches?.[0].endSlur).to.deep.equal([innerLabel]);
    expect(noteF.pitches?.[0].endSlur).to.deep.equal([outerLabel]);
  });
});
