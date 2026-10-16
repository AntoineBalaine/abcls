import {
  Selection,
  selectChords,
  selectNotes,
  selectNonChordNotes,
  selectChordNotes,
  selectRests,
  selectAnnotations,
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

type SelectorFn = (sel: Selection, ...args: (number | string)[]) => Selection;

const SELECTOR_MAP: Record<string, SelectorFn> = {
  selectChords: (sel) => selectChords(sel),
  selectNotes: (sel) => selectNotes(sel),
  selectNonChordNotes: (sel) => selectNonChordNotes(sel),
  selectChordNotes: (sel) => selectChordNotes(sel),
  selectRests: (sel) => selectRests(sel),
  selectAnnotations: (sel) => selectAnnotations(sel),
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

export function lookupSelector(name: string): SelectorFn | null {
  return SELECTOR_MAP[name] ?? null;
}

export function getAvailableSelectors(): string[] {
  return Object.keys(SELECTOR_MAP);
}
