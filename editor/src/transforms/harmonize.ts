import { remove, replace, getParent, appendChild, insertAfter } from "abcls-cstree";
import { ABCContext, Pitch, TT, Token, Note, Chord } from "abcls-parser";
import {
  VoicedNote,
  Spelling,
  ParsedChord,
  buildChord,
  invert,
  isChordTone,
  isChordScaleTone,
  getAvailableTensions,
  buildChordScale,
  buildClusterVoicing,
  substituteTensions,
  descendScale,
  deriveDiatonicChord,
  getKeyAccidentalFor,
  FUNC_FOR_TENSION,
  LETTERS,
  noteLetterToMidi,
  semitonesToAccidentalString,
  accidentalToSemitones,
  accidentalTypeToSemitones,
  buildSpreadVoicing,
  ChordFunction,
  ChordPosition,
  findPreviousChordInVoice,
  voicedNoteOctave,
} from "abcls-parser";
import { DocumentSnapshots, ContextSnapshot, getSnapshotAtPosition, encode } from "abcls-parser/interpreter/ContextInterpreter";
import { KeySignature } from "abcls-parser/types/abcjs-ast";
import { fromAst } from "../csTree/fromAst";
import { toAst } from "../csTree/toAst";
import { createCSNode, CSNode, TAGS } from "../csTree/types";
import { Selection } from "../selection";
import { toPitchComponents, NoteLetter } from "./pitchHelpers";
import { findChildByTag, findTieChild, getNodeLineAndChar } from "./treeUtils";
import { findNodesById } from "./types";

const DIATONIC_LETTERS = "CDEFGAB";

/**
 * Converts an ABC Pitch AST node to a diatonic index (0-6) and octave number.
 * - Uppercase letters (C-B) are octave 4
 * - Lowercase letters (c-b) are octave 5
 * - Each comma lowers the octave by 1
 * - Each apostrophe raises the octave by 1
 */
export function pitchToDiatonic(pitch: Pitch): { index: number; octave: number } {
  const letter = pitch.noteLetter.lexeme;
  const baseIndex = DIATONIC_LETTERS.indexOf(letter.toUpperCase());

  const baseOctave = letter === letter.toLowerCase() ? 5 : 4;

  let octaveOffset = 0;
  if (pitch.octave) {
    for (const char of pitch.octave.lexeme) {
      if (char === "'") octaveOffset++;
      else if (char === ",") octaveOffset--;
    }
  }

  return { index: baseIndex, octave: baseOctave + octaveOffset };
}

/**
 * Converts a diatonic index and octave back to an ABC Pitch AST node.
 */
export function diatonicToPitch(index: number, octave: number, alteration: Token | undefined, ctx: ABCContext): Pitch {
  const normalizedIndex = ((index % 7) + 7) % 7;
  let letter = DIATONIC_LETTERS[normalizedIndex];

  let octaveToken: Token | undefined;

  if (octave >= 5) {
    letter = letter.toLowerCase();
    const octaveOffset = octave - 5;
    if (octaveOffset > 0) {
      octaveToken = new Token(TT.OCTAVE, "'".repeat(octaveOffset), ctx.generateId());
    }
  } else {
    const octaveOffset = 4 - octave;
    if (octaveOffset > 0) {
      octaveToken = new Token(TT.OCTAVE, ",".repeat(octaveOffset), ctx.generateId());
    }
  }

  const noteLetterToken = new Token(TT.NOTE_LETTER, letter, ctx.generateId());

  return new Pitch(ctx.generateId(), {
    alteration: alteration,
    noteLetter: noteLetterToken,
    octave: octaveToken,
  });
}

/**
 * Steps a pitch diatonically by the given number of steps (positive = up, negative = down).
 * The alteration (accidental) is preserved from the original pitch.
 */
export function stepDiatonic(pitch: Pitch, steps: number, ctx: ABCContext): Pitch {
  const { index, octave } = pitchToDiatonic(pitch);

  const newIndex = index + steps;
  const octaveShift = Math.floor(newIndex / 7);
  const normalizedIndex = ((newIndex % 7) + 7) % 7;

  return diatonicToPitch(normalizedIndex, octave + octaveShift, pitch.alteration, ctx);
}

