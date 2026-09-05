/**
 * Unified Interpreter State
 *
 * This module defines the state structure for interpreting ABC notation into ABCJS Tune format.
 * Because we need to track state at multiple levels, we use a single hierarchical state that tracks:
 * - File-level defaults (shared across all tunes)
 * - Tune-level defaults (inherited from file, overridden per tune)
 * - Working state (current position during body traversal)
 */

import { SemanticData } from "../analyzers/semantic-analyzer";
import {
  Tune,
  KeySignature,
  Meter,
  TempoProperties,
  ClefProperties,
  MetaText,
  NoteElement,
  AccidentalType,
  KeyRoot,
  KeyAccidental,
  Mode,
  ClefType,
  MediaType,
  MeterType,
  VoiceProperties,
  Decorations,
  Staff,
  StaffSystem,
  BracketBracePosition,
  SlurStyle,
  GraceNote,
  ChordProperties,
  TuneFormatting,
} from "../types/abcjs-ast";
import { FontSpec } from "../types/directive-specs";
import { IRational, createRational } from "../Visitors/fmt/rational";
import { ABCJS_FORMATTING_DEFAULTS } from "./FormattingDefaults";

/**
 * Parser Configuration (directives that affect parsing but aren't exposed)
 */
export interface ParserConfig {
  landscape?: boolean;
  titlecaps?: boolean;
  continueall?: boolean;
  papersize?: string;
}

/**
 * File-level Defaults (shared across all tunes in a file)
 */
export interface FileDefaults {
  noteLength?: IRational;
  formatting: TuneFormatting;
  parserConfig: ParserConfig;
  version?: string;
  metaText: Partial<MetaText>;
  // Font registration (setfont directive support)
  // Maps font numbers (1-9) to font specifications, shared across all tunes
  registeredFonts: Map<number, FontSpec>;
}

/**
 * Tune-level Defaults (per-tune, inherited from file)
 */
export interface TuneDefaults {
  key: KeySignature;
  meter?: Meter;
  tempo?: TempoProperties;
  noteLength: IRational;
  clef: ClefProperties;
}

/**
 * Multi-Staff Support Structures
 */

/**
 * Information about a single staff in the output.
 * Tracks how many voices are assigned to this staff and visual grouping properties.
 *
 * Because multi-staff groupings need to span multiple staves, the bracket/brace/connectBarLines
 * properties use 'start'/'continue'/'end' markers to indicate groupings. For example:
 * - Staff 0: brace='start' (begins the brace)
 * - Staff 1: brace='continue' (continues the brace)
 * - Staff 2: brace='end' (ends the brace)
 */
export interface StaffNomenclature {
  index: number; // Staff number (0, 1, 2...)
  numVoices: number; // How many voices are assigned to this staff
  bracket?: BracketBracePosition; // Bracket grouping for ensemble scores
  brace?: BracketBracePosition; // Brace grouping for piano scores
  connectBarLines?: BracketBracePosition; // Bar line connections
}

/**
 * Maps a voice ID to its staff and position within that staff.
 */
export interface VxNomenclature {
  staffNum: number; // Which staff this voice writes to (0, 1, 2...)
  index: number; // Position within the staff's voices array (0, 1, 2...)
}

/**
 * Voice State (per voice within a tune)
 */
export interface VoiceState {
  id: string;
  properties: VoiceProperties;
  currentKey: KeySignature;
  currentClef: ClefProperties;
  currentMeter?: Meter;
  measureAccidentals: Map<"C" | "D" | "E" | "F" | "G" | "A" | "B", AccidentalType>; // Cleared each measure

  // Beam tracking (for automatic beaming)
  potentialStartBeam?: NoteElement; // First note of potential beam group
  potentialEndBeam?: NoteElement; // Last note of potential beam group

  // Tie tracking (for connecting same pitches across barlines)
  pendingTies: Map<number, {}>; // Map of pitch number to tie object

  // Slur tracking (for phrasing marks)
  pendingStartSlurs: { label: number; style?: SlurStyle }[]; // Slurs that need to start on next note
  pendingEndSlurs: number[]; // Labels for slurs that need to end on next note
  nextSlurLabel: number; // Counter for generating unique slur labels

