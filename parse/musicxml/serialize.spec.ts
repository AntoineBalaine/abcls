import { expect } from "chai";
import { escapeText, escapeAttr, serializeScorePartwise } from "./serialize";
import { ScorePartwiseIR } from "./ir";
import { validateAgainstMusicXmlSchema } from "./testSupport/xsdValidation";

describe("escaping", () => {
  it("escapes ampersand, angle brackets in text", () => {
    expect(escapeText("A & B < C > D")).to.equal("A &amp; B &lt; C &gt; D");
  });

  it("escapes double quotes in attribute values in addition to text escapes", () => {
    expect(escapeAttr('say "hi" & bye')).to.equal("say &quot;hi&quot; &amp; bye");
  });
});

describe("serializeScorePartwise", () => {
  it("emits a minimal valid document that passes MusicXML XSD validation", () => {
    const ir: ScorePartwiseIR = {
      partList: [{ kind: "score-part", part: { id: "P1", name: "P1" } }],
      parts: [
        {
          id: "P1",
          measures: [
            {
              number: 1,
              attributes: { divisions: 1 },
              content: [{ kind: "note", voice: 1, duration: 4, pitch: { step: "C", octave: 4 } }],
            },
          ],
        },
      ],
    };
    const xml = serializeScorePartwise(ir);
    expect(xml).to.include("<?xml version=");
    expect(xml).to.include("<score-partwise");
    const result = validateAgainstMusicXmlSchema(xml);
    expect(result.valid, result.errors.join("\n")).to.equal(true);
  });

  it("emits a chord as a first note followed by chord-marked notes", () => {
    const ir: ScorePartwiseIR = {
      partList: [{ kind: "score-part", part: { id: "P1", name: "P1" } }],
      parts: [
        {
          id: "P1",
          measures: [
            {
              number: 1,
              attributes: { divisions: 1 },
              content: [
                { kind: "note", voice: 1, duration: 4, pitch: { step: "C", octave: 4 } },
                { kind: "note", voice: 1, duration: 4, pitch: { step: "E", octave: 4 }, chord: true },
              ],
            },
          ],
        },
      ],
    };
    const xml = serializeScorePartwise(ir);
    const result = validateAgainstMusicXmlSchema(xml);
    expect(result.valid, result.errors.join("\n")).to.equal(true);
    expect(xml.indexOf("<chord/>")).to.be.lessThan(xml.lastIndexOf("<pitch>"));
  });
});
