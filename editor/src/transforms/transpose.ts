import { replace } from "abcls-cstree";
import {
  ABCContext,
  Pitch,
  Token,
  TT,
  resolveMelodyPitch,
  semitonesToAccidentalType,
  spellPitch,
  computeOctaveFromPitch,
} from "abcls-parser";
import { DocumentSnapshots, ContextSnapshot, getSnapshotAtPosition, encode } from "abcls-parser/interpreter/ContextInterpreter";
import { LETTERS, NATURAL_SEMITONES, Spelling } from "abcls-parser/music-theory/constants";
import { getKeyAccidentalFor } from "abcls-parser/music-theory/harmonization";
import { measureAccidentalKey } from "abcls-parser/music-theory/pitchUtils";
import { KeySignature } from "abcls-parser/types/abcjs-ast";
import { fromAst } from "../csTree/fromAst";
import { toAst } from "../csTree/toAst";
import { CSNode, TAGS, isTokenNode, getTokenData } from "../csTree/types";
import { Selection } from "../selection";
import { computeMidi, removeMeasureAccidentalFromSubsequentSnapshots } from "./enharmonize";
import { insertSnapshotSorted, insertBarResetSnapshot } from "./parallel";
import { spellingToPitch, convertMeasureAccidentalsToSemitones } from "./pitchHelpers";
import { toPitchComponents, noteSpellingsForMidi, spellingOctave, NoteLetter } from "./pitchHelpers";
import { transposeChordText } from "./transposeChord";
import { transposeKeySignature, keyTonicName, diatonicSteps } from "./transposeKey";
import { findChildByTag, getNodeLineAndChar, findNextBarResetPos } from "./treeUtils";
import { findNodesById } from "./types";

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
  // The K: fields are collected before any note changes, because the replacement tokens carry no source position.
  const keyPlan = (changeKey || changeChords) && semitones % 12 !== 0 ? createKeyPlan(selection.root, semitones, changeKey) : null;
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

  // Because a K: field also sets the key of the notes that are not transposed, it only follows the transposition when
  // every note it governs is selected; the selected notes under any other field keep their key.
  if (keyPlan !== null) markRewritableFields(keyPlan, new Set(midiMap.keys()));

  for (const cursor of selection.cursors) {
    const nodes = findNodesById(selection.root, cursor);
    for (const csNode of nodes) {
      if (csNode.tag === TAGS.Note) {
        if (processedNoteIds.has(csNode.id)) continue;
        transposePitchChild(csNode, semitones, ctx, snapshots, midiMap, keyPlan);
        processedNoteIds.add(csNode.id);
      } else if (csNode.tag === TAGS.Chord) {
        let current = csNode.firstChild;
        while (current !== null) {
          if (current.tag === TAGS.Note && !processedNoteIds.has(current.id)) {
            transposePitchChild(current, semitones, ctx, snapshots, midiMap, keyPlan);
            processedNoteIds.add(current.id);
          }
          current = current.nextSibling;
        }
      }
    }
  }
  if (keyPlan !== null && changeKey) {
    rewriteKeyFields(snapshots, keyPlan);
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
  keyPlan: KeyPlan | null
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

  // Because the note may sit under a K: field that keeps its key, we ask the plan whether this note's key follows.
  const target = keyPlan !== null && keyFollowsAt(keyPlan, pos) ? targetKeyOf(keyPlan, snapshot.key) : null;
  transposePitchWithContext(noteNode, pitchCSNode, pitchExpr, letter, octave, explicitAcc, semitones, snapshot, snapshots, midiMap, target, ctx);
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
  targetKey: KeySignature | null,
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
  const noteSpellings = noteSpellingsForMidi(targetKey ?? snapshot.key, measureAccidentalsSemitones, targetMidi);

  // Get the correct spelling for the target pitch
  // Because a changed key lets us transpose by interval, each note moves by the letter steps between the old and new tonic.
  const steps = targetKey === null ? null : diatonicSteps(snapshot.key, targetKey, semitones);
  const spelling = spellByInterval(letter, targetMidi, steps) ?? spellPitch(targetMidi, noteSpellings, semitones);

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
    newMeasureAccidentals.set(
      measureAccidentalKey(spelling.letter, spellingOctave(spelling.letter, targetMidi)),
      semitonesToAccidentalType(spelling.alteration)
    );
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
 * A K: field of the document, as the key plan sees it.
 */
export interface KeyField {
  /** The encoded position of the field. */
  pos: number;
  /**
   * The encoded position whose snapshot holds the key the field sets. Because the interpreter records no snapshot for
   * the fields of a tune header, a header field reads its key at the start of its tune body; any other field reads it
   * at its own position.
   */
  keyPos: number;
  keyToken: CSNode;
  /** The tokens that follow the key in the field (modifiers and explicit accidentals), without the closing bracket. */
  tailTokens: CSNode[];
  /** Whether the field says "exp", so that its explicit accidentals are the whole key signature. */
  explicit: boolean;
  /** The ids of the notes that the field governs: those between it and the next K: field. */
  governedNoteIds: number[];
  /** Whether the field follows the transposition, because every note it governs is selected. */
  rewrite: boolean;
}

/**
 * The state we need to change the key signatures while transposing.
 */
export interface KeyPlan {
  semitones: number;
  changeKey: boolean;
  /** Because the snapshots share one key object across many notes, the transposed keys are cached by identity. */
  cache: Map<KeySignature, KeySignature | null>;
  /** The K: fields, sorted by position. */
  fields: KeyField[];
}

/** The state of the walk that collects the K: fields and the notes. */
export interface KeyFieldWalk {
  fields: KeyField[];
  /** The position of every note, with its id, in document order. */
  notes: Array<{ id: number; pos: number }>;
  /** The position where the body of the current tune starts, or null outside a tune. */
  bodyPos: number | null;
  inHeader: boolean;
}

export function createKeyPlan(root: CSNode, semitones: number, changeKey: boolean): KeyPlan {
  const walk: KeyFieldWalk = { fields: [], notes: [], bodyPos: null, inHeader: false };
  collectKeyFields(root, walk);
  walk.fields.sort((a, b) => a.pos - b.pos);
  for (let i = 0; i < walk.fields.length; i++) {
    const nextFieldPos = i + 1 < walk.fields.length ? walk.fields[i + 1].pos : Infinity;
    walk.fields[i].governedNoteIds = walk.notes.filter((note) => note.pos > walk.fields[i].pos && note.pos < nextFieldPos).map((note) => note.id);
  }
  return { semitones, changeKey, cache: new Map(), fields: walk.fields };
}

/**
 * Returns the transposed key, or null when the key cannot be transposed (such as the bagpipe keys).
 */
export function targetKeyOf(plan: KeyPlan, key: KeySignature): KeySignature | null {
  if (!plan.cache.has(key)) plan.cache.set(key, transposeKeySignature(key, plan.semitones));
  return plan.cache.get(key) ?? null;
}

/**
 * Marks the fields whose governed notes are all selected, so that only those follow the transposition.
 */
export function markRewritableFields(plan: KeyPlan, selectedNoteIds: Set<number>): void {
  for (const field of plan.fields) {
    field.rewrite = field.governedNoteIds.length > 0 && field.governedNoteIds.every((id) => selectedNoteIds.has(id));
  }
}

/**
 * Returns whether the key of a note at the given position follows the transposition.
 */
export function keyFollowsAt(plan: KeyPlan, pos: number): boolean {
  if (!plan.changeKey) return false;
  let governing: KeyField | null = null;
  for (const field of plan.fields) {
    if (field.pos >= pos) break;
    governing = field;
  }
  return governing !== null && governing.rewrite;
}

/**
 * Rewrites each K: field that follows the transposition: its tonic, and its explicit accidentals.
 *
 * Because the notes were spelled for the transposed key, we change the field so that the text and the notes agree.
 */
export function rewriteKeyFields(snapshots: DocumentSnapshots, keyPlan: KeyPlan): void {
  for (const field of keyPlan.fields) {
    if (!field.rewrite) continue;
    const sourceKey = getSnapshotAtPosition(snapshots, field.keyPos).key;
    const target = targetKeyOf(keyPlan, sourceKey);
    if (target === null) continue;

    const data = getTokenData(field.keyToken);
    const tonic = /^[A-Ga-g][#b]?/.exec(data.lexeme);
    if (tonic === null) continue;
    data.lexeme = keyTonicName(target) + data.lexeme.slice(tonic[0].length);
    rewriteExplicitAccidentals(field, sourceKey, target, keyPlan.semitones);
  }
}

const EXPLICIT_ACCIDENTAL = /^(\^\^|__|\^|_|=)([A-Ga-g])$/;
const ACCIDENTAL_SEMITONES: Record<string, number> = { "^^": 2, "^": 1, "=": 0, _: -1, __: -2 };
const ACCIDENTAL_TEXT: Record<number, string> = { 2: "^^", 1: "^", 0: "=", [-1]: "_", [-2]: "__" };

/**
 * Transposes the explicit accidentals of a K: field (K:D exp ^f ^c, K:Dm ^c).
 *
 * Because each letter of the scale moves by the same number of steps as the tonic, the alteration that every letter
 * of the source scale carries is moved onto its new letter. With "exp", the field lists the whole scale, so every
 * altered letter of the new scale is written; otherwise the field only lists what differs from the new key signature.
 */
export function rewriteExplicitAccidentals(field: KeyField, sourceKey: KeySignature, targetKey: KeySignature, semitones: number): void {
  const words = field.tailTokens
    .map((token) => getTokenData(token).lexeme)
    .join("")
    .split(/(\s+)/);
  const listed = new Map<string, number>();
  for (const word of words) {
    const match = EXPLICIT_ACCIDENTAL.exec(word);
    if (match !== null) listed.set(match[2].toUpperCase(), ACCIDENTAL_SEMITONES[match[1]]);
  }
  if (listed.size === 0) return;
  const isExplicit = field.explicit;

  const steps = diatonicSteps(sourceKey, targetKey, semitones);
  const written: Array<{ letter: NoteLetter; alteration: number }> = [];
  for (let index = 0; index < LETTERS.length; index++) {
    const letter = LETTERS[index];
    const alteration = listed.get(letter) ?? (isExplicit ? 0 : getKeyAccidentalFor(letter, sourceKey));
    const newLetter = LETTERS[(((index + steps) % 7) + 7) % 7];
    let newAlteration = (((NATURAL_SEMITONES[letter] + alteration + semitones - NATURAL_SEMITONES[newLetter]) % 12) + 12) % 12;
    if (newAlteration > 6) newAlteration -= 12;
    const keyAlteration = isExplicit ? 0 : getKeyAccidentalFor(newLetter, targetKey);
    if (newAlteration !== keyAlteration && ACCIDENTAL_TEXT[newAlteration] !== undefined) {
      written.push({ letter: newLetter, alteration: newAlteration });
    }
  }
  // Because a key signature lists its sharps in the order F C G D A E B and its flats in the reverse order, we write them so.
  written.sort((a, b) => signatureRank(a) - signatureRank(b));
  const writtenText = written.map((entry) => `${ACCIDENTAL_TEXT[entry.alteration]}${entry.letter.toLowerCase()}`);

  // The accidentals are written where the first one was, and the other words of the field (exp, clef=...) are kept.
  const result: string[] = [];
  let placed = false;
  for (const word of words) {
    if (!EXPLICIT_ACCIDENTAL.test(word)) {
      result.push(word);
    } else if (!placed) {
      result.push(writtenText.join(" "));
      placed = true;
    }
  }
  let text = result
    .join("")
    .replace(/\s+$/, "")
    .replace(/\s{2,}/g, " ");
  // Because the serializer joins the tokens of an info line without spaces, accidentals that follow the key token
  // directly need their own leading space (K:E ^a, not K:E^a).
  if (text !== "" && !/^\s/.test(text) && field.keyToken.nextSibling === field.tailTokens[0]) text = " " + text;
  getTokenData(field.tailTokens[0]).lexeme = text;
  for (const token of field.tailTokens.slice(1)) getTokenData(token).lexeme = "";
}

/**
 * Ranks an explicit accidental by its place in a key signature: the sharps in the order F C G D A E B, then the flats in
 * the order B E A D G C F, then the naturals.
 */
export function signatureRank(entry: { letter: NoteLetter; alteration: number }): number {
  if (entry.alteration > 0) return "FCGDAEB".indexOf(entry.letter);
  if (entry.alteration < 0) return 7 + "BEADGCF".indexOf(entry.letter);
  return 14 + LETTERS.indexOf(entry.letter);
}

/**
 * Collects the K: fields (in the header, in the body and inline) and the positions of the notes.
 */
export function collectKeyFields(node: CSNode, walk: KeyFieldWalk): void {
  if (node.tag === TAGS.Tune) {
    const body = findChildByTag(node, TAGS.Tune_Body);
    walk.bodyPos = body === null ? null : firstPosition(body);
  }
  if (node.tag === TAGS.Info_line || node.tag === TAGS.Inline_field) {
    collectKeyField(node, walk);
    return;
  }
  if (node.tag === TAGS.Note) {
    const { line, char } = getNodeLineAndChar(node);
    walk.notes.push({ id: node.id, pos: encode(line, char) });
    return;
  }
  const wasInHeader = walk.inHeader;
  if (node.tag === TAGS.Tune_header) walk.inHeader = true;
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    collectKeyFields(child, walk);
  }
  walk.inHeader = wasInHeader;
}

/**
 * Records one K: field, with the tokens that follow its key.
 */
export function collectKeyField(node: CSNode, walk: KeyFieldWalk): void {
  let keyToken: CSNode | null = null;
  const tailTokens: CSNode[] = [];
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    if (!isTokenNode(child)) continue;
    const type = getTokenData(child).tokenType;
    if (type === TT.KEY_SIGNATURE) keyToken = child;
    else if (keyToken !== null && type !== TT.INLN_FLD_RGT_BRKT && type !== TT.EOL) tailTokens.push(child);
  }
  if (keyToken === null) return;
  const { line, char } = getNodeLineAndChar(node);
  const pos = encode(line, char);
  // Because the interpreter records the snapshot of a body field at its key token, the key is read there.
  const keyData = getTokenData(keyToken);
  const keyPos = walk.inHeader ? walk.bodyPos : encode(keyData.line, keyData.position);
  if (keyPos === null) return;
  walk.fields.push({ pos, keyPos, keyToken, tailTokens, explicit: hasTokenLexeme(node, "exp"), governedNoteIds: [], rewrite: false });
}