/**
 * Wraps a standalone note in a chord with its harmony note.
 * The rhythm and tie are moved from the note to the chord level.
 */
function wrapNoteInChord(noteNode: CSNode, steps: number, ctx: ABCContext): void {
  const pitchNode = findChildByTag(noteNode, TAGS.Pitch);
  if (pitchNode === null) {
    return;
  }

  // We need a parent to splice the chord into the tree
  const parent = getParent(noteNode);
  if (parent === null) {
    return;
  }

  // Compute the harmony pitch
  const pitchExpr = toAst(pitchNode) as Pitch;
  const harmonyPitchExpr = stepDiatonic(pitchExpr, steps, ctx);

  // Create harmony note (pitch only, no rhythm/tie)
  const harmonyNoteExpr = new Note(ctx.generateId(), harmonyPitchExpr, undefined, undefined);
  const harmonyNoteCSNode = fromAst(harmonyNoteExpr, ctx);

  // Extract rhythm and tie from original note (will move to chord level)
  let rhythmNode: CSNode | null = null;
  let tieNode: CSNode | null = null;

  rhythmNode = findChildByTag(noteNode, TAGS.Rhythm);
  if (rhythmNode !== null) {
    remove(rhythmNode);
  }

  tieNode = findTieChild(noteNode);
  if (tieNode !== null) {
    remove(tieNode);
  }

  // Create chord CSNode
  const chordCSNode = createCSNode(TAGS.Chord, ctx.generateId(), null);

  // Create bracket tokens
  const leftBracketCSNode = fromAst(new Token(TT.CHRD_LEFT_BRKT, "[", ctx.generateId()), ctx);
  const rightBracketCSNode = fromAst(new Token(TT.CHRD_RIGHT_BRKT, "]", ctx.generateId()), ctx);

  // Replace the note with the chord in the tree (this detaches noteNode and sets chordCSNode in its place)
  replace(noteNode, chordCSNode);

  // Build chord's child linked list: leftBracket -> note -> harmonyNote -> rightBracket -> rhythm? -> tie?
  // All these nodes have parentRef === null (freshly created or detached via replace/remove).
  appendChild(chordCSNode, leftBracketCSNode);
  appendChild(chordCSNode, noteNode);
  appendChild(chordCSNode, harmonyNoteCSNode);
  appendChild(chordCSNode, rightBracketCSNode);
  if (rhythmNode !== null) {
    appendChild(chordCSNode, rhythmNode);
  }
  if (tieNode !== null) {
    appendChild(chordCSNode, tieNode);
  }
}

/**
 * Adds harmony notes inside an existing chord.
 * For each note in the chord, a harmony note is created and inserted
 * immediately after it (to maintain note/harmony pairing order).
 */
function harmonizeChord(chordNode: CSNode, steps: number, ctx: ABCContext): void {
  // Collect all original notes in the chord (to avoid modifying while iterating)
  const notesToHarmonize: CSNode[] = [];
  let current = chordNode.firstChild;
  while (current !== null) {
    if (current.tag === TAGS.Note) {
      notesToHarmonize.push(current);
    }
    current = current.nextSibling;
  }

  // Create harmony notes for each original note
  const harmonyNotes: CSNode[] = [];
  for (const noteNode of notesToHarmonize) {
    const pitchNode = findChildByTag(noteNode, TAGS.Pitch);
    if (pitchNode === null) {
      continue;
    }

    const pitchExpr = toAst(pitchNode) as Pitch;
    const harmonyPitchExpr = stepDiatonic(pitchExpr, steps, ctx);

    const harmonyNoteExpr = new Note(ctx.generateId(), harmonyPitchExpr, undefined, undefined);
    harmonyNotes.push(fromAst(harmonyNoteExpr, ctx));
  }

  // Find the last original note in the chord
  let lastOriginalNote: CSNode | null = null;
  current = chordNode.firstChild;
  while (current !== null) {
    if (current.tag === TAGS.Note) {
      lastOriginalNote = current;
    }
    current = current.nextSibling;
  }

  if (lastOriginalNote === null || harmonyNotes.length === 0) {
    return;
  }

  // Insert all harmony notes after the last original note.
  // This produces [C E A c] from [C A] with +2 steps (E follows C, c follows A).
  let insertAnchor: CSNode = lastOriginalNote;
  for (const harmonyNote of harmonyNotes) {
    insertAfter(insertAnchor, harmonyNote);
    insertAnchor = harmonyNote;
  }
}

