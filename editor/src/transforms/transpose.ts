import { replace } from "abcls-cstree";
import {
  ABCContext,
  Pitch,
  Token,
  TT,
  resolveMelodyPitch,
  semitonesToAccidentalType,
  spellPitch,
  mergeAccidentals,
  computeOctaveFromPitch,
} from "abcls-parser";
import { DocumentSnapshots, ContextSnapshot, getSnapshotAtPosition, encode } from "abcls-parser/interpreter/ContextInterpreter";
import { fromAst } from "../csTree/fromAst";
import { toAst } from "../csTree/toAst";
import { CSNode, TAGS, isTokenNode, getTokenData } from "../csTree/types";
import { Selection } from "../selection";
import { insertSnapshotSorted, insertBarResetSnapshot } from "./parallel";
import { spellingToPitch, convertMeasureAccidentalsToSemitones } from "./pitchHelpers";
import { findChildByTag, getNodeLineAndChar, findNextBarResetPos } from "./treeUtils";
import { findNodesById } from "./types";
import { computeMidi, removeMeasureAccidentalFromSubsequentSnapshots } from "./enharmonize";
import { toPitchComponents, noteSpellingsForMidi, spellingOctave, NoteLetter } from "./pitchHelpers";
import { transposeKeySignature, keyTonicName, diatonicSteps } from "./transposeKey";
import { transposeChordText } from "./transposeChord";
import { NATURAL_SEMITONES, Spelling } from "abcls-parser/music-theory/constants";
import { KeySignature } from "abcls-parser/types/abcjs-ast";
import { measureAccidentalKey } from "abcls-parser/music-theory/pitchUtils";

/**
 * Transposes selected notes by the specified number of semitones.
 *
 * This transform uses context-aware note spelling, taking into account:
 * - The key signature at each note's position
 * - Measure accidentals that have been established
 * - The direction of transposition for chromatic notes
 *
 * For octave transpositions (multiples of 12 semitones), the original
 * spelling is preserved exactly, only adjusting the octave markers.
 *
 * @param selection The selection containing Note or Chord node IDs
 * @param semitones The number of semitones to transpose (positive = up, negative = down)
 * @param ctx ABCContext for generating node IDs
 * @param snapshots DocumentSnapshots for context-aware spelling
 * @returns The modified selection
 */
