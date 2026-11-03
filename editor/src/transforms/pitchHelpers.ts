import { ABCContext, Pitch, Token, TT, Spelling, semitonesToAccidentalString, accidentalTypeToSemitones, mergeAccidentals } from "abcls-parser";
import { measureAccidentalKey } from "abcls-parser/music-theory/pitchUtils";
import { KeySignature } from "abcls-parser/types/abcjs-ast";
import { NATURAL_SEMITONES } from "abcls-parser/music-theory/constants";
import { countOctaveMarkers } from "abcls-parser/music-theory/pitchUtils";
import { AccidentalType } from "abcls-parser/types/abcjs-ast";
import { toAst } from "../csTree/toAst";
import { CSNode, TAGS } from "../csTree/types";
import { findChildByTag } from "./treeUtils";

export type NoteLetter = "C" | "D" | "E" | "F" | "G" | "A" | "B";

export interface PitchComponents {
  letter: NoteLetter;
  octave: number;
  explicitAccidental: string | null;
}

/**
 * Builds a Pitch AST node from a spelling and target MIDI pitch.
 *
 * The octave is calculated from the target MIDI and the letter's natural semitone,
 * which correctly handles enharmonic spellings (B#4 = C5 = MIDI 72, but B# should
 * render in octave 4 notation, not octave 5).
 *
 * @param spelling The spelling (letter and alteration)
 * @param targetMidi The target MIDI pitch (used to determine octave)
 * @param needsExplicitAccidental Whether to include an explicit accidental token
 * @param ctx ABCContext for generating node IDs
 * @returns A new Pitch AST node
 */
export function spellingToPitch(spelling: Spelling, targetMidi: number, needsExplicitAccidental: boolean, ctx: ABCContext): Pitch {
  // Calculate octave using the letter's natural semitone to handle enharmonic spellings.
  // For B#4 (MIDI 72): letterSemitone=11, so octave = round((72 - 11 - 60) / 12) + 4 = round(1/12) + 4 = 4
  // For Cb5 (MIDI 71): letterSemitone=0, so octave = round((71 - 0 - 60) / 12) + 4 = round(11/12) + 4 = 5
  const letterSemitone = NATURAL_SEMITONES[spelling.letter];
  const octave = Math.round((targetMidi - letterSemitone - 60) / 12) + 4;

  let accidentalToken: Token | undefined;
  if (needsExplicitAccidental) {
    accidentalToken = new Token(TT.ACCIDENTAL, semitonesToAccidentalString(spelling.alteration), ctx.generateId());
  }

  let letterStr: string;
  let octaveStr: string;

  if (octave <= 4) {
    letterStr = spelling.letter.toUpperCase();
    octaveStr = ",".repeat(4 - octave);
  } else {
    letterStr = spelling.letter.toLowerCase();
    octaveStr = "'".repeat(octave - 5);
  }

  const letterToken = new Token(TT.NOTE_LETTER, letterStr, ctx.generateId());
  const octaveToken = octaveStr !== "" ? new Token(TT.OCTAVE, octaveStr, ctx.generateId()) : undefined;

  return new Pitch(ctx.generateId(), {
    alteration: accidentalToken,
    noteLetter: letterToken,
    octave: octaveToken,
  });
}

/**
 * Converts ContextSnapshot.measureAccidentals (AccidentalType) to semitones.
 *
 * @param measureAccidentals The map of letter to AccidentalType from ContextSnapshot
 * @returns A map of letter to semitones, or null if input is undefined
 */
export function convertMeasureAccidentalsToSemitones(measureAccidentals: Map<string, AccidentalType> | undefined): Map<string, number> | null {
  if (!measureAccidentals) return null;
  const result = new Map<string, number>();
  for (const [key, accType] of measureAccidentals) {
    result.set(key, accidentalTypeToSemitones(accType));
  }
  return result;
}

/**
 * Computes the octave in which a spelled letter sounds the given MIDI pitch.
 *
 * Because an enharmonic spelling such as Cb5 (MIDI 71) lives in a different octave from the MIDI octave of its pitch,
 * we derive the octave from the letter's natural semitone, in the same way as spellingToPitch does.
 */
export function spellingOctave(letter: NoteLetter, midi: number): number {
  return Math.round((midi - NATURAL_SEMITONES[letter] - 60) / 12) + 4;
}

/**
 * Builds the alteration that is in effect for each letter, at the octave in which that letter would sound the target pitch.
 *
 * Because ABC applies a bar accidental only to the same letter in the same octave, the alteration in effect for a letter
 * depends on the octave in which we intend to write it. Therefore, for each letter we look up the bar accidental stored for
 * the octave that letter would have for the target pitch, and otherwise we fall back on the key signature.
 *
 * @param key The key signature in effect
 * @param measureAccidentals The bar accidentals in semitones, keyed by letter and octave, or null when there are none
 * @param targetMidi The MIDI pitch we intend to spell
 */
export function noteSpellingsForMidi(key: KeySignature, measureAccidentals: Map<string, number> | null, targetMidi: number): ReturnType<typeof mergeAccidentals> {
  const result = mergeAccidentals(key, null);
  if (measureAccidentals === null) return result;
  for (const letter of Object.keys(result) as NoteLetter[]) {
    const stored = measureAccidentals.get(measureAccidentalKey(letter, spellingOctave(letter, targetMidi)));
    if (stored !== undefined) result[letter] = stored;
  }
  return result;
}

/**
 * Extracts pitch components from a note CSNode.
 *
 * Because ABC notation uses letter case to determine the base octave (uppercase = octave 4,
 * lowercase = octave 5) and octave markers (' or ,) to adjust from there, this function
 * extracts the normalized letter, computed octave, and any explicit accidental.
 *
 * @param noteNode A CSNode representing a Note
 * @returns The pitch components, or null if the node has no Pitch child
 */
export function toPitchComponents(noteNode: CSNode): PitchComponents | null {
  const pitchNode = findChildByTag(noteNode, TAGS.Pitch);
  if (!pitchNode) return null;

  const pitchExpr = toAst(pitchNode) as Pitch;
  const rawLetter = pitchExpr.noteLetter.lexeme;
  const letter = rawLetter.toUpperCase() as NoteLetter;
  const baseOctave = rawLetter === rawLetter.toLowerCase() ? 5 : 4;
  const octaveOffset = pitchExpr.octave ? countOctaveMarkers(pitchExpr.octave.lexeme) : 0;
  const octave = baseOctave + octaveOffset;
  const explicitAccidental = pitchExpr.alteration?.lexeme ?? null;

  return { letter, octave, explicitAccidental };
}