/**
 * Harmonizes selected notes by adding a parallel harmony voice at the specified interval.
 *
 * @param selection - The selection containing cursor IDs pointing to Notes or Chords
 * @param steps - The number of diatonic steps to shift (positive = up, negative = down)
 *   - 3rd: ±2 steps
 *   - 4th: ±3 steps
 *   - 5th: ±4 steps
 *   - 6th: ±5 steps
 * @param ctx - The ABC context for generating IDs
 * @returns The modified selection
 */
export function harmonize(selection: Selection, steps: number, ctx: ABCContext): Selection {
  if (steps === 0) {
    return selection;
  }

  for (const cursor of selection.cursors) {
    const nodes = findNodesById(selection.root, cursor);
    for (const csNode of nodes) {
      if (csNode.tag === TAGS.Note) {
        wrapNoteInChord(csNode, steps, ctx);
      } else if (csNode.tag === TAGS.Chord) {
        harmonizeChord(csNode, steps, ctx);
      }
    }
  }

  return selection;
}

// ============================================================================
// Phase 5: Chord-Symbol-Based Harmonization
// ============================================================================

/**
 * Voicing types supported by harmonizeVoicing.
 * - close: Notes placed as close together as possible
 * - cluster: Notes placed in a cluster voicing from the chord scale
 * - spread: Jazz spread voicing using decision tree placement
 *
 * The drop voicings (drop2, drop24, drop3) rearrange a chord that is already
 * written, rather than building one under a lead note, so they live in
 * dropVoicing/DropVoicing (./revoice) instead of here.
 */
export type VoicingType = "close" | "cluster" | "spread";

/**
 * Snapshot of the harmonic context at a given position.
 * Used for extractLead and related helper functions that need
 * a simplified view of the musical context.
 */
export interface HarmonizeSnapshot {
  key: KeySignature;
  currentChord: ParsedChord | null;
  measureAccidentals: Map<string, number>; // letter -> semitones
}

/**
 * Converts a ContextSnapshot to a HarmonizeSnapshot.
 * This allows harmonize functions to work with the ContextInterpreter's output.
 */
export function contextToHarmonizeSnapshot(context: ContextSnapshot, localAccidentals: Map<string, number>): HarmonizeSnapshot {
  const measureAccidentals = new Map<string, number>();

  // First apply context accidentals (converted from AccidentalType to semitones)
  if (context.measureAccidentals) {
    for (const [letter, accType] of context.measureAccidentals) {
      measureAccidentals.set(letter, accidentalTypeToSemitones(accType));
    }
  }

  // Then overlay local accidentals (which are already in semitones)
  for (const [letter, semitones] of localAccidentals) {
    measureAccidentals.set(letter, semitones);
  }

  return {
    key: context.key,
    currentChord: context.currentChord ?? null,
    measureAccidentals,
  };
}

/**
 * Extracts the letter name, MIDI pitch, and alteration from a CSNode representing a note.
 * The pitch is resolved using the snapshot's key signature and measure accidentals.
 */
export function extractLead(node: CSNode, snapshot: HarmonizeSnapshot): { letter: NoteLetter; midi: number; alteration: number } | null {
  const pitchComponents = toPitchComponents(node);
  if (!pitchComponents) return null;

  const { letter, octave, explicitAccidental } = pitchComponents;
  const baseMidi = noteLetterToMidi(letter, octave);

  // Determine alteration from explicit accidental, measure accidentals, or key signature
  let alteration = 0;
  if (explicitAccidental) {
    alteration = accidentalToSemitones(explicitAccidental);
  } else if (snapshot.measureAccidentals.has(letter)) {
    alteration = snapshot.measureAccidentals.get(letter)!;
  } else {
    alteration = getKeyAccidentalFor(letter, snapshot.key);
  }

  const midi = baseMidi + alteration;
  // MIDI pitch must be in valid range 0-127
  if (midi < 0 || midi > 127) return null;
  return { letter, midi, alteration };
}