  // Tuplet tracking (for triplets, quintuplets, etc.)
  tupletNotesLeft: number; // Number of notes remaining in current tuplet
  tupletP: number; // p in (p:q:r notation
  tupletQ: number; // q in (p:q:r notation
  tupletR: number; // r in (p:q:r notation

  // Decoration tracking (for ornaments and articulations)
  pendingDecorations: Decorations[]; // Decorations to apply to next note

  // Grace note tracking (for ornamental notes before main note)
  pendingGraceNotes: GraceNote[]; // Grace notes to apply to next note

  // Chord symbol tracking (for guitar chord annotations)
  pendingChordSymbols: ChordProperties[]; // Chord symbols to apply to next note

  // Broken rhythm tracking (for dotted rhythms like < and >)
  nextNoteDurationMultiplier?: IRational; // Multiplier for next note's duration from broken rhythm
}

type VoiceID = string;
type ExprID = number;

/**
 * Main Interpreter State (per tune being processed)
 */
export interface InterpreterState {
  // Semantic data from analyzer (shared reference)
  semanticData: Map<ExprID, SemanticData>;

  // Hierarchical defaults
  fileDefaults: FileDefaults;
  tuneDefaults: TuneDefaults;
  parserConfig: ParserConfig;

  // Working state (mutable during body processing)
  currentVoice: string;
  measureNumber: number;

  // Voice tracking
  voices: Map<VoiceID, VoiceState>;

  // Font registration (setfont directive support)
  // Maps font numbers (1-9) to font specifications for inline font switching
  registeredFonts: Map<number, FontSpec>;

  // Multi-staff tracking
  stavesNomenclatures: StaffNomenclature[]; // Staff configuration (one per staff)
  vxNomenclatures: Map<VoiceID, VxNomenclature>; // Maps voice ID to staff/index
  voiceCurrentSystem: Map<VoiceID, number>; // Tracks where each voice last wrote

  // Current write location (cached for performance)
  currentSystemNum: number; // Which system (tune.systems[]) to write to
  currentStaffNum: number; // Which staff within the system
  currentVoiceIndex: number; // Which voice within the staff

  // Output being constructed
  tune: Tune;

  // Cross-line state (for carrying beaming, slur, and tie state across system breaks)
  // These mirror the per-voice fields but track state at the tune level for line cleanup.
  potentialStartBeam?: NoteElement; // First note of a potential beam group spanning a line break
  potentialEndBeam?: NoteElement; // Last note of a potential beam group spanning a line break
  openSlurs: number[][][]; // Open slur IDs: [staffNum][voiceNum][chordPos] = slurId[]
  inTie: boolean[][]; // Whether a voice is inside a tie: [overlayLevel][voiceIndex] = boolean
}

/**
 * Factory Functions
 */
export function createFileDefaults(): FileDefaults {
  return {
    // Because abcjs includes comprehensive default font settings,
    // we clone them to ensure consistent output structure
    formatting: structuredClone(ABCJS_FORMATTING_DEFAULTS),
    parserConfig: {},
    metaText: {},
    registeredFonts: new Map(),
  };
}

export function createTuneDefaults(fileDefaults: FileDefaults): TuneDefaults {
  return {
    key: getDefaultKeySignature(),
    noteLength: fileDefaults.noteLength || createRational(1, 8),
    clef: getDefaultClef(),
  };
}

export function createInterpreterState(semanticData: Map<number, SemanticData>, fileDefaults: FileDefaults): InterpreterState {
  return {
    semanticData,
    fileDefaults,
    tuneDefaults: createTuneDefaults(fileDefaults),
    parserConfig: { ...fileDefaults.parserConfig },
    currentVoice: "",
    measureNumber: 1,
    voices: new Map(),
    // Share registered fonts from file defaults so file-level registrations are available in tunes
    registeredFonts: fileDefaults.registeredFonts,

    // Multi-staff tracking (initially empty)
    stavesNomenclatures: [],
    vxNomenclatures: new Map(),
    voiceCurrentSystem: new Map(),

    // Current write location (will be set on first voice switch)
    currentSystemNum: -1,
    currentStaffNum: -1,
    currentVoiceIndex: -1,

    tune: createEmptyTune(),

    // Cross-line state (initially empty, populated during line cleanup)
    openSlurs: [],
    inTie: [],
  };
}