export function transpose(
  selection: Selection,
  semitones: number,
  ctx: ABCContext,
  snapshots: DocumentSnapshots,
  changeKey = false,
  changeChords = false
): Selection {
  if (semitones === 0) return selection;

  // Because a transposition by whole octaves keeps the key, there is no key to change in that case.
  // Because the chord symbols are also spelled by interval, the plan exists when either the keys or the chords follow.
  const keyPlan = (changeKey || changeChords) && semitones % 12 !== 0 ? createKeyPlan(semitones) : null;
  const spellKeyFor = (key: KeySignature): KeySignature => (!changeKey || keyPlan === null ? key : keyPlan.targetKey(key) ?? key);
  // Because a changed key lets us transpose by interval, each note moves by the letter steps between the old and new tonic.
  const stepsFor = (key: KeySignature): number | null => {
    const target = !changeKey || keyPlan === null ? null : keyPlan.targetKey(key);
    return target === null ? null : diatonicSteps(key, target, semitones);
  };
  const selectedPositions: number[] = [];

  // A range-based selection can independently match both a Chord and its child
  // Notes (e.g. the LSP's default tag set is [Note, Chord]), producing separate
  // cursors for the same notes. Without deduplication, a note handled via its
  // parent Chord would be transposed a second time when it also shows up as
  // its own cursor. Track already-processed note IDs to guard against this.
  const processedNoteIds = new Set<number>();

  // Because the spelling of each transposed note is written against the measure accidentals of the
  // output, and because the snapshots are edited while we write that output, we cannot read the
  // original pitch of a later note from the snapshots once an earlier note has been rewritten.
  // Therefore, before any note changes, we capture the sounding pitch of every note in the selection.
  const midiMap = new Map<number, number>();
  for (const cursor of selection.cursors) {
    for (const csNode of findNodesById(selection.root, cursor)) {
      const notes: CSNode[] = [];
      // Because the replacement tokens carry no position, we record where each selected node was before any edit.
      const { line: nodeLine, char: nodeChar } = getNodeLineAndChar(csNode);
      selectedPositions.push(encode(nodeLine, nodeChar));
      if (csNode.tag === TAGS.Note) notes.push(csNode);
      else if (csNode.tag === TAGS.Chord) {
        for (let child = csNode.firstChild; child !== null; child = child.nextSibling) {
          if (child.tag === TAGS.Note) notes.push(child);
        }
      }
      for (const note of notes) {
        if (midiMap.has(note.id)) continue;
        const midi = computeMidi(note, snapshots);
        if (midi !== null) midiMap.set(note.id, midi);
      }
    }
  }

  for (const cursor of selection.cursors) {
    const nodes = findNodesById(selection.root, cursor);
    for (const csNode of nodes) {
      if (csNode.tag === TAGS.Note) {
        if (processedNoteIds.has(csNode.id)) continue;
        transposePitchChild(csNode, semitones, ctx, snapshots, midiMap, spellKeyFor, stepsFor);
        processedNoteIds.add(csNode.id);
      } else if (csNode.tag === TAGS.Chord) {
        let current = csNode.firstChild;
        while (current !== null) {
          if (current.tag === TAGS.Note && !processedNoteIds.has(current.id)) {
            transposePitchChild(current, semitones, ctx, snapshots, midiMap, spellKeyFor, stepsFor);
            processedNoteIds.add(current.id);
          }
          current = current.nextSibling;
        }
      }
    }
  }
  if (keyPlan !== null && changeKey) {
    rewriteKeyFields(selection.root, selectedPositions, snapshots, keyPlan);
  }
  if (keyPlan !== null && changeChords) {
    transposeChordSymbols(selection.root, selectedPositions, semitones, snapshots, keyPlan);
  }
  return selection;
}

/**
 * Transposes a pitch child node within a note using context-aware spelling.
 */
function transposePitchChild(
  noteNode: CSNode,
  semitones: number,
  ctx: ABCContext,
  snapshots: DocumentSnapshots,
  midiMap: Map<number, number>,
  spellKeyFor: (key: KeySignature) => KeySignature,
  stepsFor: (key: KeySignature) => number | null
): void {
  const pitchCSNode = findChildByTag(noteNode, TAGS.Pitch);
  if (pitchCSNode === null) return;

  const pitchExpr = toAst(pitchCSNode) as Pitch;

  // Extract pitch components
  const letter = pitchExpr.noteLetter.lexeme.toUpperCase();
  const octave = computeOctaveFromPitch(pitchExpr);
  const explicitAcc = pitchExpr.alteration ? pitchExpr.alteration.lexeme : null;

  const { line, char } = getNodeLineAndChar(noteNode);
  const pos = encode(line, char);
  const snapshot = getSnapshotAtPosition(snapshots, pos - 1);

  transposePitchWithContext(noteNode, pitchCSNode, pitchExpr, letter, octave, explicitAcc, semitones, snapshot, snapshots, midiMap, spellKeyFor, stepsFor, ctx);
}

/**
 * Transposes a pitch using context-aware spelling.
 */
