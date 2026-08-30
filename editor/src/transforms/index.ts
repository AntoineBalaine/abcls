export { findNodesById, TransformFn, InspectionFn } from "./types";
export { findChildByTag, findRhythmChild, findTieChild, replaceRhythm, replaceNodeWithSequence, getNodeLineAndChar } from "./treeUtils";
export { rhythmToRational, rationalToRhythm, extractBrokenToken, getNodeRhythm } from "./rhythm";
export { remove } from "./remove";
export { transpose } from "./transpose";
export { dropVoicing, DropVoicing } from "./revoice";
export { toRest } from "./toRest";
export { setRhythm } from "./setRhythm";
export { sumRhythm } from "./sumRhythm";
export { addToRhythm } from "./addToRhythm";
export { unwrapSingle } from "./unwrapSingle";
export { enharmonize, enharmonizeToKey } from "./enharmonize";
export { filter } from "./filter";
export { pitch } from "./pitch";
export { length } from "./length";
export { addVoice, VoiceParams } from "./addVoice";
export {
  harmonize,
  pitchToDiatonic,
  diatonicToPitch,
  stepDiatonic,
  // Phase 5: Chord-symbol-based harmonization
  VoicingType,
  HarmonizeSnapshot,
  extractLead,
  formatNote,
  toChordAst,
  toCSChord,
  harmonizeVoicing,
} from "./harmonize";
export { consolidateRests } from "./consolidateRests";
export { consolidateTiedNotes } from "./consolidateTiedNotes";
export { insertVoiceLine } from "./insertVoiceLine";
export { voiceInfoLineToInline, voiceInlineToInfoLine } from "./voiceMarkerTransform";
export { explode, explode2, explode3, explode4 } from "./explode";
export { addSharp, addFlat } from "./addAccidental";
export { multiplyRhythm } from "./multiplyRhythm";
export { divideRhythm } from "./divideRhythm";
export { legato } from "./legato";
export { toSlashNotation } from "./toSlashNotation";
export { parallelVoicing, parallelDiatonic, parallelChromatic, ParallelDirection, ParallelMode } from "./parallel";
export { splitSystem, splitSystems, SplitMetadata } from "./splitSystem";
export { explosion } from "./explosionTimed";
