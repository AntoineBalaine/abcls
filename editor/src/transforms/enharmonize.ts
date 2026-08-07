import { replace } from "abcls-cstree";
import { ABCContext, Pitch, Token, TT, toMidiPitch, fromMidiPitch, mergeAccidentals, semitonesToAccidentalType } from "abcls-parser";
import { DocumentSnapshots, ContextSnapshot, encode, getSnapshotAtPosition, binarySearchFloor } from "abcls-parser/interpreter/ContextInterpreter";
import {
  findDiatonicSpelling,
  getEnharmonicSpellings,
  chooseBestChromatic,
  resolveMelodyPitch,
  PitchContext,
  noteLetterToMidi,
  accidentalToSemitones,
} from "abcls-parser/music-theory/pitchUtils";
import { fromAst } from "../csTree/fromAst";
import { toAst } from "../csTree/toAst";
import { CSNode, TAGS, isTokenNode, getTokenData } from "../csTree/types";
import { Selection } from "../selection";
import { selectNotes, selectNotesOrChords } from "../selectors/typeSelectors";
import { insertSnapshotSorted } from "./parallel";
import { spellingToPitch, convertMeasureAccidentalsToSemitones, toPitchComponents, NoteLetter } from "./pitchHelpers";
import { findChildByTag, getNodeLineAndChar } from "./treeUtils";
import { findNodesById } from "./types";

const FLAT_SPELLING: { letter: string; accidental: string | null }[] = [
  { letter: "C", accidental: null }, // 0
  { letter: "D", accidental: "_" }, // 1
  { letter: "D", accidental: null }, // 2
  { letter: "E", accidental: "_" }, // 3
  { letter: "E", accidental: null }, // 4
  { letter: "F", accidental: null }, // 5
  { letter: "G", accidental: "_" }, // 6
  { letter: "G", accidental: null }, // 7
  { letter: "A", accidental: "_" }, // 8
  { letter: "A", accidental: null }, // 9
  { letter: "B", accidental: "_" }, // 10
  { letter: "B", accidental: null }, // 11
];

export function fromMidiPitchFlat(midiPitch: number, ctx: ABCContext): Pitch {
  const pitchClass = ((midiPitch % 12) + 12) % 12;
  const { letter, accidental } = FLAT_SPELLING[pitchClass];

  const midiOctave = Math.floor(midiPitch / 12) - 1;

  let noteLetterToken: Token;
  let accidentalToken: Token | undefined;
  let octaveToken: Token | undefined;

  if (midiOctave <= 4) {
    noteLetterToken = new Token(TT.NOTE_LETTER, letter, ctx.generateId());
    if (midiOctave < 4) {
      octaveToken = new Token(TT.OCTAVE, ",".repeat(4 - midiOctave), ctx.generateId());
    }
  } else {
    noteLetterToken = new Token(TT.NOTE_LETTER, letter.toLowerCase(), ctx.generateId());
    if (midiOctave > 5) {
      octaveToken = new Token(TT.OCTAVE, "'".repeat(midiOctave - 5), ctx.generateId());
    }
  }

  if (accidental) {
    accidentalToken = new Token(TT.ACCIDENTAL, accidental, ctx.generateId());
  }

  return new Pitch(ctx.generateId(), {
    alteration: accidentalToken,
    noteLetter: noteLetterToken,
    octave: octaveToken,
  });
}

export function enharmonize(selection: Selection, ctx: ABCContext): Selection {
  // A range-based selection can independently match both a Chord and its child
  // Notes (e.g. the LSP's default tag set is [Note, Chord]), producing separate
  // cursors for the same notes. Since respelling is a toggle, processing a note
  // twice would flip it back to its original spelling. Track already-processed
  // note IDs so a note handled via its parent Chord is not respelled again when
  // it also shows up as its own cursor.
  const processedNoteIds = new Set<number>();

  for (const cursor of selection.cursors) {
    const nodes = findNodesById(selection.root, cursor);
    for (const csNode of nodes) {
      if (csNode.tag === TAGS.Note) {
        if (processedNoteIds.has(csNode.id)) continue;
        enharmonizePitchChild(csNode, ctx);
        processedNoteIds.add(csNode.id);
      } else if (csNode.tag === TAGS.Chord) {
        let current = csNode.firstChild;
        while (current !== null) {
          if (current.tag === TAGS.Note && !processedNoteIds.has(current.id)) {
            enharmonizePitchChild(current, ctx);
            processedNoteIds.add(current.id);
          }
          current = current.nextSibling;
        }
      }
    }
  }
  return selection;
}