/**
 * Converts a lead note (with func) into a VoicedNote for spread voicing.
 * The func is determined by checking if the lead is a chord tone or tension.
 */
export function extractLeadAsVoicedNote(
  lead: { letter: "C" | "D" | "E" | "F" | "G" | "A" | "B"; midi: number; alteration: number },
  rootPosChord: VoicedNote[],
  tensions: Map<9 | 11 | 13, VoicedNote>
): VoicedNote | null {
  const pitchClass = lead.midi % 12;

  // Check if lead is a chord tone
  for (const note of rootPosChord) {
    if (note.midi % 12 === pitchClass) {
      return {
        spelling: { letter: lead.letter, alteration: lead.alteration },
        midi: lead.midi,
        func: note.func,
      };
    }
  }

  // Check if lead is a tension
  for (const [func, tension] of tensions) {
    if (tension.midi % 12 === pitchClass) {
      return {
        spelling: { letter: lead.letter, alteration: lead.alteration },
        midi: lead.midi,
        func: func as ChordFunction,
      };
    }
  }

  return null;
}

/**
 * Builds a map from letter to current alteration (combining key signature and measure accidentals).
 */
function buildCurrentPitchMap(snapshot: HarmonizeSnapshot): Map<string, number> {
  const result = new Map<string, number>();
  for (const letter of LETTERS) {
    result.set(letter, getKeyAccidentalFor(letter, snapshot.key));
  }
  for (const [letter, alt] of snapshot.measureAccidentals) {
    result.set(letter, alt);
  }
  return result;
}

/**
 * Formats a note as an ABC string with accidental, letter, and octave markers.
 */
export function formatNote(accidental: string, letter: string, octave: number): string {
  let noteLetter: string;
  let markers: string;

  if (octave <= 4) {
    noteLetter = letter.toUpperCase();
    markers = ",".repeat(4 - octave);
  } else {
    noteLetter = letter.toLowerCase();
    markers = "'".repeat(octave - 5);
  }

  return accidental + noteLetter + markers;
}

/**
 * Finds a tension in the tension map by its pitch class.
 */
function findTensionByPitchClass(tensions: Map<9 | 11 | 13, VoicedNote>, midi: number): VoicedNote | null {
  const pitchClass = midi % 12;
  for (const t of tensions.values()) {
    if (t.midi % 12 === pitchClass) return t;
  }
  return null;
}

/**
 * Converts a voiced chord to a Chord AST node.
 * Returns the Chord AST and a list of spellings that need explicit accidentals.
 */
export function toChordAst(voicedChord: VoicedNote[], snapshot: HarmonizeSnapshot, ctx: ABCContext): { chordAst: Chord; newAccidentals: Spelling[] } {
  const currentPitchMap = buildCurrentPitchMap(snapshot);
  const notes: Note[] = [];
  const newAccidentals: Spelling[] = [];

  for (const note of voicedChord) {
    // Calculate octave based on the letter's natural pitch, not just MIDI.
    // This handles enharmonic spellings correctly (e.g., Cb5 = MIDI 71 should be lowercase _c).
    const octave = voicedNoteOctave(note);
    const contextAlteration = currentPitchMap.get(note.spelling.letter) ?? 0;

    let accidentalToken: Token | undefined;
    if (note.spelling.alteration !== contextAlteration) {
      const accString = semitonesToAccidentalString(note.spelling.alteration);
      accidentalToken = new Token(TT.ACCIDENTAL, accString, ctx.generateId());
      newAccidentals.push(note.spelling);
    }

    // Create note letter token
    let noteLetter = note.spelling.letter;
    let octaveToken: Token | undefined;

    if (octave <= 4) {
      noteLetter = noteLetter.toUpperCase() as "C" | "D" | "E" | "F" | "G" | "A" | "B";
      if (4 - octave > 0) {
        octaveToken = new Token(TT.OCTAVE, ",".repeat(4 - octave), ctx.generateId());
      }
    } else {
      noteLetter = noteLetter.toLowerCase() as "C" | "D" | "E" | "F" | "G" | "A" | "B";
      if (octave - 5 > 0) {
        octaveToken = new Token(TT.OCTAVE, "'".repeat(octave - 5), ctx.generateId());
      }
    }

    const noteLetterToken = new Token(TT.NOTE_LETTER, noteLetter, ctx.generateId());

    const pitch = new Pitch(ctx.generateId(), {
      alteration: accidentalToken,
      noteLetter: noteLetterToken,
      octave: octaveToken,
    });

    const noteAst = new Note(ctx.generateId(), pitch, undefined, undefined);
    notes.push(noteAst);
  }

  const leftBracket = new Token(TT.CHRD_LEFT_BRKT, "[", ctx.generateId());
  const rightBracket = new Token(TT.CHRD_RIGHT_BRKT, "]", ctx.generateId());

  const chordAst = new Chord(ctx.generateId(), notes, undefined, undefined, leftBracket, rightBracket);

  return { chordAst, newAccidentals };
}

