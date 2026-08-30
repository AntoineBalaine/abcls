import { ABCContext, Pitch, resolveMelodyPitch, computeOctaveFromPitch } from "abcls-parser";
import { DocumentSnapshots, getSnapshotAtPosition, encode } from "abcls-parser/interpreter/ContextInterpreter";
import { toAst } from "../csTree/toAst";
import { CSNode, TAGS } from "../csTree/types";
import { Selection } from "../selection";
import { collectNotesFromChord } from "./lineUtils";
import { transpose } from "./transpose";
import { findChildByTag, getNodeLineAndChar } from "./treeUtils";
import { findNodesById } from "./types";

/**
 * The drop voicings that rearrange an existing chord.
 *
 * A drop voicing opens a close-position chord by moving one or more of its
 * inner voices down an octave. The voices are counted from the top of the
 * chord, so drop 2 lowers the second-highest note, drop 3 the third-highest,
 * and drop 2-4 both the second and the fourth.
 */
export type DropVoicing = "drop2" | "drop24" | "drop3";

/**
 * The voices each drop voicing lowers, as zero-based positions counted down
 * from the top of the chord.
 */
const DROPPED_POSITIONS: Record<DropVoicing, number[]> = {
  drop2: [1],
  drop24: [1, 3],
  drop3: [2],
};

/**
 * Resolves a note's sounding MIDI pitch, taking the key signature and the
 * accidentals already established in the measure into account. Returns null
 * when the node carries no pitch, as is the case for a rest.
 */
function resolveNoteMidi(noteNode: CSNode, snapshots: DocumentSnapshots): number | null {
  const pitchCSNode = findChildByTag(noteNode, TAGS.Pitch);
  if (pitchCSNode === null) return null;

  const pitchExpr = toAst(pitchCSNode) as Pitch;
  const letter = pitchExpr.noteLetter.lexeme.toUpperCase();
  const octave = computeOctaveFromPitch(pitchExpr);
  const explicitAccidental = pitchExpr.alteration ? pitchExpr.alteration.lexeme : null;

  const { line, char } = getNodeLineAndChar(noteNode);
  // The snapshot one position earlier describes the context the note is read
  // in, rather than the one this note itself establishes.
  const snapshot = getSnapshotAtPosition(snapshots, encode(line, char) - 1);
  if (!snapshot) return null;

  return resolveMelodyPitch(letter, octave, explicitAccidental, {
    key: snapshot.key,
    measureAccidentals: snapshot.measureAccidentals,
    transpose: 0,
  });
}

/**
 * Collects the notes a drop voicing lowers in one chord, adding their IDs to
 * the given set.
 *
 * The voices are ranked by sounding pitch rather than by the order they are
 * written in, because ABC does not require a chord's notes to appear in
 * ascending order. A chord holding fewer notes than the voicing addresses is
 * left alone: there is no sensible fourth voice to drop in a triad.
 */
function collectDroppedNotes(chordNode: CSNode, positions: number[], snapshots: DocumentSnapshots, dropped: Set<number>): void {
  const notes = collectNotesFromChord(chordNode);

  const ranked: Array<{ id: number; midi: number }> = [];
  for (const note of notes) {
    const midi = resolveNoteMidi(note, snapshots);
    if (midi === null) return;
    ranked.push({ id: note.id, midi });
  }

  const highestPosition = Math.max(...positions);
  if (ranked.length <= highestPosition) return;

  ranked.sort((a, b) => b.midi - a.midi);
  for (const position of positions) {
    dropped.add(ranked[position].id);
  }
}

/**
 * Rearranges selected chords into a drop voicing by lowering the voices that
 * voicing names by one octave.
 *
 * Only chords are affected: a drop voicing rearranges the notes already
 * present, so a single note has no inner voice to drop. The lowered notes keep
 * their spelling exactly, because transposing by a whole octave only moves the
 * octave markers.
 *
 * @param selection The selection containing Chord node IDs
 * @param voicing Which drop voicing to apply
 * @param ctx ABCContext for generating node IDs
 * @param snapshots DocumentSnapshots for resolving each note's sounding pitch
 * @returns The modified selection
 */
export function dropVoicing(selection: Selection, voicing: DropVoicing, ctx: ABCContext, snapshots: DocumentSnapshots): Selection {
  const positions = DROPPED_POSITIONS[voicing];
  if (!positions) return selection;

  // The notes are gathered before anything moves, so that a chord is ranked by
  // the pitches it was written with rather than by ones a previous drop in the
  // same pass has already lowered.
  const dropped = new Set<number>();
  for (const cursor of selection.cursors) {
    for (const csNode of findNodesById(selection.root, cursor)) {
      if (csNode.tag !== TAGS.Chord) continue;
      collectDroppedNotes(csNode, positions, snapshots, dropped);
    }
  }

  if (dropped.size === 0) return selection;

  transpose({ root: selection.root, cursors: [dropped] }, -12, ctx, snapshots);
  return selection;
}
