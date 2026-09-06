import { expect } from "chai";
import { Decorations } from "../types/abcjs-ast";
import { ARTICULATION_MAP, INVERSE_ARTICULATION_MAP, INVERSE_ORNAMENT_MAP, ORNAMENT_MAP } from "./decorationMap";

describe("decorationMap inverse lookups", () => {
  it("resolves every forward articulation mapping back to a value present in ARTICULATION_MAP", () => {
    for (const key of Object.keys(ARTICULATION_MAP) as Decorations[]) {
      const musicXmlValue = ARTICULATION_MAP[key];
      expect(musicXmlValue).to.not.be.undefined;
      expect(ARTICULATION_MAP[INVERSE_ARTICULATION_MAP[musicXmlValue!]!]).to.equal(musicXmlValue);
    }
  });

  it("resolves every forward ornament mapping back to a value present in ORNAMENT_MAP", () => {
    for (const key of Object.keys(ORNAMENT_MAP) as Decorations[]) {
      const musicXmlValue = ORNAMENT_MAP[key];
      expect(musicXmlValue).to.not.be.undefined;
      expect(ORNAMENT_MAP[INVERSE_ORNAMENT_MAP[musicXmlValue!]!]).to.equal(musicXmlValue);
    }
  });

  it("resolves ornament collisions to the first-declared Decorations key", () => {
    expect(INVERSE_ORNAMENT_MAP["mordent"]).to.equal(Decorations.Mordent);
    expect(INVERSE_ORNAMENT_MAP["inverted-mordent"]).to.equal(Decorations.UpperMordent);
    expect(INVERSE_ORNAMENT_MAP["fermata"]).to.equal(Decorations.Fermata);
  });

  it("has no undefined entries and every value maps to a key that round-trips", () => {
    expect(Object.keys(INVERSE_ARTICULATION_MAP).length).to.be.greaterThan(0);
    expect(Object.keys(INVERSE_ORNAMENT_MAP).length).to.be.greaterThan(0);
  });
});
