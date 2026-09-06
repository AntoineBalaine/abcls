import { Decorations } from "../types/abcjs-ast";

export const ARTICULATION_MAP: Partial<Record<Decorations, string>> = {
  [Decorations.Staccato]: "staccato",
  [Decorations.Tenuto]: "tenuto",
  [Decorations.Accent]: "accent",
  [Decorations.Marcato]: "strong-accent",
  [Decorations.Upbow]: "up-bow",
  [Decorations.Downbow]: "down-bow",
  [Decorations.Wedge]: "wedge",
};

export const ORNAMENT_MAP: Partial<Record<Decorations, string>> = {
  [Decorations.Trill]: "trill-mark",
  [Decorations.Mordent]: "mordent",
  [Decorations.LowerMordent]: "mordent",
  [Decorations.UpperMordent]: "inverted-mordent",
  [Decorations.Pralltriller]: "inverted-mordent",
  [Decorations.Turn]: "turn",
  [Decorations.InvertedTurn]: "inverted-turn",
  [Decorations.Fermata]: "fermata",
  [Decorations.InvertedFermata]: "fermata",
};

function buildInverseMap(map: Partial<Record<Decorations, string>>): Partial<Record<string, Decorations>> {
  const inverse: Partial<Record<string, Decorations>> = {};
  for (const key of Object.keys(map) as Decorations[]) {
    const value = map[key];
    if (value === undefined || value in inverse) continue;
    inverse[value] = key;
  }
  return inverse;
}

// Several Decorations values collide onto the same MusicXML string (mordent/lowerMordent,
// upperMordent/pralltriller, fermata/invertedFermata); buildInverseMap resolves each
// collision by keeping whichever Decorations key is declared first in the maps above.
export const INVERSE_ARTICULATION_MAP = buildInverseMap(ARTICULATION_MAP);
export const INVERSE_ORNAMENT_MAP = buildInverseMap(ORNAMENT_MAP);
