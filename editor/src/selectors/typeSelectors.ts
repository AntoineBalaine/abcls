import { isAnnotation, isChord, isNote, isRest, isRhythm, isRhythmParent } from "../csTree/types";
import { Selection } from "../selection";
import { fanOutByPredicate } from "./fanOut";

export function selectChords(input: Selection): Selection {
  return fanOutByPredicate(input, isChord, "all");
}

export function selectNotes(input: Selection): Selection {
  return fanOutByPredicate(input, isNote, "all");
}

export function selectNonChordNotes(input: Selection): Selection {
  return fanOutByPredicate(input, isNote, "skipChordChildren");
}

export function selectChordNotes(input: Selection): Selection {
  return fanOutByPredicate(input, isNote, "onlyChordNotes");
}

export function selectRests(input: Selection): Selection {
  return fanOutByPredicate(input, isRest, "all");
}

export function selectRhythm(input: Selection): Selection {
  return fanOutByPredicate(input, isRhythm, "all");
}

export function selectRhythmParent(input: Selection): Selection {
  return fanOutByPredicate(input, isRhythmParent, "all");
}

export function selectNotesOrChords(input: Selection): Selection {
  return fanOutByPredicate(input, (node) => isNote(node) || isChord(node), "skipChordChildren");
}

export function selectAnnotations(input: Selection): Selection {
  return fanOutByPredicate(input, isAnnotation, "all");
}