/**
 * Returns whether a token with the given text sits anywhere under a node. Because the parser groups some modifiers of a
 * K: field (such as "exp") into nodes of their own, the search goes through every descendant.
 */
export function hasTokenLexeme(node: CSNode, lexeme: string): boolean {
  if (isTokenNode(node) && getTokenData(node).lexeme === lexeme) return true;
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    if (hasTokenLexeme(child, lexeme)) return true;
  }
  return false;
}

/**
 * Spells the target pitch by moving the letter of the original note by a number of steps.
 *
 * @returns The spelling, or null when no steps are given or the pitch would need more than a double accidental
 */
function spellByInterval(letter: string, targetMidi: number, steps: number | null): Spelling | null {
  if (steps === null) return null;
  const newLetter = LETTERS[(((LETTERS.indexOf(letter as NoteLetter) + steps) % 7) + 7) % 7];
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
  if (isTokenNode(node)) {
    const data = getTokenData(node);
    result = encode(data.line, data.position);
  }
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    const last = lastPosition(child);
    if (last !== null && (result === null || last > result)) result = last;
  }
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
      const target = targetKeyOf(keyPlan, key);
      const steps = target === null ? null : diatonicSteps(key, target, semitones);
      const transposed = transposeChordText(text, semitones, steps);
      if (transposed !== null) data.lexeme = quoted !== null ? `"${transposed}"` : transposed;
    }
    return;
  }
  for (let child = node.firstChild; child !== null; child = child.nextSibling) transposeChordsOfTune(child, semitones, snapshots, keyPlan);
}