function transposePitchWithContext(
  noteNode: CSNode,
  pitchCSNode: CSNode,
  pitchExpr: Pitch,
  letter: string,
  octave: number,
  explicitAcc: string | null,
  semitones: number,
  snapshot: ContextSnapshot,
  snapshots: DocumentSnapshots,
  midiMap: Map<number, number>,
  spellKeyFor: (key: KeySignature) => KeySignature,
  stepsFor: (key: KeySignature) => number | null,
  ctx: ABCContext
): void {
  // Because the snapshots now describe the output being written, the original pitch comes from the
  // values captured before any edit, and only falls back to the snapshot if the note was not captured.
  const pitchContext = { key: snapshot.key, measureAccidentals: snapshot.measureAccidentals, transpose: 0 };
  const originalMidi = midiMap.get(noteNode.id) ?? resolveMelodyPitch(letter, octave, explicitAcc, pitchContext);
  const targetMidi = originalMidi + semitones;

  // Validate MIDI range
  if (targetMidi < 0 || targetMidi > 127) return;

  // Special case: octave transposition preserves spelling exactly
  if (semitones % 12 === 0) {
    const octaveChange = semitones / 12;
    const newOctave = octave + octaveChange;
    const newPitchExpr = octaviate(pitchExpr, newOctave, ctx);
    const newPitchCSNode = fromAst(newPitchExpr, ctx);
    replace(pitchCSNode, newPitchCSNode);
    return;
  }

  // Convert measure accidentals and merge with key signature
  const measureAccidentalsSemitones = convertMeasureAccidentalsToSemitones(snapshot.measureAccidentals);
  const noteSpellings = noteSpellingsForMidi(spellKeyFor(snapshot.key), measureAccidentalsSemitones, targetMidi);

  // Get the correct spelling for the target pitch
  const spelling = spellByInterval(letter, targetMidi, stepsFor(snapshot.key)) ?? spellPitch(targetMidi, noteSpellings, semitones);

  // Check if we need to write an explicit accidental
  const contextAlteration = noteSpellings[spelling.letter];
  const needsExplicitAccidental = spelling.alteration !== contextAlteration;

  // Because the replacement tokens carry no source position, we read the note position before replacing.
  const { line: noteLine, char: noteChar } = getNodeLineAndChar(noteNode);
  const originalPos = encode(noteLine, noteChar);
  const resetPos = findNextBarResetPos(noteNode);

  // Build new Pitch AST and replace in tree
  const newPitchExpr = spellingToPitch(spelling, targetMidi, needsExplicitAccidental, ctx);
  const newPitchCSNode = fromAst(newPitchExpr, ctx);
  replace(pitchCSNode, newPitchCSNode);

  // Because the original note carried an explicit accidental, it had set a measure accidental on its
  // letter for the rest of the bar. If the transposed note no longer writes that accidental on that
  // letter, the later notes must not inherit it when we choose their spelling, so we remove it.
  let staleLetterRemoved = false;
  if (explicitAcc !== null) {
    const written = toPitchComponents(noteNode);
    if (written === null || written.letter !== letter || written.octave !== octave || written.explicitAccidental === null) {
      removeMeasureAccidentalFromSubsequentSnapshots(snapshots, originalPos, measureAccidentalKey(letter, octave));
      staleLetterRemoved = true;
    }
  }

  // If we wrote an explicit accidental, insert a snapshot at the correct sorted position
  // so subsequent notes see the updated measure accidentals
  if (needsExplicitAccidental) {
    const newMeasureAccidentals = new Map(snapshot.measureAccidentals ?? []);
    if (staleLetterRemoved) newMeasureAccidentals.delete(measureAccidentalKey(letter, octave));
    newMeasureAccidentals.set(measureAccidentalKey(spelling.letter, spellingOctave(spelling.letter, targetMidi)), semitonesToAccidentalType(spelling.alteration));
    insertSnapshotSorted(snapshots, originalPos, {
      ...snapshot,
      measureAccidentals: newMeasureAccidentals,
    });
    insertBarResetSnapshot(snapshots, resetPos, snapshot);
  }
}

/**
 * Creates a new Pitch AST node preserving the original letter and accidental,
 * only adjusting the octave. Used for octave transpositions.
 *
 * @param pitchExpr The original Pitch AST node
 * @param newOctave The target octave number
 * @param ctx ABCContext for generating node IDs
 * @returns A new Pitch AST node with the adjusted octave
 */