/**
 * Converts a voiced chord to a CSNode.
 */
export function toCSChord(voicedChord: VoicedNote[], snapshot: HarmonizeSnapshot, ctx: ABCContext): { csNode: CSNode; newAccidentals: Spelling[] } {
  const { chordAst, newAccidentals } = toChordAst(voicedChord, snapshot, ctx);
  const csNode = fromAst(chordAst, ctx);
  return { csNode, newAccidentals };
}

/**
 * Harmonizes selected notes using chord-symbol-based voicing.
 *
 * This transform builds full voiced chords from lead notes using:
 * - The current chord symbol (from snapshots) or a diatonic chord derived from the key
 * - Various voicing types (close, cluster, spread)
 * - Voice count (4, 5, or 6 voices)
 *
 * @param selection The selection containing note node IDs
 * @param voicing The voicing type to use
 * @param voiceCount Number of voices in the output (4, 5, or 6)
 * @param degree Diatonic degree for chord derivation (null = use current chord symbol)
 * @param ctx ABCContext for generating node IDs
 * @param snapshots DocumentSnapshots from ContextInterpreter
 * @returns The modified selection
 */
export function harmonizeVoicing(
  selection: Selection,
  voicing: VoicingType,
  voiceCount: number,
  degree: number | null,
  ctx: ABCContext,
  snapshots: DocumentSnapshots,
  chordPositions: ChordPosition[] | null
): Selection {
  // Local state for tracking accidentals written during this transform pass.
  // Because the transform may write multiple chords in sequence, we need to
  // track the accidentals we've written so that subsequent notes in the same
  // measure use the correct context.
  const localAccidentals = new Map<string, number>();

  for (const cursor of selection.cursors) {
    const nodes = findNodesById(selection.root, cursor);
    for (const csNode of nodes) {
      if (csNode.tag !== TAGS.Note) continue;

      const { line, char } = getNodeLineAndChar(csNode);
      const pos = encode(line, char);
      // Use pos - 1 to get the snapshot BEFORE this note, not the one created
      // when this note was visited. This ensures we see the measure accidentals
      // as they were before this note was processed.
      const contextSnapshot = getSnapshotAtPosition(snapshots, pos - 1);
      if (!contextSnapshot) continue;

      const snapshot = contextToHarmonizeSnapshot(contextSnapshot, localAccidentals);

      const lead = extractLead(csNode, snapshot);
      if (!lead) continue;

      // Resolve chord: either from current chord symbol or derive diatonically
      let chord: ParsedChord | null;
      if (degree === null) {
        chord = snapshot.currentChord;
        if (!chord) continue;
      } else {
        const rootLetter = descendScale(lead.letter, degree);
        chord = deriveDiatonicChord(rootLetter, snapshot.key);
      }

      // Build root position chord with lead on top
      const rootPosChord = buildChord(chord, lead.midi);
      let tensions: Map<9 | 11 | 13, VoicedNote> | null = null;
      let leadTension: VoicedNote | null = null;
      let voicedChord: VoicedNote[];

      if (voicing === "cluster") {
        // Cluster voicing: build from chord scale
        if (!isChordScaleTone(lead.midi, rootPosChord, chord, snapshot.key)) continue;
        tensions = getAvailableTensions(rootPosChord, chord, snapshot.key);
        const chordScale = buildChordScale(rootPosChord, tensions);
        voicedChord = buildClusterVoicing(chordScale, lead.midi, voiceCount);
      } else if (voicing === "spread") {
        // Spread voicing: uses decision tree placement algorithm
        if (!isChordScaleTone(lead.midi, rootPosChord, chord, snapshot.key)) continue;
        tensions = getAvailableTensions(rootPosChord, chord, snapshot.key);

        const leadNote = extractLeadAsVoicedNote(lead, rootPosChord, tensions);
        if (!leadNote) continue;

        // Find previous chord for voice leading
        let prevMidi: number[] | null = null;
        if (chordPositions !== null) {
          const prevChord = findPreviousChordInVoice(chordPositions, contextSnapshot.voiceId, pos);
          prevMidi = prevChord?.midiPitches ?? null;
        }

        const spreadResult = buildSpreadVoicing(rootPosChord, tensions, leadNote, voiceCount as 4 | 5 | 6, prevMidi);
        if (!spreadResult) continue;
        voicedChord = spreadResult;
      } else {
        // Mechanical close-position voicing
        if (voiceCount === 6) {
          if (!isChordScaleTone(lead.midi, rootPosChord, chord, snapshot.key)) continue;
          tensions = getAvailableTensions(rootPosChord, chord, snapshot.key);
          leadTension = findTensionByPitchClass(tensions, lead.midi);
          voicedChord = invert(rootPosChord, lead.midi);
          if (leadTension) {
            voicedChord.push({ ...leadTension, midi: lead.midi });
          }
        } else if (voiceCount === 5) {
          if (!isChordScaleTone(lead.midi, rootPosChord, chord, snapshot.key)) continue;
          tensions = getAvailableTensions(rootPosChord, chord, snapshot.key);
          leadTension = findTensionByPitchClass(tensions, lead.midi);

          if (leadTension) {
            const substitutedFunc = FUNC_FOR_TENSION[leadTension.func as 9 | 11 | 13];
            const filteredChord = rootPosChord.filter((n) => n.func !== substitutedFunc);
            voicedChord = invert(filteredChord, lead.midi);
            voicedChord.push({ ...leadTension, midi: lead.midi });
          } else {
            voicedChord = invert(rootPosChord, lead.midi);
          }
        } else {
          // voiceCount === 4
          if (!isChordTone(lead.midi, rootPosChord)) continue;
          voicedChord = invert(rootPosChord, lead.midi);
        }

        // Handle 5-voice doubling: double the lead an octave below
        if (voiceCount === 5) {
          const leadNote = voicedChord[voicedChord.length - 1];
          voicedChord = [{ ...leadNote, midi: leadNote.midi - 12 }, ...voicedChord];
        }

        // Handle 6-voice doubling and tension substitution
        if (voiceCount === 6) {
          if (voicedChord.length === 5) {
            // Lead was a tension
            const leadNote = voicedChord[voicedChord.length - 1];
            voicedChord = [{ ...leadNote, midi: leadNote.midi - 12 }, ...voicedChord];
            voicedChord.sort((a, b) => a.midi - b.midi);
            tensions!.delete(leadTension!.func as 9 | 11 | 13);
            voicedChord = substituteTensions(voicedChord, tensions!);
          } else {
            // Lead was a chord tone
            const leadNote = voicedChord[voicedChord.length - 1];
            const v2 = voicedChord[voicedChord.length - 2];
            voicedChord = [{ ...v2, midi: v2.midi - 12 }, { ...leadNote, midi: leadNote.midi - 12 }, ...voicedChord];
            voicedChord.sort((a, b) => a.midi - b.midi);
            voicedChord = substituteTensions(voicedChord, tensions!);
          }
        }
      }

      // Convert to CSNode and replace the original note
      const { csNode: chordCsNode, newAccidentals } = toCSChord(voicedChord, snapshot, ctx);

      const parent = getParent(csNode);
      if (parent) {
        replace(csNode, chordCsNode);
      }

      // Update local accidentals for subsequent notes in the same transform pass
      for (const spelling of newAccidentals) {
        localAccidentals.set(spelling.letter, spelling.alteration);
      }
    }
  }

  return selection;
}