function enharmonizePitchChild(noteNode: CSNode, ctx: ABCContext): void {
  const pitchCSNode = findChildByTag(noteNode, TAGS.Pitch);
  if (pitchCSNode === null) return;

  // Walk the Pitch's children to find the Alteration token (TT.ACCIDENTAL)
  let alterationToken: CSNode | null = null;
  let current = pitchCSNode.firstChild;
  while (current !== null) {
    if (isTokenNode(current) && getTokenData(current).tokenType === TT.ACCIDENTAL) {
      alterationToken = current;
      break;
    }
    current = current.nextSibling;
  }

  if (alterationToken === null) return;

  const lexeme = getTokenData(alterationToken).lexeme;
  if (lexeme === "=") return;

  const pitchExpr = toAst(pitchCSNode) as Pitch;
  const midiPitch = toMidiPitch(pitchExpr);

  // Guard: skip if MIDI pitch is out of valid range
  if (midiPitch < 0 || midiPitch > 127) return;

  let newPitchExpr: Pitch | null = null;
  if (lexeme.startsWith("^")) {
    newPitchExpr = fromMidiPitchFlat(midiPitch, ctx);
  } else if (lexeme.startsWith("_")) {
    newPitchExpr = fromMidiPitch(midiPitch, ctx);
  }

  if (newPitchExpr === null) return;

  const newPitchCSNode = fromAst(newPitchExpr, ctx);
  replace(pitchCSNode, newPitchCSNode);
}

/**
 * Re-spells notes according to the current key signature and measure accidentals.
 *
 * This transform:
 * - Corrects misspelled notes (e.g., _G -> F in G major)
 * - Removes redundant accidentals (e.g., ^F -> F in G major)
 * - Chooses optimal spellings for chromatic notes based on key direction
 *
 * The MIDI pitch is always preserved - only the spelling changes.
 *
 * @param selection The selection containing Note node IDs
 * @param snapshots DocumentSnapshots from ContextInterpreter (with snapshotAccidentals: true)
 * @param ctx ABCContext for generating node IDs
 * @returns The modified selection
 */
export function enharmonizeToKey(selection: Selection, snapshots: DocumentSnapshots, ctx: ABCContext): Selection {
  const notesOrChords = selectNotesOrChords(selection);

  // Phase 1: Pre-compute MIDI pitches using the original (unmodified) snapshots.
  // Because phase 2 mutates the snapshots as it respells notes, we must capture each
  // note's sounding pitch before any changes are made. Without this, a respelling that
  // removes a measure accidental (e.g., ^e -> f) would cause subsequent notes that relied
  // on the carry-over accidental to resolve to a different MIDI pitch.
  const midiMap = new Map<number, number>();
  const allNotes = selectNotes(notesOrChords);
  for (const cursor of allNotes.cursors) {
    const notes = findNodesById(allNotes.root, cursor);
    for (const note of notes) {
      const midinote = computeMidi(note, snapshots);
      if (midinote !== null) midiMap.set(note.id, midinote);
    }
  }

  // Phase 2: Respell each note using the pre-computed MIDI pitch and mutable snapshots.
  for (const cursor of notesOrChords.cursors) {
    const nodes = findNodesById(notesOrChords.root, cursor);

    for (const node of nodes) {
      if (node.tag === TAGS.Note) {
        enharmonizeNoteToKey(node, null, snapshots, midiMap, null, ctx);
      } else if (node.tag === TAGS.Chord) {
        const { line, char } = getNodeLineAndChar(node);
        const chordPos = encode(line, char);

        // Track accidentals set by earlier notes within this chord so that
        // later notes in the chord can detect carry-over conflicts. Without
        // this, a natural sign like =A in [^A=A] would be incorrectly removed
        // as "redundant" because the pre-chord snapshot doesn't include the ^A.
        const priorChordAccidentals = new Map<NoteLetter, number>();

        let current = node.firstChild;
        while (current !== null) {
          if (current.tag === TAGS.Note) {
            enharmonizeNoteToKey(current, chordPos, snapshots, midiMap, priorChordAccidentals, ctx);

            // After processing, record this note's accidental for subsequent chord notes
            const postComponents = toPitchComponents(current);
            if (postComponents !== null) {
              if (postComponents.explicitAccidental !== null) {
                priorChordAccidentals.set(postComponents.letter, accidentalToSemitones(postComponents.explicitAccidental));
              }
            }
          }
          current = current.nextSibling;
        }
      }
    }
  }

  return selection;
}