export function createEmptyTune(): Tune {
  return {
    version: "1.1.0",
    media: MediaType.Screen,
    metaText: {},
    metaTextInfo: {},
    formatting: {},
    systems: [],
    staffNum: 0,
    voiceNum: 0,
    lineNum: 0,

    // Placeholder method implementations
    getBeatLength: () => 0.25,
    getPickupLength: () => 0,
    getBarLength: () => 1,
    getTotalTime: () => 0,
    getTotalBeats: () => 0,
    millisecondsPerMeasure: () => 1000,
    getBeatsPerMeasure: () => 4,
    getMeter: function () {
      // TODO: meter should be retrieved from the parsed M: info line, not from tempo.
      return { type: MeterType.Specified } as Meter;
    },
    getMeterFraction: () => createRational(4, 4),
    getKeySignature: function () {
      return getDefaultKeySignature();
    },
    getElementFromChar: () => null,
    getBpm: () => 120,
    setTiming: () => [],
    setUpAudio: () => null,
    deline: () => null,
    findSelectableElement: () => null,
    getSelectableArray: () => [],
  };
}

/**
 * Helper Functions
 */
export function getDefaultKeySignature(): KeySignature {
  return {
    root: KeyRoot.C,
    acc: KeyAccidental.None,
    mode: Mode.Major,
    accidentals: [],
  };
}

export function getDefaultClef(): ClefProperties {
  return {
    type: ClefType.Treble,
    verticalPos: 0,
    clefPos: 0,
  };
}

export function newVxState(id: string, properties: VoiceProperties, tuneDefaults: TuneDefaults): VoiceState {
  return {
    id,
    properties,
    currentKey: tuneDefaults.key,
    currentClef: properties.clef || tuneDefaults.clef,
    currentMeter: tuneDefaults.meter,
    measureAccidentals: new Map(),
    pendingTies: new Map(),
    pendingStartSlurs: [],
    pendingEndSlurs: [],
    nextSlurLabel: 101, // abcjs starts at 101
    tupletNotesLeft: 0,
    tupletP: 0,
    tupletQ: 0,
    tupletR: 0,
    pendingDecorations: [],
    pendingGraceNotes: [],
    pendingChordSymbols: [],
  };
}

/**
 * State Management Functions
 */
export function getCurrentVoice(state: InterpreterState): VoiceState | undefined {
  return state.voices.get(state.currentVoice);
}

export function clearMeasureAccidentals(state: InterpreterState): void {
  for (const voice of state.voices.values()) {
    voice.measureAccidentals.clear();
  }
}

export function nextMeasure(state: InterpreterState): void {
  state.measureNumber++;
  clearMeasureAccidentals(state);
}

/**
 * Resolves a property with hierarchical precedence.
 * Because properties can be defined at multiple levels, we apply the precedence:
 * voiceOverride > tuneDefaults > fileDefaults
 */
export function resolveProperty<T>(fileValue: T | undefined, tuneValue: T | undefined, voiceValue: T | undefined): T | undefined {
  return voiceValue ?? tuneValue ?? fileValue;
}

/**
 * Multi-Staff Helper Functions
 */

/**
 * Assigns a voice to a staff automatically based on ABC specification rules.
 *
 * Rules:
 * - First voice → creates staff 0
 * - Subsequent voices → create new staff (unless `merge` property is set)
 * - `V:X merge` → adds voice to the most recently created staff
 *
 * We call this function when we encounter a voice that hasn't been explicitly
 * assigned to a staff (e.g., via %%score directive).
 */
