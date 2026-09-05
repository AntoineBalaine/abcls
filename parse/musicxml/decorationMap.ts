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