function octaviate(pitchExpr: Pitch, newOctave: number, ctx: ABCContext): Pitch {
  const originalLetter = pitchExpr.noteLetter.lexeme;

  // Determine new letter case and octave markers based on newOctave
  let letterStr: string;
  let octaveStr: string;

  if (newOctave <= 4) {
    letterStr = originalLetter.toUpperCase();
    octaveStr = ",".repeat(4 - newOctave);
  } else {
    letterStr = originalLetter.toLowerCase();
    octaveStr = "'".repeat(newOctave - 5);
  }

  const letterToken = new Token(TT.NOTE_LETTER, letterStr, ctx.generateId());
  const octaveToken = octaveStr !== "" ? new Token(TT.OCTAVE, octaveStr, ctx.generateId()) : undefined;

  // Copy accidental token if present (preserve the original accidental exactly)
  let accidentalToken: Token | undefined;
  if (pitchExpr.alteration) {
    accidentalToken = new Token(TT.ACCIDENTAL, pitchExpr.alteration.lexeme, ctx.generateId());
  }

  return new Pitch(ctx.generateId(), {
    alteration: accidentalToken,
    noteLetter: letterToken,
    octave: octaveToken,
  });
}

/**
 * The state we need to change the key signatures while transposing.
 */
interface KeyPlan {
  semitones: number;
  /** Returns the transposed key, or null when the key cannot be transposed. */
  targetKey: (key: KeySignature) => KeySignature | null;
}

function createKeyPlan(semitones: number): KeyPlan {
  // Because the snapshots share one key object across many notes, we cache the result by identity.
  const cache = new Map<KeySignature, KeySignature | null>();
  return {
    semitones,
    targetKey: (key) => {
      if (!cache.has(key)) cache.set(key, transposeKeySignature(key, semitones));
      return cache.get(key) ?? null;
    },
  };
}

/**
 * Rewrites the tonic of each K: field that governs at least one selected note.
 *
 * Because the notes were spelled for the transposed key, we change the field so that the text and the notes agree.
 * A field governs the selected notes that sit between it and the next K: field, and we read the key it sets
 * from the snapshot of the first of those notes.
 */
function rewriteKeyFields(root: CSNode, selectedPositions: number[], snapshots: DocumentSnapshots, keyPlan: KeyPlan): void {
  const fields: Array<{ pos: number; keyToken: CSNode }> = [];
  collectKeyFields(root, fields);
  fields.sort((a, b) => a.pos - b.pos);
  const sortedNotes = [...selectedPositions].sort((a, b) => a - b);

  for (let i = 0; i < fields.length; i++) {
    const nextFieldPos = i + 1 < fields.length ? fields[i + 1].pos : Infinity;
    if (!sortedNotes.some((pos) => pos > fields[i].pos && pos < nextFieldPos)) continue;

    // Because a K: field after a voice line sets the key of that voice only, we read the key from the snapshot the
    // field itself recorded, and not from the first note after it, which may belong to another voice.
    const keyData = getTokenData(fields[i].keyToken);
    const sourceKey = getSnapshotAtPosition(snapshots, encode(keyData.line, keyData.position)).key;
    const target = keyPlan.targetKey(sourceKey);
    if (target === null) continue;

    const data = getTokenData(fields[i].keyToken);
    const tonic = /^[A-Ga-g][#b]?/.exec(data.lexeme);
    if (tonic === null) continue;
    data.lexeme = keyTonicName(target) + data.lexeme.slice(tonic[0].length);
  }
}

/**
 * Collects the key token of every K: field, in the header, in the body and inline.
 */
function collectKeyFields(node: CSNode, fields: Array<{ pos: number; keyToken: CSNode }>): void {
  if (node.tag === TAGS.Info_line || node.tag === TAGS.Inline_field) {
    const label = node.firstChild;
    let keyToken: CSNode | null = null;
    for (let child = node.firstChild; child !== null; child = child.nextSibling) {
      if (isTokenNode(child) && getTokenData(child).tokenType === TT.KEY_SIGNATURE) keyToken = child;
    }
    if (label !== null && keyToken !== null) {
      const { line, char } = getNodeLineAndChar(node);
      fields.push({ pos: encode(line, char), keyToken });
    }
    return;
  }
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    collectKeyFields(child, fields);
  }
}