export function initVxNomenclature(state: InterpreterState, voiceId: string, properties?: VoiceProperties): VxNomenclature {
  let rv: VxNomenclature;

  if (state.stavesNomenclatures.length === 0) {
    // First voice creates first staff
    state.stavesNomenclatures.push({ index: 0, numVoices: 1 });
    rv = { staffNum: 0, index: 0 };
    state.vxNomenclatures.set(voiceId, rv);
  } else if (properties?.merge) {
    // "V:X merge" adds to last staff
    const lastStaff = state.stavesNomenclatures[state.stavesNomenclatures.length - 1];
    rv = {
      staffNum: lastStaff.index,
      index: lastStaff.numVoices,
    };
    state.vxNomenclatures.set(voiceId, rv);
    lastStaff.numVoices++;
  } else {
    // Default: create new staff for this voice
    const newStaffIndex = state.stavesNomenclatures.length;
    state.stavesNomenclatures.push({ index: newStaffIndex, numVoices: 1 });
    rv = { staffNum: newStaffIndex, index: 0 };
    state.vxNomenclatures.set(voiceId, rv);
  }
  return rv;
}

/**
 * Finds an available system for a voice to write to, or returns the index
 * for a new system if all existing systems have content for this voice.
 *
 * Implements the "find-or-create" pattern from abcjs's setCurrentVoice:
 * - Always search from system 0 for the first system where this voice slot is empty
 * - Uses containsNotes logic: a slot is available if it has no notes or bars
 * - If all systems have content, return tune.systems.length (create new system)
 */
export function getSystemIdx(state: InterpreterState, voiceId: string): number {
  // Extract needed values from state
  const vxStaff = state.vxNomenclatures.get(voiceId);
  if (!vxStaff) {
    throw new Error(`Voice ${voiceId} not assigned to staff. Call assignStaff first.`);
  }

  const tune = state.tune;
  const { staffNum, index: voiceIndex } = vxStaff;

  // Always search from system 0 for first available slot
  // This matches abcjs's setCurrentVoice which always starts from i=0
  for (let i = 0; i < tune.systems.length; i++) {
    const system = tune.systems[i];

    // Skip non-music lines (text, subtitles, etc.)
    if (!("staff" in system)) continue;

    const staff = (system as StaffSystem).staff;

    // Check if this voice slot is empty or has no notes (containsNotes check from abcjs)
    if (
      !staff[staffNum] ||
      !staff[staffNum].voices[voiceIndex] ||
      !staff[staffNum].voices[voiceIndex].some((el) => el.el_type === "note" || el.el_type === "bar")
    ) {
      return i;
    }
  }

  // All systems have content for this voice, need a new system
  return tune.systems.length;
}

/**
 * Ensures that the nested structure exists for writing to a specific
 * system/staff/voice location. Creates any missing levels.
 *
 * Structure: tune.systems[systemNum].staff[staffNum].voices[voiceIndex]
 *
 * This function is idempotent - safe to call multiple times for the same location.
 */
export function initVxSlot(state: InterpreterState, systemIdx: number, vxStaff: VxNomenclature, voiceState: VoiceState): void {
  const { staffNum, index: voiceIndex } = vxStaff;
  const tune = state.tune;
  // Ensure system exists
  while (tune.systems.length <= systemIdx) {
    const system: StaffSystem = {
      staff: [],
    };
    tune.systems.push(system);
  }

  const system = tune.systems[systemIdx] as StaffSystem;

  // Ensure all staffs up to and including staffNum exist (avoid gaps/undefined)
  while (system.staff.length <= staffNum) {
    const currentStaffNum = system.staff.length;
    const staffNom = state.stavesNomenclatures[currentStaffNum];

    // Get the voice that should be on this staff to determine its properties
    // Find the first voice assigned to this staff
    let voiceForStaff = voiceState;
    for (const [vid, vxNom] of state.vxNomenclatures.entries()) {
      if (vxNom.staffNum === currentStaffNum) {
        const v = state.voices.get(vid);
        if (v) {
          voiceForStaff = v;
          break;
        }
      }
    }

    const newStaff: Staff = {
      clef: voiceForStaff.currentClef,
      key: voiceForStaff.currentKey,
      meter: voiceForStaff.currentMeter,
      workingClef: voiceForStaff.currentClef,
      voices: [],
    };

    // Copy bracket/brace/connectBarLines info from StaffInfo if present
    if (staffNom.bracket) {
      newStaff.bracket = staffNom.bracket;
    }
    if (staffNom.brace) {
      newStaff.brace = staffNom.brace;
    }
    if (staffNom.connectBarLines) {
      // abcjs uses boolean - we'll use true for any connection marker
      newStaff.connectBarLines = true;
    }

    system.staff.push(newStaff);
  }

  // Ensure voice array exists in this staff
  const staff = system.staff[staffNum];
  while (staff.voices.length <= voiceIndex) {
    staff.voices.push([]);
  }

  // Keep voiceIds/voiceNames in sync with vxNomenclatures, since voice slots
  // can be lazily padded out of order (see the while loop above) before the
  // voice that actually owns a given index has been switched to.
  if (!staff.voiceIds) staff.voiceIds = [];
  if (!staff.voiceNames) staff.voiceNames = [];
  for (const [vid, vxNom] of state.vxNomenclatures.entries()) {
    if (vxNom.staffNum !== staffNum) continue;
    staff.voiceIds[vxNom.index] = vid;
    const name = state.voices.get(vid)?.properties.name;
    if (name !== undefined) staff.voiceNames[vxNom.index] = name;
  }
}

