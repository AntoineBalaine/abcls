// Selection types and utilities
export { Selection, Cursor, createSelection } from "./selection";

// CSTree types and utilities
export {
  CSNode,
  CSNodeOf,
  TokenData,
  TuneBodyData,
  NodeData,
  EditorDataMap,
  TAGS,
  ParentRef,
  isTokenNode,
  getTokenData,
  createCSNode,
  isRest,
  isNote,
  isChord,
  isBarLine,
  isBeam,
  isRhythm,
  isYSpacer,
  hasRhythmChild,
  isRhythmParent,
} from "./csTree/types";
export { fromAst } from "./csTree/fromAst";
export { toAst } from "./csTree/toAst";

// Selectors
export {
  selectChords,
  selectNotes,
  selectNonChordNotes,
  selectChordNotes,
  selectRests,
  selectRhythm,
  selectRhythmParent,
  selectAnnotations,
} from "./selectors/typeSelectors";
export { selectTune } from "./selectors/structureSelectors";
export { selectTop, selectBottom, selectNthFromTop, selectAllButTop, selectAllButBottom } from "./selectors/chordSelectors";
export {
  selectInsideChord,
  selectAroundChord,
  selectInsideGraceGroup,
  selectAroundGraceGroup,
  selectInsideInlineField,
  selectAroundInlineField,
  selectInsideGrouping,
  selectAroundGrouping,
} from "./selectors/delimiterSelectors";
export { selectMeasures } from "./selectors/measureSelector";
export { selectRange } from "./selectors/rangeSelector";
export { selectVoices, isVoiceMarker, extractVoiceId } from "./selectors/voiceSelector";
export { selectSystem } from "./selectors/systemSelector";
export { fanOutByPredicate, WalkStrategy } from "./selectors/fanOut";
export {
  firstTokenData,
  firstTokenNode,
  lastTokenData,
  comparePositions,
  buildIdMap,
  findNodeById,
  findByTag,
  findFirstByTag,
  findByPos,
  FindByPosResult,
  walkByTag,
} from "./selectors/treeWalk";

// Transforms
export {
  findNodesById,
  TransformFn,
  InspectionFn,
  findChildByTag,
  findRhythmChild,
  findTieChild,
  replaceRhythm,
  replaceNodeWithSequence,
  getNodeLineAndChar,
  rhythmToRational,
  rationalToRhythm,
  extractBrokenToken,
  getNodeRhythm,
  remove,
  transpose,
  dropVoicing,
  DropVoicing,
  toRest,
  setRhythm,
  sumRhythm,
  addToRhythm,
  unwrapSingle,
  enharmonize,
  enharmonizeToKey,
  filter,
  pitch,
  length,
  addVoice,
  VoiceParams,
  harmonize,
  pitchToDiatonic,
  diatonicToPitch,
  stepDiatonic,
  VoicingType,
  HarmonizeSnapshot,
  extractLead,
  formatNote,
  toChordAst,
  toCSChord,
  harmonizeVoicing,
  consolidateRests,
  insertVoiceLine,
  voiceInfoLineToInline,
  voiceInlineToInfoLine,
  explode,
  explode2,
  explode3,
  explode4,
  addSharp,
  addFlat,
  multiplyRhythm,
  divideRhythm,
  consolidateTiedNotes,
  legato,
  toSlashNotation,
  parallelVoicing,
  parallelDiatonic,
  parallelChromatic,
  ParallelDirection,
  ParallelMode,
  splitSystem,
  splitSystems,
  SplitMetadata,
  explosion,
} from "./transforms";

// Context utilities
export { getContextForNode } from "./context/contextUtils";
export { interpretContext, CsContextState } from "./context/csContextInterpreter";
export { buildMap, init, finalize, BarMap, BarEntry, BarMapState } from "./context/csBarMap";

// Utils
export { diffChars, Change } from "./utils/diffToPatches";
export { computeNodeRange, rangesOverlap } from "./utils/rangeUtils";

// Transform runner (shared by the language server and the CLI)
export { lookupTransform, CONTEXT_AWARE_TRANSFORMS } from "./runner/transformLookup";
export { serializeCSTree } from "./runner/csTreeSerializer";
export { GROUPED_CURSOR_TRANSFORMS, POSITION_BASED_TRANSFORMS, TRANSFORM_NODE_TAGS } from "./runner/transformConstants";
export {
  findNodesInRange,
  findNotesAndChordsInRange,
  resolveRanges,
  resolveSelectionRanges,
  resolveContiguousRanges,
} from "./runner/selectionRangeResolver";
export { runTransform, rangesOfVoices, TransformRequest, TransformError } from "./runner/runTransform";
export { harmonizeVoices, HarmonizeVoicesOptions } from "./runner/harmonizeVoices";
export { blockChords, BlockChordsOptions } from "./runner/blockChords";
export { TopNoteRule, LeadKind } from "./runner/blockChords";