const LETTERS_IN_ORDER = ["C", "D", "E", "F", "G", "A", "B"] as const;

/**
 * Spells the target pitch by moving the letter of the original note by a number of steps.
 *
 * @returns The spelling, or null when no steps are given or the pitch would need more than a double accidental
 */
function spellByInterval(letter: string, targetMidi: number, steps: number | null): Spelling | null {
  if (steps === null) return null;
  const newLetter = LETTERS_IN_ORDER[(((LETTERS_IN_ORDER.indexOf(letter as NoteLetter) + steps) % 7) + 7) % 7];
  const natural = NATURAL_SEMITONES[newLetter] + 12 * (spellingOctave(newLetter, targetMidi) - 4) + 60;
  const alteration = targetMidi - natural;
  return Math.abs(alteration) <= 2 ? { letter: newLetter, alteration } : null;
}

/**
 * Transposes the chord symbols of the tunes that hold selected notes.
 *
 * Because a chord symbol sits in the voice that carries the chords, which is often not the voice we select,
 * we transpose every chord of the tune, and read each chord's key from the snapshot at its position.
 */
function transposeChordSymbols(root: CSNode, selectedPositions: number[], semitones: number, snapshots: DocumentSnapshots, keyPlan: KeyPlan): void {
  if (selectedPositions.length === 0) return;
  const tunes: CSNode[] = [];
  collectTunes(root, tunes);

  for (const tune of tunes) {
    const first = firstPosition(tune);
    const last = lastPosition(tune);
    if (first === null || last === null) continue;
    if (!selectedPositions.some((pos) => pos >= first && pos <= last)) continue;
    transposeChordsOfTune(tune, semitones, snapshots, keyPlan);
  }
}

function collectTunes(node: CSNode, tunes: CSNode[]): void {
  if (node.tag === TAGS.Tune) {
    tunes.push(node);
    return;
  }
  for (let child = node.firstChild; child !== null; child = child.nextSibling) collectTunes(child, tunes);
}

/** The encoded position of the first token under a node, or null when there is none. */
function firstPosition(node: CSNode): number | null {
  for (let current: CSNode | null = node; current !== null; current = current.firstChild) {
    if (isTokenNode(current)) return encode(getTokenData(current).line, getTokenData(current).position);
  }
  return null;
}

/** The greatest encoded position of a token under a node, or null when there is none. */
function lastPosition(node: CSNode): number | null {
  let result: number | null = null;
  const visit = (current: CSNode): void => {
    if (isTokenNode(current)) {
      const data = getTokenData(current);
      const pos = encode(data.line, data.position);
      if (result === null || pos > result) result = pos;
    }
    for (let child = current.firstChild; child !== null; child = child.nextSibling) visit(child);
  };
  visit(node);
  return result;
}

function transposeChordsOfTune(node: CSNode, semitones: number, snapshots: DocumentSnapshots, keyPlan: KeyPlan): void {
  if (node.tag === TAGS.Annotation || node.tag === TAGS.ChordSymbol) {
    for (let child = node.firstChild; child !== null; child = child.nextSibling) {
      if (!isTokenNode(child)) continue;
      const data = getTokenData(child);
      const quoted = /^"(.*)"$/.exec(data.lexeme);
      const text = quoted !== null ? quoted[1] : data.lexeme;
      const key = getSnapshotAtPosition(snapshots, encode(data.line, data.position)).key;
      const target = keyPlan.targetKey(key);
      const steps = target === null ? null : diatonicSteps(key, target, semitones);
      const transposed = transposeChordText(text, semitones, steps);
      if (transposed !== null) data.lexeme = quoted !== null ? `"${transposed}"` : transposed;
    }
    return;
  }
  for (let child = node.firstChild; child !== null; child = child.nextSibling) transposeChordsOfTune(child, semitones, snapshots, keyPlan);
}