/**
 * Switches the interpreter to write to a specific voice.
 *
 * This is the main orchestration function that:
 * 1. Looks up where this voice should write (staff/index from voiceMetadata)
 * 2. Finds or creates an available system for this voice
 * 3. Ensures the nested structure exists
 * 4. Caches the write location for fast element creation
 * 5. Updates tracking so next switch starts from the next system
 *
 * After calling this, elements can be written directly to:
 * tune.systems[currentSystemNum].staff[currentStaffNum].voices[currentVoiceIndex]
 */
export function switchToVoice(state: InterpreterState, voiceID: string): void {
  const voiceState = initVxState(state, { id: voiceID });
  // Get voice nomenclature - if not initialized yet, do lazy initialization
  let vxNomenclature = state.vxNomenclatures.get(voiceID);
  if (!vxNomenclature) {
    // Lazy initialization: voice was declared in header but nomenclature not initialized yet.
    // This matches abcjs behavior where staff structures are created only when
    // voices actually write elements in the body.
    vxNomenclature = initVxNomenclature(state, voiceID, voiceState.properties);
  }

  // Find next available system slot for this voice
  const systemIdx = getSystemIdx(state, voiceID);

  // Ensure the structure exists
  initVxSlot(state, systemIdx, vxNomenclature, voiceState);

  // Cache the write location for subsequent element creation
  state.currentSystemNum = systemIdx;
  state.currentStaffNum = vxNomenclature.staffNum;
  state.currentVoiceIndex = vxNomenclature.index;
  state.currentVoice = voiceID;
  // Note: We don't update voiceCurrentSystem anymore because we always search from 0
  // This matches abcjs's setCurrentVoice behavior
}

/**
 * - Creates voice state if it doesn't exist
 * - Updates voice properties if provided
 * - Sets this voice as the "current voice"
 *
 * We call this whenever a V: directive is encountered in the body or as an inline field.
 * For header V: directives, we use addVoice() instead to avoid initializing nomenclature.
 *
 * This matches abcjs behavior where V: directives don't create structures until
 * musical elements are actually written to that voice.
 */
export function initVxState(state: InterpreterState, voice: { id: string; properties?: VoiceProperties } = { id: "" }): VoiceState {
  const { id: voiceId, properties } = voice;
  // 1. Create voice state if doesn't exist

  let vx = state.voices.get(voiceId);

  if (!vx) {
    vx = newVxState(voiceId, properties || {}, state.tuneDefaults);
    state.voices.set(voiceId, vx);
  } else if (properties) {
    if (properties.clef) {
      vx.currentClef = properties.clef;
    }
    if (properties.name !== undefined) {
      vx.properties.name = properties.name;
    }

    vx.properties = { ...vx.properties, ...properties };
  }

  // 2. Mark this voice as "pending" current voice
  // Actual switch (nomenclature initialization and structure creation) happens lazily
  // when first element is written
  state.currentVoice = voiceId;
  return vx;
}
