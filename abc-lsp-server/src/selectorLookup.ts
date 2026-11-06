import {
  CSNode,
  moveSelectionsToNote,
  moveSelectionsToChord,
  moveSelectionsToElement,
  selectContaining,
  ContainerKind,
  Selection,
  selectChords,
  selectNotes,
  selectNonChordNotes,
  selectChordNotes,
  selectRests,
  selectAnnotations,
  selectComments,
  selectRhythm,
  selectRhythmParent,
  selectTune,
  selectTop,
  selectBottom,
  selectNthFromTop,
  selectAllButTop,
  selectAllButBottom,
  selectInsideChord,
  selectAroundChord,
  selectInsideGraceGroup,
  selectAroundGraceGroup,
  selectInsideInlineField,
  selectAroundInlineField,
  selectInsideGrouping,
  selectAroundGrouping,
  selectMeasures,
  selectVoices,
  selectSystem,
} from "abcls-editor";
import { Range } from "vscode-languageserver/node";

type SelectorFn = (sel: Selection, ...args: (number | string)[]) => Selection;

const SELECTOR_MAP: Record<string, SelectorFn> = {
  selectChords: (sel) => selectChords(sel),
  selectNotes: (sel) => selectNotes(sel),
  selectNonChordNotes: (sel) => selectNonChordNotes(sel),
  selectChordNotes: (sel) => selectChordNotes(sel),
  selectRests: (sel) => selectRests(sel),
  selectAnnotations: (sel) => selectAnnotations(sel),
  selectComments: (sel) => selectComments(sel),
  selectRhythm: (sel) => selectRhythm(sel),
  selectRhythmParent: (sel) => selectRhythmParent(sel),
  selectTune: (sel) => selectTune(sel),
  selectTop: (sel) => selectTop(sel),
  selectBottom: (sel) => selectBottom(sel),
  selectNthFromTop: (sel, n) => selectNthFromTop(sel, n as number),
  selectAllButTop: (sel) => selectAllButTop(sel),
  selectAllButBottom: (sel) => selectAllButBottom(sel),
  // Delimiter selectors (inside/around patterns)
  selectInsideChord: (sel) => selectInsideChord(sel),
  selectAroundChord: (sel) => selectAroundChord(sel),
  selectInsideGraceGroup: (sel) => selectInsideGraceGroup(sel),
  selectAroundGraceGroup: (sel) => selectAroundGraceGroup(sel),
  selectInsideInlineField: (sel) => selectInsideInlineField(sel),
  selectAroundInlineField: (sel) => selectAroundInlineField(sel),
  selectInsideGrouping: (sel) => selectInsideGrouping(sel),
  selectAroundGrouping: (sel) => selectAroundGrouping(sel),
  selectMeasures: (sel) => selectMeasures(sel),
  selectVoices: (sel, voiceIds) => selectVoices(sel, voiceIds as string),
  selectSystem: (sel) => selectSystem(sel),
};

/**
 * A navigator moves the selections of the editor, which may be empty carets, and so it works on ranges and not on a selection of nodes.
 */
type NavigatorFn = (root: CSNode, selections: Range[], lines: string[], ...args: (number | string)[]) => Range[];

const NAVIGATOR_MAP: Record<string, NavigatorFn> = {
  selectNextNote: (root, selections, _lines, steps) => moveSelectionsToNote(root, selections, "next", Number(steps ?? 1)),
  selectPreviousNote: (root, selections, _lines, steps) => moveSelectionsToNote(root, selections, "previous", Number(steps ?? 1)),
  // The elements that hold the caret: the note under it, the measure around it, the system that it is in.
  selectNextElement: (root, selections, _lines, steps) => moveSelectionsToElement(root, selections, "next", Number(steps ?? 1)),
  selectPreviousElement: (root, selections, _lines, steps) => moveSelectionsToElement(root, selections, "previous", Number(steps ?? 1)),
  selectNextChord: (root, selections, _lines, steps) => moveSelectionsToChord(root, selections, "next", Number(steps ?? 1)),
  selectPreviousChord: (root, selections, _lines, steps) => moveSelectionsToChord(root, selections, "previous", Number(steps ?? 1)),
};

/** The elements that hold the caret, with the key suffix of the selector that names each one. */
const CONTAINER_SELECTORS: Record<string, ContainerKind> = {
  Note: "note",
  Measure: "measure",
  System: "system",
  Tune: "tune",
  Annotation: "annotation",
  Decoration: "decoration",
  Beam: "beam",
  Directive: "directive",
  Comment: "comment",
};

// Because the selector of an element that holds the caret comes in two forms, inside gives the element and around widens it with the text.
for (const [suffix, kind] of Object.entries(CONTAINER_SELECTORS)) {
  NAVIGATOR_MAP[`selectInside${suffix}`] = (root, selections) => selectContaining(root, selections, kind);
  NAVIGATOR_MAP[`selectAround${suffix}`] = (root, selections, lines) => selectContaining(root, selections, kind, lines);
}

export function lookupNavigator(name: string): NavigatorFn | null {
  return NAVIGATOR_MAP[name] ?? null;
}

export function lookupSelector(name: string): SelectorFn | null {
  return SELECTOR_MAP[name] ?? null;
}

export function getAvailableSelectors(): string[] {
  return Object.keys(SELECTOR_MAP);
}