/**
 * Pre-computes a note's sounding MIDI pitch from the original snapshots and stores
 * it in the midiMap, keyed by the note node's ID. This must be called before any
 * respelling mutations so that the pitch resolution uses the original accidental context.
 *
 * Unlike enharmonizeNoteToKey (which uses the chord's position for notes inside chords
 * to avoid self-referencing during spelling determination), this function always uses
 * the note's actual position. Using pos-1 naturally avoids the note's own accidental
 * snapshot (which is recorded at the note's exact position) while still capturing
 * carry-over accidentals from earlier notes in the same chord.
 */
function computeMidi(noteNode: CSNode, snapshots: DocumentSnapshots): number | null {
  const pitchComponents = toPitchComponents(noteNode);
  if (pitchComponents === null) return null;

  const { letter, octave, explicitAccidental } = pitchComponents;

  const { line, char } = getNodeLineAndChar(noteNode);
  const lookupPos = encode(line, char);
  const snapshot = getSnapshotAtPosition(snapshots, lookupPos - 1);

  const pitchContext: PitchContext = {
    key: snapshot.key,
    measureAccidentals: snapshot.measureAccidentals,
    transpose: snapshot.transpose ?? 0,
  };

  return resolveMelodyPitch(letter, octave, explicitAccidental, pitchContext);
}

function enharmonizeNoteToKey(
  noteNode: CSNode,
  chordPos: number | null,
  snapshots: DocumentSnapshots,
  midiMap: Map<number, number>,
  priorChordAccidentals: Map<NoteLetter, number> | null,
  ctx: ABCContext
): void {
  // Extract pitch components (letter, octave, accidental)
  const pitchComponents = toPitchComponents(noteNode);
  if (pitchComponents === null) return;

  const { letter, octave, explicitAccidental } = pitchComponents;

  // Find the Pitch child for replacement operations
  const pitchCSNode = findChildByTag(noteNode, TAGS.Pitch);
  if (pitchCSNode === null) return;

  // Use pre-computed MIDI pitch to avoid stale snapshot resolution
  const midi = midiMap.get(noteNode.id);
  if (midi === undefined) return;

  // Get context snapshot BEFORE this position. The snapshot may have been updated
  // by previous iterations (when earlier notes were respelled and their measure
  // accidentals were invalidated).
  let lookupPos: number;
  if (chordPos !== null) {
    lookupPos = chordPos;
  } else {
    const { line, char } = getNodeLineAndChar(noteNode);
    lookupPos = encode(line, char);
  }
  const snapshot = getSnapshotAtPosition(snapshots, lookupPos - 1);

  // Derive the effective alteration from the pre-computed MIDI pitch
  const baseMidi = noteLetterToMidi(letter, octave);
  const alteration = midi - (snapshot.transpose ?? 0) - baseMidi;

  // Build merged accidentals (key + measure) from the current snapshot state.
  // For notes inside a chord, we also overlay accidentals set by earlier notes
  // in the same chord. The pre-chord snapshot does not include within-chord
  // accidentals, so without this overlay, accidentals like =A in [^A=A] would
  // be incorrectly deemed redundant.
  const measureAccidentalsSemitones = convertMeasureAccidentalsToSemitones(snapshot.measureAccidentals);
  const merged = mergeAccidentals(snapshot.key, measureAccidentalsSemitones);

  if (priorChordAccidentals !== null) {
    for (const [chordLetter, semitones] of priorChordAccidentals) {
      merged[chordLetter] = semitones;
    }
  }

  const targetPitchClass = ((midi % 12) + 12) % 12;
  const referenceSpelling = findDiatonicSpelling(merged, targetPitchClass);

  const voicedNote = { letter, midi, alteration };

  // Determine the note's own position for snapshot updates
  const { line: noteLine, char: noteChar } = getNodeLineAndChar(noteNode);
  const notePos = encode(noteLine, noteChar);

  if (referenceSpelling !== null) {
    // Diatonic case
    respellDiatonic(pitchCSNode, voicedNote, referenceSpelling, ctx);
  } else {
    // Chromatic case
    respellChromatic(noteNode, pitchCSNode, voicedNote, snapshot, snapshots, merged, ctx);
  }

  // When the old note had an explicit accidental, it was setting a measure accidental
  // for its letter (e.g., ^e sets E->sharp for the rest of the measure). If the
  // respelling changed the letter or removed the accidental, subsequent notes that
  // relied on the carry-over would resolve to a different pitch in the output text.
  // We update the snapshots to remove the stale measure accidental so that subsequent
  // iterations see the correct accidental context.
  if (explicitAccidental !== null) {
    const newComponents = toPitchComponents(noteNode);
    const newLetter = newComponents?.letter ?? null;
    const newAccidental = newComponents?.explicitAccidental ?? null;

    const letterChanged = newLetter !== letter;
    const accidentalRemoved = newAccidental === null;

    if (letterChanged || accidentalRemoved) {
      removeMeasureAccidentalFromSubsequentSnapshots(snapshots, notePos, letter);
    }
  }
}

