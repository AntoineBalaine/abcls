/**
 * Typed intermediate representation for the subset of the MusicXML 4.0
 * partwise schema this module produces. Field names follow the XSD
 * element/attribute names directly.
 */

export interface PitchIR {
  step: string;
  octave: number;
  alter?: number;
}

export interface NotationsIR {
  tiedStart?: boolean;
  tiedStop?: boolean;
  slurStarts?: number[];
  slurStops?: number[];
  articulations?: string[];
  ornaments?: string[];
  technical?: string[];
  // MusicXML's <fermata> is a direct child of <notations>, not <ornaments>.
  fermata?: "upright" | "inverted";
}

export interface GraceIR {
  slash: boolean;
}

export interface NoteIR {
  kind: "note" | "backup" | "forward";
  voice?: number;
  duration?: number;
  pitch?: PitchIR;
  rest?: boolean;
  chord?: boolean;
  tieStart?: boolean;
  tieStop?: boolean;
  grace?: GraceIR;
  notations?: NotationsIR;
}

export interface AttributesIR {
  divisions?: number;
  keyFifths?: number;
  keyMode?: string;
  timeBeats?: string;
  timeBeatType?: string;
  timeSymbol?: "common" | "cut";
  clefSign?: string;
  clefLine?: number;
  clefOctaveChange?: number;
}

export interface MeasureIR {
  number: number;
  attributes?: AttributesIR;
  content: NoteIR[];
}

export interface ScorePartIR {
  id: string;
  name: string;
}

export interface PartGroupBoundaryIR {
  kind: "start" | "stop";
  number: number;
  symbol?: "brace" | "bracket";
  barlineGroup?: boolean;
}

export type PartListEntryIR = { kind: "score-part"; part: ScorePartIR } | { kind: "part-group"; boundary: PartGroupBoundaryIR };

export interface PartIR {
  id: string;
  measures: MeasureIR[];
}

export interface ScorePartwiseIR {
  partList: PartListEntryIR[];
  parts: PartIR[];
}