function respellDiatonic(
  pitchCSNode: CSNode,
  voicedNote: { letter: "C" | "D" | "E" | "F" | "G" | "A" | "B"; midi: number; alteration: number },
  referenceSpelling: { letter: "C" | "D" | "E" | "F" | "G" | "A" | "B"; alteration: number },
  ctx: ABCContext
): void {
  const needsRespell = voicedNote.letter !== referenceSpelling.letter || voicedNote.alteration !== referenceSpelling.alteration;

  const hasRedundantAccidental = !needsRespell && hasAccidentalNode(pitchCSNode);

  if (needsRespell || hasRedundantAccidental) {
    // Re-spell to reference spelling without explicit accidental
    const newPitch = spellingToPitch(referenceSpelling, voicedNote.midi, false, ctx);
    const newPitchCS = fromAst(newPitch, ctx);
    replace(pitchCSNode, newPitchCS);
  }
}

/**
 * Re-spells a chromatic note according to the key's direction preference.
 *
 * NOTE: This function intentionally mutates the snapshots parameter when it writes
 * an explicit accidental. This is necessary so that subsequent notes in the same
 * measure see the updated accidental context and are re-spelled correctly.
 */
function respellChromatic(
  noteNode: CSNode,
  pitchCSNode: CSNode,
  voicedNote: { letter: string; midi: number; alteration: number },
  snapshot: ContextSnapshot,
  snapshots: DocumentSnapshots,
  merged: Record<"C" | "D" | "E" | "F" | "G" | "A" | "B", number>,
  ctx: ABCContext
): void {
  const targetPitchClass = ((voicedNote.midi % 12) + 12) % 12;
  const options = getEnharmonicSpellings(targetPitchClass);
  const best = chooseBestChromatic(options, snapshot.key, merged);

  const needsRespell = voicedNote.letter !== best.letter || voicedNote.alteration !== best.alteration;

  if (!needsRespell) return;

  const needsExplicit = (merged[best.letter] ?? 0) !== best.alteration;
  const newPitch = spellingToPitch(best, voicedNote.midi, needsExplicit, ctx);
  const newPitchCS = fromAst(newPitch, ctx);
  replace(pitchCSNode, newPitchCS);

  // Update snapshots so subsequent notes see this accidental
  if (needsExplicit) {
    const { line, char } = getNodeLineAndChar(noteNode);
    const pos = encode(line, char);
    const newMeasureAccidentals = new Map(snapshot.measureAccidentals ?? []);
    newMeasureAccidentals.set(best.letter, semitonesToAccidentalType(best.alteration));
    insertSnapshotSorted(snapshots, pos, {
      ...snapshot,
      measureAccidentals: newMeasureAccidentals,
    });
  }
}

/**
 * Removes a letter's measure accidental from all snapshot entries at positions >= startPos
 * until the end of the measure. Because the interpreter inserts a snapshot at every note
 * that sets a measure accidental, these entries accumulate through the measure. When we
 * respell a note such that it no longer emits the old accidental (e.g., ^e -> f), we must
 * remove the old letter from all subsequent snapshot entries so that later notes see the
 * correct accidental context.
 *
 * We stop modifying snapshots when we encounter one whose measureAccidentals map does not
 * contain the letter, which indicates either a barline reset or a position beyond the
 * original accidental's reach.
 */
function removeMeasureAccidentalFromSubsequentSnapshots(snapshots: DocumentSnapshots, startPos: number, letter: "C" | "D" | "E" | "F" | "G" | "A" | "B"): void {
  const startIndex = binarySearchFloor(snapshots, startPos);
  if (startIndex < 0) return;

  for (let i = startIndex; i < snapshots.length; i++) {
    const entry = snapshots[i];
    if (entry.pos < startPos) continue;
    if (!entry.snapshot.measureAccidentals?.has(letter)) break;
    const updated = new Map(entry.snapshot.measureAccidentals);
    updated.delete(letter);
    entry.snapshot = { ...entry.snapshot, measureAccidentals: updated };
  }
}

/**
 * Checks if a Pitch CSNode has an ACCIDENTAL token child.
 */
function hasAccidentalNode(pitchNode: CSNode): boolean {
  let current = pitchNode.firstChild;
  while (current !== null) {
    if (isTokenNode(current) && getTokenData(current).tokenType === TT.ACCIDENTAL) {
      return true;
    }
    current = current.nextSibling;
  }
  return false;
}
