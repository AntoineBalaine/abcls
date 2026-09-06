/**
 * Tune Interpreter
 *
 * Main interpreter that converts ABC AST into ABCJS Tune format.
 * Uses semantic data pre-computed by the analyzer and builds incrementally
 * following the ABCJS builder pattern.
 */

import { SemanticAnalyzer } from "../analyzers/semantic-analyzer";
import { SemanticData } from "../analyzers/semantic-analyzer";
import { isComment, isInfo_line } from "../helpers";
import { ABCContext } from "../parsers/Context";
import { Token, TT } from "../parsers/scan";
import {
  Tune,
  StaffSystem,
  VoiceElement,
  NoteElement,
  BarElement,
  ElementType,
  RestType,
  Pitch as ABCJSPitch,
  LyricProperties,
  LyricDivider,
  Decorations,
  ClefProperties,
  KeyElement,
  MeterElement,
  TextLine,
  TextFieldProperties,
  SlurStyle,
  GraceNote,
  ChordProperties,
  ChordPlacement,
  Font,
  TuneFormatting,
} from "../types/abcjs-ast";
import {
  FontSpec,
  MeasurementSpec,
  MidiSpec,
  StaffDirectiveData,
  FontDirectiveType,
  MeasurementDirectiveType,
  NumberDirectiveType,
  BooleanValueDirectiveType,
  PositionDirectiveType,
} from "../types/directive-specs";
import { InfoLineUnion } from "../types/Expr";
import {
  Visitor,
  File_structure,
  File_header,
  Tune as TuneExpr,
  Tune_header,
  Tune_Body,
  Info_line,
  Directive,
  Note,
  Rest,
  Chord,
  ChordSymbol,
  BarLine,
  Grace_group,
  Decoration,
  SystemBreak,
  Symbol,
  Beam,
  Tuplet,
  Annotation,
  Inline_field,
  MultiMeasureRest,
  YSPACER,
  Voice_overlay,
  Line_continuation,
  Macro_decl,
  Macro_invocation,
  User_symbol_decl,
  User_symbol_invocation,
  Lyric_line,
  Lyric_section,
  Pitch,
  Rhythm,
  ErrorExpr,
  KV,
  Binary,
  Grouping,
  AbsolutePitch,
  Rational,
  Measurement,
  Comment,
  isKeyInfo,
  isMeterInfo,
  isVoiceInfo,
  isTempoInfo,
  isNoteLengthInfo,
  isTitleInfo,
  isComposerInfo,
  isOriginInfo,
  isReferenceNumberInfo,
  isRhythmInfo,
  isBookInfo,
  isSourceInfo,
  isDiscographyInfo,
  isNotesInfo,
  isTranscriptionInfo,
  isHistoryInfo,
  isAuthorInfo,
} from "../types/Expr";
import { IRational, createRational, multiplyRational, rationalToNumber } from "../Visitors/fmt/rational";
import { RangeVisitor } from "../Visitors/RangeVisitor";
import { convertAccidentalToType, determineBarType, fontSpecToFont } from "./helpers";
import {
  InterpreterState,
  FileDefaults,
  createFileDefaults,
  createInterpreterState,
  getCurrentVoice,
  nextMeasure,
  TuneDefaults,
  VoiceState,
  initVxState,
  initVxNomenclature,
  switchToVoice,
} from "./InterpreterState";

/**
 * Helper Functions
 */

/**
 * Tuplet Q lookup table (abcjs tripletQ)
 * Maps p (number of notes) to q (time they fit into)
 * E.g., (3 means 3 notes in the time of 2
 */
const TUPLET_Q: Record<number, number> = {
  2: 3, // (2 → 2 notes in time of 3
  3: 2, // (3 → 3 notes in time of 2
  4: 3, // (4 → 4 notes in time of 3
  5: 2, // (5 → 5 notes in time of 2
  6: 2, // (6 → 6 notes in time of 2
  7: 2, // (7 → 7 notes in time of 2
  8: 3, // (8 → 8 notes in time of 3
  9: 2, // (9 → 9 notes in time of 2
};

/**
 * Decoration mapping (abcjs letter_to_accent)
 * Maps ABC decoration symbols to abcjs decoration names
 */
const DECORATION_MAP: Record<string, string> = {
  ".": "staccato",
  u: "upbow",
  v: "downbow",
  "~": "irishroll",
  H: "fermata",
  J: "slide",
  L: "accent",
  M: "mordent",
  O: "coda",
  P: "pralltriller",
  R: "roll",
  S: "segno",
  T: "trill",
};

/**
 * Calculates the rhythm multiplier from a Rhythm expression.
 *
 * Examples:
 *   "2" → 2/1
 *   "/" → 1/2
 *   "//" → 1/4
 *   "///" → 1/8
 *   "/2" → 1/2
 *   "3/2" → 3/2
 *   "0" → 0/1 (grace notes)
 */
/**
 * Gets the broken rhythm multipliers based on the broken rhythm symbol.
 * Returns [currentNoteMultiplier, nextNoteMultiplier] as rationals.
 *
 * Because the ABC notation uses a pattern where the first note takes (2 - 1/2^n)
 * and the second note takes 1/2^n (where n is the number of symbols), we calculate
 * the appropriate multipliers.
 *
 * Examples:
 *   > (n=1): [3/2, 1/2] = [1.5, 0.5]
 *   >> (n=2): [7/4, 1/4] = [1.75, 0.25]
 *   >>> (n=3): [15/8, 1/8] = [1.875, 0.125]
 */
function getBrokenRhythmMultipliers(brokenLexeme: string): [IRational, IRational] {
  const char = brokenLexeme[0];
  const count = brokenLexeme.length;

  // Short note denominator: 2^n (2, 4, 8, ...)
  const shortNoteDenominator = Math.pow(2, count);
  const shortNoteNumerator = 1;

  // Long note = 2 - (short note) = (2 * 2^n - 1) / 2^n
  const longNoteNumerator = 2 * shortNoteDenominator - 1;
  const longNoteDenominator = shortNoteDenominator;

  if (char === ">") {
    // Current note gets longer, next note gets shorter
    return [createRational(longNoteNumerator, longNoteDenominator), createRational(shortNoteNumerator, shortNoteDenominator)];
  } else if (char === "<") {
    // Current note gets shorter, next note gets longer
    return [createRational(shortNoteNumerator, shortNoteDenominator), createRational(longNoteNumerator, longNoteDenominator)];
  }

  return [createRational(1, 1), createRational(1, 1)]; // Default (shouldn't happen)
}

/**
 * Calculates the full duration for a musical element (note/rest/chord)
 * including broken rhythm handling.
 *
 * @param rhythm - The rhythm expression from the AST
 * @param defaultLength - The default note length from tune state
 * @param voiceState - Voice state for broken rhythm tracking (optional for stateless calculation)
 * @returns Duration and optional next-note multiplier
 */
function calculateRhythm(
  rhythm: Rhythm | undefined | null,
  defaultLength: IRational,
  voiceState?: VoiceState
): {
  duration: IRational; // Final duration for current note
  nextMultiplier?: IRational; // Multiplier to store for next note (if broken rhythm)
} {
  // Step 1: Calculate base rhythm multiplier (without broken rhythm)
  let baseMultiplier: IRational;

  if (!rhythm) {
    baseMultiplier = createRational(1, 1);
  } else if (rhythm.broken) {
    // Broken rhythms don't have additional rhythm notation
    baseMultiplier = createRational(1, 1);
  } else {
    // Parse rhythm notation (numerator/denominator)
    let num = 1;
    let den = 1;

    if (rhythm.numerator) {
      const numValue = parseInt(rhythm.numerator.lexeme, 10);
      if (!isNaN(numValue)) {
        num = numValue;
      }
    }

    if (rhythm.separator) {
      if (rhythm.separator.lexeme === "/") {
        // Single slash
        if (rhythm.denominator) {
          const denValue = parseInt(rhythm.denominator.lexeme, 10);
          if (!isNaN(denValue) && denValue > 0) {
            den = denValue;
          } else {
            // "/" with invalid number → implied /2
            den = 2;
          }
        } else {
          // "/" alone → implied /2
          den = 2;
        }
      } else {
        // Multiple slashes: each slash divides by 2
        const slashCount = rhythm.separator.lexeme.length;
        den = Math.pow(2, slashCount);
      }
    }

    baseMultiplier = createRational(num, den);
  }

  // Step 2: Calculate duration = defaultLength * baseMultiplier
  let duration = multiplyRational(defaultLength, baseMultiplier);

  // Step 3: Apply pending broken rhythm from previous note (if any)
  let nextMultiplier: IRational | undefined;

  if (voiceState?.nextNoteDurationMultiplier) {
    duration = multiplyRational(duration, voiceState.nextNoteDurationMultiplier);
    // Clear the multiplier after applying (side effect on voiceState)
    voiceState.nextNoteDurationMultiplier = undefined;
  }

  // Step 4: Handle broken rhythm on current note (if any)
  if (rhythm?.broken && voiceState) {
    const [currentMultiplier, nextMult] = getBrokenRhythmMultipliers(rhythm.broken.lexeme);
    duration = multiplyRational(duration, currentMultiplier);
    nextMultiplier = nextMult; // To be stored by caller
  }

  return {
    duration,
    nextMultiplier,
  };
}

/**
 * Beaming Helper Functions
 *
 * Based on abcjs beaming algorithm:
 * - Notes with duration < 0.25 can be beamed
 * - Beams break on: quarter notes, rests, bars, whitespace
 * - Track potentialStartBeam and potentialEndBeam per voice
 */

/**
 * Checks whether a note can be beamed (duration < 1/4 and duration > 0).
 * Zero-duration notes (slash notation) are not beamed.
 */
function canBeam(duration: IRational): boolean {
  if (duration.numerator === 0) return false;
  // duration < 1/4
  // duration.num / duration.den < 1/4
  // duration.num * 4 < duration.den
  return duration.numerator * 4 < duration.denominator;
}

/**
 * Ends the current beam group (if any) by setting startBeam and endBeam properties.
 */
function endBeamGroup(voiceState: VoiceState): void {
  if (voiceState.potentialStartBeam && voiceState.potentialEndBeam) {
    voiceState.potentialStartBeam.startBeam = true;
    voiceState.potentialEndBeam.endBeam = true;
  }
  voiceState.potentialStartBeam = undefined;
  voiceState.potentialEndBeam = undefined;
}

/**
 * Processes beaming for a note element.
 * Because beaming needs to be determined after each note is created,
 * we call this after creating each note element.
 */
function processBeaming(noteElement: NoteElement, voiceState: VoiceState, isRest: boolean): void {
  const duration = noteElement.duration;

  // Beam breaks on:
  // 1. Quarter notes or longer (duration >= 1/4)
  // 2. Rests
  // 3. Zero-duration notes (slash notation)

  // Zero-duration notes break beams
  const isZeroDuration = duration.numerator === 0;

  // Check if duration >= 1/4
  // duration.num / duration.den >= 1/4
  // duration.num * 4 >= duration.den
  const isQuarterOrLonger = duration.numerator * 4 >= duration.denominator;

  if (isQuarterOrLonger || isRest || isZeroDuration) {
    // End beam on previous note (if any)
    endBeamGroup(voiceState);
    return;
  }

  // Short note (8th, 16th, etc.) and not a rest
  if (canBeam(duration) && !isRest) {
    if (!voiceState.potentialStartBeam) {
      // Start new beam group
      voiceState.potentialStartBeam = noteElement;
      voiceState.potentialEndBeam = undefined;
    } else {
      // Continue beam group
      voiceState.potentialEndBeam = noteElement;
    }
  }
}

/**
 * Tie Processing
 */

/**
 * Processes tie start for a note or chord.
 * When a note has a tie (-), we mark it with startTie and add it to pendingTies.
 */
function processTieStart(pitches: ABCJSPitch[], voiceState: VoiceState): void {
  for (const pitch of pitches) {
    if (pitch.pitch !== undefined) {
      pitch.startTie = {};
      voiceState.pendingTies.set(pitch.pitch, {});
    }
  }
}

/**
 * Processes tie end for a note or chord.
 * Because in abcjs a tie connects to the NEXT note/chord, we need to handle two cases:
 * - If the next note/chord has the same pitch, that pitch gets endTie
 * - If the next note/chord has different pitches, ALL pending ties end (on ANY pitch in the chord)
 * This matches abcjs behavior where C2-|D2 sets endTie on D.
 */
function processTieEnd(pitches: ABCJSPitch[], voiceState: VoiceState): void {
  if (voiceState.pendingTies.size === 0) return;

  // First, try to match pitches exactly
  const matchedPitches = new Set<number>();
  for (const pitch of pitches) {
    if (pitch.pitch !== undefined && voiceState.pendingTies.has(pitch.pitch)) {
      pitch.endTie = {};
      matchedPitches.add(pitch.pitch);
    }
  }

  // Remove matched ties
  for (const matched of matchedPitches) {
    voiceState.pendingTies.delete(matched);
  }

  // If there are still pending ties and we didn't match them, end them on the first pitch
  // This handles the case where C2-|D2 should set endTie on D
  if (voiceState.pendingTies.size > 0 && pitches.length > 0 && pitches[0].pitch !== undefined) {
    pitches[0].endTie = {};
    voiceState.pendingTies.clear();
  }
}

/**
 * Slur Processing
 */

/**
 * Applies start slurs to pitches.
 * When we encounter '(' or '.(' tokens, we push an entry onto openSlurs, and
 * this function marks the not-yet-applied entries applied, writing their
 * label onto the current note's first pitch. Entries stay on openSlurs after
 * being applied (only their startApplied flag changes) since they must
 * remain there until a later ')' token pops them to set endSlur.
 */
function applyStartSlurs(pitches: ABCJSPitch[], voiceState: VoiceState): void {
  const unapplied = voiceState.openSlurs.filter((slur) => !slur.startApplied);
  if (unapplied.length === 0) return;

  for (const pitch of pitches) {
    if (pitch.pitch !== undefined) {
      // Apply all pending start slurs to this pitch
      // Each slur has { label, style? } - spread to include style if present
      pitch.startSlur = unapplied.map((slur) => (slur.style ? { label: slur.label, style: slur.style } : { label: slur.label }));
      break; // Only apply to first pitch
    }
  }

  for (const slur of unapplied) {
    slur.startApplied = true;
  }
}

/**
 * Decoration Processing
 */

/**
 * Applies pending decorations to a note element.
 * Decorations are ornaments and articulations like staccato, trill, etc.
 */
function applyDecorations(element: NoteElement, voiceState: VoiceState): void {
  if (voiceState.pendingDecorations.length === 0) return;

  // Apply decorations to the element
  element.decoration = [...voiceState.pendingDecorations];

  // Clear pending decorations
  voiceState.pendingDecorations = [];
}

/**
 * Grace Note Processing
 */

/**
 * Applies pending grace notes to a note element.
 * Grace notes are ornamental notes that precede the main note.
 */
function applyGraceNotes(element: NoteElement, voiceState: VoiceState): void {
  if (voiceState.pendingGraceNotes.length === 0) return;

  // Apply grace notes to the element
  element.gracenotes = [...voiceState.pendingGraceNotes];

  // Clear pending grace notes
  voiceState.pendingGraceNotes = [];
}

/**
 * Chord Symbol Processing
 */

/**
 * Applies pending chord symbols to a note element.
 */
function applyChordSymbols(element: NoteElement, voiceState: VoiceState): void {
  if (voiceState.pendingChordSymbols.length === 0) return;

  // Apply chord symbols to the element
  element.chord = [...voiceState.pendingChordSymbols];

  // Clear pending chord symbols
  voiceState.pendingChordSymbols = [];
}

/**
 * Tuplet Processing
 */

/**
 * Applies tuplet properties to a note element.
 * Because tuplet notation spans multiple notes, we mark the first note with startTriplet
 * and tripletMultiplier, and we mark the last note with endTriplet.
 */
function applyTuplet(element: NoteElement, voiceState: VoiceState): void {
  if (voiceState.tupletNotesLeft <= 0) return;

  // First note of tuplet gets startTriplet, tripletMultiplier, and tripletR
  if (voiceState.tupletNotesLeft === voiceState.tupletR) {
    element.startTriplet = voiceState.tupletP;
    element.tripletMultiplier = voiceState.tupletQ / voiceState.tupletP;
    element.tripletR = voiceState.tupletR;
  }

  // Decrement counter
  voiceState.tupletNotesLeft--;

  // Last note of tuplet gets endTriplet
  if (voiceState.tupletNotesLeft === 0) {
    element.endTriplet = true;
  }
}

/**
 * Type Guards for SemanticData
 */
function isInfoLineSemanticData(data: SemanticData): data is InfoLineUnion {
  const infoTypes = [
    "key",
    "meter",
    "voice",
    "tempo",
    "title",
    "composer",
    "origin",
    "note_length",
    "clef",
    "reference_number",
    "rhythm",
    "book",
    "source",
    "discography",
    "notes",
    "transcription",
    "history",
    "author",
  ];
  return infoTypes.includes(data.type);
}

/**
 * Helper Functions for Processing Semantic Data
 */
type HeaderContext =
  | { type: "file_header"; target: FileDefaults }
  | { type: "tune_header"; target: { tune: Tune; tuneDefaults: TuneDefaults; parserConfig: import("./InterpreterState").ParserConfig } };

/**
 * Processes info line semantic data and assigns it to the appropriate target.
 * @returns Warning message if the info line is not valid in this context
 */
function applyInfoLine(semanticData: InfoLineUnion, context: HeaderContext): string | null {
  // Process properties that work in both file and tune headers
  const metaText = context.type === "file_header" ? context.target.metaText : context.target.tune.metaText;

  if (isTitleInfo(semanticData)) {
    let title = semanticData.data;

    // Apply titlecaps transformation if directive is set
    const parserConfig = context.type === "file_header" ? context.target.parserConfig : context.target.parserConfig;
    if (parserConfig.titlecaps === true) {
      title = title.toUpperCase();
    }

    // Only set title if not already set (keep the first T: line as main title)
    // Subsequent T: lines in the header are subtitles (ABC 2.1 spec)
    if (!metaText.title) {
      metaText.title = title;
    }
    return null;
  }
  if (isComposerInfo(semanticData)) {
    // Multiple C: lines are concatenated with newlines (matching abcjs behavior)
    const existing = metaText.composer;
    metaText.composer = existing ? existing + "\n" + semanticData.data : semanticData.data;
    return null;
  }
  if (isOriginInfo(semanticData)) {
    // Multiple O: lines are concatenated with newlines (matching abcjs behavior)
    const existing = metaText.origin;
    metaText.origin = existing ? existing + "\n" + semanticData.data : semanticData.data;
    return null;
  }
  if (isRhythmInfo(semanticData)) {
    // Multiple R: lines are concatenated with newlines (matching abcjs behavior)
    const existing = metaText.rhythm;
    metaText.rhythm = existing ? existing + "\n" + semanticData.data : semanticData.data;
    return null;
  }
  if (isBookInfo(semanticData)) {
    // Multiple B: lines are concatenated with newlines (matching abcjs behavior)
    const existing = metaText.book;
    metaText.book = existing ? existing + "\n" + semanticData.data : semanticData.data;
    return null;
  }
  if (isSourceInfo(semanticData)) {
    // Multiple S: lines are concatenated with newlines (matching abcjs behavior)
    const existing = metaText.source;
    metaText.source = existing ? existing + "\n" + semanticData.data : semanticData.data;
    return null;
  }
  if (isDiscographyInfo(semanticData)) {
    // Multiple D: lines are concatenated with newlines (matching abcjs behavior)
    const existing = metaText.discography;
    metaText.discography = existing ? existing + "\n" + semanticData.data : semanticData.data;
    return null;
  }
  if (isNotesInfo(semanticData)) {
    // Multiple N: lines are concatenated with newlines (matching abcjs behavior)
    const existing = metaText.notes;
    metaText.notes = existing ? existing + "\n" + semanticData.data : semanticData.data;
    return null;
  }
  if (isTranscriptionInfo(semanticData)) {
    // Multiple Z: lines are concatenated with newlines (matching abcjs behavior)
    const existing = metaText.transcription;
    metaText.transcription = existing ? existing + "\n" + semanticData.data : semanticData.data;
    return null;
  }
  if (isHistoryInfo(semanticData)) {
    // Multiple H: lines are concatenated with newlines (matching abcjs behavior)
    const existing = metaText.history;
    metaText.history = existing ? existing + "\n" + semanticData.data : semanticData.data;
    return null;
  }
  if (isAuthorInfo(semanticData)) {
    metaText.author = semanticData.data;
    return null;
  }
  if (isTempoInfo(semanticData)) {
    metaText.tempo = semanticData.data;
    if (context.type === "tune_header") {
      context.target.tuneDefaults.tempo = semanticData.data;
    }
    return null;
  }
  if (isNoteLengthInfo(semanticData)) {
    if (context.type === "file_header") {
      context.target.noteLength = semanticData.data;
    } else {
      context.target.tuneDefaults.noteLength = semanticData.data;
    }
    return null;
  }
  if (isReferenceNumberInfo(semanticData)) {
    // X: (reference number) is typically not stored in metaText
    // Could be stored in metaTextInfo if needed
    return null;
  }

  // Process tune-only properties
  if (context.type === "file_header") {
    return `Info line ${semanticData.type}: is not allowed in file header`;
  }

  // Tune header only
  if (isKeyInfo(semanticData)) {
    context.target.tuneDefaults.key = semanticData.data.keySignature;
    if (semanticData.data.clef) {
      context.target.tuneDefaults.clef = semanticData.data.clef;
    }

    // Automatically enable bagpipes formatting for HP/Hp keys (matching abcjs behavior)
    // In abcjs, K:HP and K:Hp automatically call parseDirective.addDirective("bagpipes")
    const keyRoot = semanticData.data.keySignature.root;
    if (keyRoot === "HP" || keyRoot === "Hp") {
      context.target.tune.formatting.bagpipes = true;
    }
  } else if (isMeterInfo(semanticData)) {
    context.target.tuneDefaults.meter = semanticData.data;
  }
  // Voice is handled separately in visitInfoLineExpr

  return null;
}

/**
 * Type predicate: Check if directive is a measurement directive
 */
// -- Directive category sets ------------------------------------------------
// Because we dispatch formatting directives by category, we use sets derived
// from the subtype unions in directive-specs.ts. The sets contain all font
// keys that exist in TuneFormatting (excluding barlabelfont, barnumberfont,
// barnumfont which have no TuneFormatting counterpart).
const FONT_DIRECTIVES: Set<string> = new Set<FontDirectiveType>([
  "titlefont",
  "gchordfont",
  "composerfont",
  "subtitlefont",
  "tempofont",
  "footerfont",
  "headerfont",
  "voicefont",
  "partsfont",
  "tripletfont",
  "vocalfont",
  "textfont",
  "annotationfont",
  "historyfont",
  "infofont",
  "measurefont",
  "repeatfont",
  "wordsfont",
  "tablabelfont",
  "tabnumberfont",
  "tabgracefont",
]);
const MEASUREMENT_DIRECTIVES: Set<string> = new Set<MeasurementDirectiveType>([
  "botmargin",
  "botspace",
  "composerspace",
  "indent",
  "leftmargin",
  "linesep",
  "musicspace",
  "partsspace",
  "pageheight",
  "pagewidth",
  "rightmargin",
  "stafftopmargin",
  "staffsep",
  "staffwidth",
  "subtitlespace",
  "sysstaffsep",
  "systemsep",
  "textspace",
  "titlespace",
  "topmargin",
  "topspace",
  "vocalspace",
  "wordsspace",
  "vskip",
]);
const NUMBER_DIRECTIVES: Set<string> = new Set<NumberDirectiveType>([
  "lineThickness",
  "voicescale",
  "scale",
  "barsperstaff",
  "measurenb",
  "barnumbers",
  "setbarnb",
  "fontboxpadding",
  "bar",
  "bar10",
]);
const BOOLEAN_VALUE_DIRECTIVES: Set<string> = new Set<BooleanValueDirectiveType>(["graceslurs", "staffnonote", "printtempo", "partsbox", "freegchord"]);
const POSITION_DIRECTIVES: Set<string> = new Set<PositionDirectiveType>(["vocal", "dynamic", "gchord", "ornament", "volume"]);

/**
 * Routes a formatting directive's data to the appropriate TuneFormatting field.
 * Because the semantic analyzer produces typed data (FontSpec, MeasurementSpec, etc.)
 * but TuneFormatting expects converted types (Font, number, etc.), we dispatch
 * by directive category and apply the appropriate conversion.
 */
function applyFormattingDirective(formatting: TuneFormatting, directiveName: string, data: unknown): void {
  if (FONT_DIRECTIVES.has(directiveName)) {
    const fontKey = directiveName as keyof TuneFormatting & string;
    const currentFont = formatting[fontKey] as Font | undefined;
    formatting[fontKey] = fontSpecToFont(data as FontSpec, currentFont) as never;
  } else if (MEASUREMENT_DIRECTIVES.has(directiveName)) {
    const key = directiveName as keyof TuneFormatting & string;
    formatting[key] = (data as MeasurementSpec).value as never;
  } else if (NUMBER_DIRECTIVES.has(directiveName)) {
    const key = directiveName as keyof TuneFormatting & string;
    formatting[key] = data as number as never;
  } else if (BOOLEAN_VALUE_DIRECTIVES.has(directiveName)) {
    const key = directiveName as keyof TuneFormatting & string;
    formatting[key] = data as boolean as never;
  } else if (POSITION_DIRECTIVES.has(directiveName)) {
    // Position directives (vocal, dynamic, etc.) are not yet in TuneFormatting
    const fmt = formatting as Record<string, unknown>;
    fmt[directiveName] = data;
  } else {
    // Fallback for uncategorized directives (percmap, sep, deco, etc.)
    const fmt = formatting as Record<string, unknown>;
    fmt[directiveName] = data;
  }
}

/**
 * Processes directive semantic data and assigns it to the appropriate target.
 * @returns Warning message if the directive is not valid in this context
 */
function applyDirective(semanticData: SemanticData, directiveName: string, context: HeaderContext): string | null {
  const metaText = context.type === "file_header" ? context.target.metaText : context.target.tune.metaText;
  const formatting = context.type === "file_header" ? context.target.formatting : context.target.tune.formatting;
  const parserConfig = context.type === "file_header" ? context.target.parserConfig : context.target.parserConfig;

  // Normalize directive name to lowercase for case-insensitive matching (ABC spec allows both %%MIDI and %%midi)
  directiveName = directiveName.toLowerCase();

  // Handle abc-version specially
  if (semanticData.type === "abc-version") {
    if (context.type === "file_header") {
      context.target.version = semanticData.data;
    } else {
      context.target.tune.version = semanticData.data;
    }
    return null;
  }

  // Handle abc-* metaText directives
  // Multiple occurrences are concatenated with newline (matching abcjs behavior)
  if (semanticData.type === "abc-copyright") {
    const existing = metaText["abc-copyright"];
    metaText["abc-copyright"] = existing ? existing + "\n" + semanticData.data : semanticData.data;
    return null;
  } else if (semanticData.type === "abc-creator") {
    const existing = metaText["abc-creator"];
    metaText["abc-creator"] = existing ? existing + "\n" + semanticData.data : semanticData.data;
    return null;
  } else if (semanticData.type === "abc-edited-by") {
    const existing = metaText["abc-edited-by"];
    metaText["abc-edited-by"] = existing ? existing + "\n" + semanticData.data : semanticData.data;
    return null;
  } else if (semanticData.type === "header") {
    // Store header data in metaText (tab-separated left/center/right)
    metaText.header = semanticData.data;
    return null;
  } else if (semanticData.type === "footer") {
    // Store footer data in metaText (tab-separated left/center/right)
    metaText.footer = semanticData.data;
    return null;
  }

  // List of formatting directives that require a tune context
  const formattingOnlyDirectives = ["bagpipes", "flatbeams", "jazzchords", "accentAbove", "germanAlphabet", "titleleft", "measurebox", "nobarcheck"];

  // Check if this is a formatting directive in file header
  if (context.type === "file_header" && formattingOnlyDirectives.includes(directiveName)) {
    return `Directive %%${directiveName} is not allowed in file header (requires tune context)`;
  }

  // Categorize directives: parser config, formatting, or ignored
  // Parser config directives affect parsing but are not exposed in output
  if (directiveName === "landscape" || directiveName === "titlecaps" || directiveName === "continueall") {
    if (typeof semanticData.data === "boolean") {
      parserConfig[directiveName] = semanticData.data;
    }
  } else if (directiveName === "papersize") {
    if (typeof semanticData.data === "string") {
      parserConfig.papersize = semanticData.data;
    }
  } else if (directiveName === "font") {
    // Ignored directive - abcjs does nothing with it
    return null;
  } else if (directiveName === "midi") {
    // Special handling for MIDI directives
    // Because MIDI directives accumulate state (e.g., drummap builds up a mapping),
    // we need to handle them differently than simple value directives.
    const midiData = semanticData.data as MidiSpec;

    // Initialize formatting.midi if it doesn't exist
    if (!formatting.midi) {
      formatting.midi = {};
    }

    // Handle drummap command: builds up a pitch-to-MIDI-note mapping
    if (midiData.command === "drummap") {
      if (!formatting.midi.drummap) {
        formatting.midi.drummap = {};
      }
      // Format: drummap <note> <midi-number>
      const [noteName, midiNumber] = midiData.params;
      if (typeof noteName === "string" && typeof midiNumber === "number") {
        formatting.midi.drummap[noteName] = midiNumber;
      }
    }
    // TODO: Handle other MIDI commands (transpose, program, etc.)
  } else {
    applyFormattingDirective(formatting, directiveName, semanticData.data);
  }

  return null;
}

/**
 * Score/Staves Directive Handler
 */

/**
 * Handles %%score and %%staves directives by populating the interpreter state
 * with pre-defined staff/voice assignments.
 *
 * Because %%score and %%staves directives define the staff layout before any music is encountered,
 * we directly populate the state's staves and vxStaff maps with the parsed staff layout information
 * when these directives are encountered.
 *
 * @param state - The interpreter state to update
 * @param data - Parsed staff layout data from the directive analyzer
 */
function handleScoreDirective(state: InterpreterState, data: StaffDirectiveData): void {
  state.stavesNomenclatures = data.staves;
  state.vxNomenclatures = data.voiceAssignments;
}

/**
 * Because %%text and %%center directives create text entries in the tune's systems array,
 * we handle them specially to create TextLine entries with appropriate formatting.
 *
 * @param state - The interpreter state to update
 * @param semanticData - Parsed text directive data from the directive analyzer
 */
/**
 * Parses text content with inline font switches ($N syntax).
 *
 * Because text content can contain $N switches to change fonts inline,
 * we need to split the text into segments and assign the appropriate font
 * to each segment.
 *
 * Syntax:
 * - $N: Switch to registered font N (1-9)
 * - $0: Return to default font
 * - $$: Literal dollar sign
 *
 * Example: "Normal $1bold$0 text" with font 1 registered as bold
 * Returns: [
 *   { text: "Normal ", font: defaultFont },
 *   { text: "bold", font: registeredFonts[1] },
 *   { text: " text", font: defaultFont }
 * ]
 */
function parseFontChangeLine(
  text: string,
  registeredFonts: Map<number, FontSpec>,
  defaultFont: FontSpec | undefined
): Array<{ text: string; font: FontSpec | undefined }> {
  // Use a placeholder for $$ escaping (character unlikely to appear in text)
  const ESCAPE_PLACEHOLDER = "\x03";
  text = text.replace(/\$\$/g, ESCAPE_PLACEHOLDER);

  const segments: Array<{ text: string; font: FontSpec | undefined }> = [];
  const parts = text.split("$");

  // First part (before any $) uses default font
  if (parts.length > 0 && parts[0].length > 0) {
    segments.push({ text: parts[0], font: defaultFont });
  }

  // Process remaining parts (after $)
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];

    if (part.length === 0) {
      // Empty segment after $, treat as literal
      if (segments.length > 0) {
        segments[segments.length - 1].text += "$";
      } else {
        segments.push({ text: "$", font: defaultFont });
      }
      continue;
    }

    const firstChar = part[0];
    const fontNum = parseInt(firstChar, 10);

    // Check if first character is a digit
    if (firstChar >= "0" && firstChar <= "9") {
      const segmentText = part.substring(1);

      if (fontNum === 0) {
        // $0: Return to default font
        if (segmentText.length > 0) {
          segments.push({ text: segmentText, font: defaultFont });
        }
      } else if (registeredFonts.has(fontNum)) {
        // $N: Use registered font N
        if (segmentText.length > 0) {
          segments.push({ text: segmentText, font: registeredFonts.get(fontNum) });
        }
      } else {
        // Font not registered, treat as literal
        if (segments.length > 0) {
          segments[segments.length - 1].text += "$" + part;
        } else {
          segments.push({ text: "$" + part, font: defaultFont });
        }
      }
    } else {
      // Not a digit, treat as literal $
      if (segments.length > 0) {
        segments[segments.length - 1].text += "$" + part;
      } else {
        segments.push({ text: "$" + part, font: defaultFont });
      }
    }
  }

  // Restore $$ as $ in all segments
  for (const segment of segments) {
    segment.text = segment.text.replace(new RegExp(ESCAPE_PLACEHOLDER, "g"), "$");
  }

  return segments;
}

function handleTextDirective(
  state: InterpreterState,
  semanticData: SemanticData,
  abcRange: {
    startChar: number;
    endChar: number;
  }
): void {
  let text = semanticData.data as string;
  const isCenter = semanticData.type === "center";

  // Strip surrounding quotes if present (the analyzer includes quotes in the text)
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1);
  }

  // Parse text for inline font switches ($N syntax)
  // Because the text may contain $1, $2, etc. to switch fonts inline,
  // we need to split it into segments with appropriate font assignments.
  // Note: $0 resets to no font (undefined), not to textfont default.
  // This matches abcjs behavior where $0 creates segments with no font property.
  const segments = parseFontChangeLine(text, state.registeredFonts, undefined);

  // Create TextFieldProperties for each segment
  const textFields: TextFieldProperties[] = segments.map((segment) => {
    const field: TextFieldProperties = {
      text: segment.text,
      center: isCenter,
      startChar: abcRange.startChar,
      endChar: abcRange.endChar,
    };

    // Apply font if specified
    // Because TextFieldProperties.font is a Font object, not individual properties,
    // we need to construct the Font object from the FontSpec returned by the analyzer.
    if (segment.font) {
      field.font = {
        face: segment.font.face || "",
        size: segment.font.size || 12,
        weight: segment.font.weight === "bold" ? "bold" : "normal",
        style: segment.font.style === "italic" ? "italic" : "normal",
        decoration: segment.font.decoration === "underline" ? "underline" : "none",
      };
    }

    return field;
  });

  // Create TextLine with all segments
  const textLine: TextLine = {
    text: textFields,
  };

  // Add the TextLine to the tune's systems array
  state.tune.systems.push(textLine);
}

/**
 * Parse Result
 */
export interface ParseResult {
  tunes: Tune[];
  warnings?: string[];
}

/**
 * Main Tune Interpreter
 */
export class TuneInterpreter implements Visitor<void> {
  analyzer: SemanticAnalyzer;
  ctx: ABCContext;
  state!: InterpreterState;
  rangeVisitor: RangeVisitor;

  // Working state for file-level processing
  fileDefaults!: FileDefaults;
  tunes: Tune[] = [];

  // Processing context tracking
  processingContext: "file_header" | "tune_header" | "tune_body" = "file_header";

  private sourceText: string = "";
  private lineOffsets: number[] = [];

  constructor(analyzer: SemanticAnalyzer, ctx: ABCContext, sourceText?: string) {
    this.analyzer = analyzer;
    this.ctx = ctx;
    this.rangeVisitor = new RangeVisitor();

    if (sourceText) {
      this.sourceText = sourceText;
      this.calculateLineOffsets();
    }
  }

  private calculateLineOffsets(): void {
    this.lineOffsets = [0];
    for (let i = 0; i < this.sourceText.length; i++) {
      if (this.sourceText[i] === "\n") {
        this.lineOffsets.push(i + 1);
      }
    }
  }

  private toAbsolutePosition(line: number, character: number): number {
    if (line >= this.lineOffsets.length) return character;
    return this.lineOffsets[line] + character;
  }

  /**
   * Pushes an element directly to the current voice's output location.
   *
   * This ensures that voice state exists (creating a default voice for single-voice tunes if needed),
   * ensures the voice nomenclature and structures are created (systems/staffs/voices arrays),
   * then writes to the cached location (currentSystemNum, currentStaffNum, currentVoiceIndex).
   */
  private pushElement(element: VoiceElement): void {
    const voiceId = this.state.currentVoice;
    const vxNomenclature = this.state.vxNomenclatures.get(voiceId);

    // Switch if: no nomenclature, no switch yet (pointers are -1), or pointing to different voice
    if (
      !vxNomenclature ||
      this.state.currentStaffNum === -1 ||
      this.state.currentVoiceIndex === -1 ||
      vxNomenclature.staffNum !== this.state.currentStaffNum ||
      vxNomenclature.index !== this.state.currentVoiceIndex
    ) {
      switchToVoice(this.state, voiceId);
    }

    const { currentSystemNum, currentStaffNum, currentVoiceIndex } = this.state;

    // Write directly to the final output structure
    const system = this.state.tune.systems[currentSystemNum] as StaffSystem;
    system.staff[currentStaffNum].voices[currentVoiceIndex].push(element);
  }

  /**
   * Gets the current voice's element array for operations that need to read or modify it.
   * Because most operations should write directly to the output, we should use this sparingly
   * and prefer pushElement() for adding elements.
   */
  private getCurrentVoiceElements(): VoiceElement[] {
    const { currentSystemNum, currentStaffNum, currentVoiceIndex } = this.state;
    const system = this.state.tune.systems[currentSystemNum] as StaffSystem;
    return system.staff[currentStaffNum].voices[currentVoiceIndex];
  }

  /**
   * Public API
   */
  interpretFile(fileStructure: File_structure): ParseResult {
    this.tunes = [];
    this.fileDefaults = createFileDefaults();

    // Visit the file structure (will process header and tunes)
    fileStructure.accept(this);

    return { tunes: this.tunes };
  }

  /**
   * Visitor Implementation
   */
  visitFileStructureExpr(expr: File_structure): void {
    // Process file header first
    if (expr.file_header) {
      expr.file_header.accept(this);
    }

    // Process each tune
    for (const content of expr.contents) {
      if (content instanceof TuneExpr) {
        content.accept(this);
      }
    }
  }

  visitFileHeaderExpr(expr: File_header): void {
    // Set processing context
    this.processingContext = "file_header";

    // Extract file-level info and directives from semantic data
    const context: HeaderContext = { type: "file_header", target: this.fileDefaults };

    for (const item of expr.contents) {
      if (item instanceof Info_line) {
        const semanticData = this.analyzer.data.get(item.id);
        if (semanticData && isInfoLineSemanticData(semanticData)) {
          const warning = applyInfoLine(semanticData, context);
          if (warning) {
            this.ctx.errorReporter.interpreterError(warning, item);
          }
        }
      } else if (item instanceof Directive) {
        const semanticData = this.analyzer.data.get(item.id);
        if (semanticData) {
          const warning = applyDirective(semanticData, item.key.lexeme, context);
          if (warning) {
            this.ctx.errorReporter.interpreterError(warning, item);
          }
        }
      }
    }
  }

  visitTuneExpr(expr: TuneExpr): void {
    // Create fresh state for this tune
    this.state = createInterpreterState(this.analyzer.data, this.fileDefaults);

    // Initialize tune with file defaults (deep copy to avoid sharing references)
    this.state.tune.metaText = structuredClone(this.fileDefaults.metaText);
    this.state.tune.formatting = structuredClone(this.fileDefaults.formatting);
    if (this.fileDefaults.version) {
      this.state.tune.version = this.fileDefaults.version;
    }

    // Set processing context and visit tune header
    this.processingContext = "tune_header";
    expr.tune_header.accept(this);

    // Visit tune body if present
    if (expr.tune_body) {
      expr.tune_body.accept(this);
    }

    // Finalize and store tune
    this.finalizeTune();
    this.tunes.push(this.state.tune);
  }

  visitTuneHeaderExpr(expr: Tune_header): void {
    // Process all info lines and directives
    for (const line of expr.info_lines) {
      line.accept(this);
    }
  }

  visitTuneBodyExpr(expr: Tune_Body): void {
    // Set processing context
    this.processingContext = "tune_body";

    // Process each ABC text line (not systems - voices control system creation now)
    for (const abcLine of expr.sequence) {
      // Visit each element in the ABC text line
      for (const element of abcLine) {
        if (!(isComment(element) || isInfo_line(element) || element instanceof Lyric_line || element instanceof ErrorExpr)) {
          initVxState(this.state, this.state.voices.get(this.state.currentVoice));
        }
        element.accept(this);
      }
    }

    // Note: No createMusicLine() call needed - elements are written directly
    // to tune.systems via the multi-staff system
  }

  visitInfoLineExpr(expr: Info_line): void {
    const semanticData = this.state.semanticData.get(expr.id);
    if (!semanticData || !isInfoLineSemanticData(semanticData)) return;

    if (this.processingContext === "tune_body") {
      // Inline info line in tune body - can change voice, key, meter, tempo, note length, clef
      if (isVoiceInfo(semanticData)) {
        initVxState(this.state, semanticData.data);

        // Also assign to staff if not yet assigned (same as header handling)
        // This ensures voices declared after K: get proper staff assignment
        const { id } = semanticData.data;
        if (!this.state.vxNomenclatures.has(id)) {
          const voice = this.state.voices.get(id)!;
          initVxNomenclature(this.state, id, voice.properties);
        }

        // Force a voice switch to find the next available system slot
        // This is critical for repeated voice switching (V:1 ... V:1 ... V:1)
        // where each V:1 should continue from where the previous one left off.
        // Unlike pushElement's lazy switch, this actively searches for the next slot.
        switchToVoice(this.state, id);
      } else if (isKeyInfo(semanticData)) {
        const voice = getCurrentVoice(this.state);
        if (voice) {
          voice.currentKey = semanticData.data.keySignature;
          if (semanticData.data.clef) {
            voice.currentClef = semanticData.data.clef;
          }
        }
        // Also update tune defaults for future voices
        this.state.tuneDefaults.key = semanticData.data.keySignature;
        if (semanticData.data.clef) {
          this.state.tuneDefaults.clef = semanticData.data.clef;
        }
      } else if (isMeterInfo(semanticData)) {
        const voice = getCurrentVoice(this.state);
        if (voice) {
          voice.currentMeter = semanticData.data;
        }
        this.state.tuneDefaults.meter = semanticData.data;
      } else if (isNoteLengthInfo(semanticData)) {
        this.state.tuneDefaults.noteLength = semanticData.data;
      } else if (isTempoInfo(semanticData)) {
        this.state.tuneDefaults.tempo = semanticData.data;
      }
    } else {
      // Header info line - use the helper function
      const context: HeaderContext = {
        type: "tune_header",
        target: { tune: this.state.tune, tuneDefaults: this.state.tuneDefaults, parserConfig: this.state.parserConfig },
      };
      const warning = applyInfoLine(semanticData, context);
      if (warning) {
        this.ctx.errorReporter.interpreterError(warning, expr);
      }

      // Handle voice separately since it requires state manipulation
      // In header: register voice with properties but DON'T switch to it
      // (abcjs only creates actual staff structures when voices write elements in body)
      if (isVoiceInfo(semanticData)) {
        initVxState(this.state, semanticData.data);

        const { id } = semanticData.data;
        // Assign to staff (but don't switch) - this creates StaffInfo entry
        // but doesn't create actual system/staff structures yet
        if (!this.state.vxNomenclatures.has(id)) {
          const voice = this.state.voices.get(id)!;
          initVxNomenclature(this.state, id, voice.properties);
        }
      }
    }
  }

  visitDirectiveExpr(expr: Directive): void {
    const semanticData = this.state.semanticData.get(expr.id);
    if (semanticData) {
      // Handle score/staves directives specially - they configure staff layout
      if (semanticData.type === "score" || semanticData.type === "staves") {
        handleScoreDirective(this.state, semanticData.data);
        return;
      }

      // Handle setfont directives - register fonts for inline font switching
      // Because fonts need to be registered before they can be used in text/center directives,
      // we process setfont directives in all contexts (file header, tune header, and body).
      if (semanticData.type === "setfont") {
        const { number, font } = semanticData.data;
        // Store in file defaults if in file header (state doesn't exist yet),
        // otherwise store in tune state (which shares the same Map reference)
        if (this.processingContext === "file_header") {
          this.fileDefaults.registeredFonts.set(number, font);
        } else {
          this.state.registeredFonts.set(number, font);
        }
        return;
      }

      // Handle text/center directives specially - they create TextLine entries in systems[]
      // Only process these in tune context (not file header)
      if ((semanticData.type === "text" || semanticData.type === "center") && this.processingContext !== "file_header") {
        const range = expr.accept(this.rangeVisitor);

        const abc_range = {
          startChar: this.toAbsolutePosition(range.start.line, range.start.character),
          endChar: this.toAbsolutePosition(range.end.line, range.end.character),
        };
        handleTextDirective(this.state, semanticData, abc_range);
        return;
      }

      if (this.processingContext === "file_header") {
        const context: HeaderContext = { type: "file_header", target: this.fileDefaults };
        const warning = applyDirective(semanticData, expr.key.lexeme, context);
        if (warning) {
          this.ctx.errorReporter.interpreterError(warning, expr);
        }
      } else {
        // Tune header or body
        const context: HeaderContext = {
          type: "tune_header",
          target: { tune: this.state.tune, tuneDefaults: this.state.tuneDefaults, parserConfig: this.state.parserConfig },
        };
        const warning = applyDirective(semanticData, expr.key.lexeme, context);
        if (warning) {
          this.ctx.errorReporter.interpreterError(warning, expr);
        }
      }
    }
  }

  visitNoteExpr(expr: Note): void {
    const noteLetter = expr.pitch.noteLetter.lexeme;
    const accidental = expr.pitch.alteration?.lexeme;
    const octave = expr.pitch.octave?.lexeme;

    const basePitch = this.getBasePitch(noteLetter);
    const octaveOffset = octave ? this.getOctaveOffset(octave) : 0;
    const pitchNumber = basePitch + octaveOffset;

    // Get current voice state for clef and rhythm calculations
    const voiceState = this.state.voices.get(this.state.currentVoice);
    const clef = voiceState?.currentClef;

    const pitch: ABCJSPitch = {
      pitch: pitchNumber,
      name: (accidental || "") + noteLetter,
      verticalPos: this.calculateVerticalPos(pitchNumber, clef),
      accidental: accidental ? convertAccidentalToType(accidental) : undefined,
    };

    // Calculate duration with broken rhythm handling
    const defaultLength = this.state.tuneDefaults.noteLength;
    const rhythmResult = calculateRhythm(expr.rhythm, defaultLength, voiceState);

    // Store next multiplier if present
    if (rhythmResult.nextMultiplier && voiceState) {
      voiceState.nextNoteDurationMultiplier = rhythmResult.nextMultiplier;
    }

    const range = this.rangeVisitor.visitNoteExpr(expr);

    const duration = rhythmResult.duration;

    const startChar = this.toAbsolutePosition(range.start.line, range.start.character);
    const endChar = this.toAbsolutePosition(range.end.line, range.end.character);

    const element: NoteElement = {
      el_type: ElementType.Note,
      startChar,
      endChar,
      duration,
      pitches: [pitch],
    };

    this.pushElement(element);

    // Process beaming for this note (voiceState already retrieved above)
    if (voiceState) {
      // Process chord symbols (first, as they're typically written before everything)
      applyChordSymbols(element, voiceState);

      // Process grace notes (second, as they precede the note)
      applyGraceNotes(element, voiceState);

      // Process decorations (third, as they're typically written before the note)
      applyDecorations(element, voiceState);

      // Process tuplets (before beaming, as tuplets affect note grouping)
      applyTuplet(element, voiceState);

      processBeaming(element, voiceState, false); // false = not a rest

      // Process slurs
      if (element.pitches) {
        applyStartSlurs(element.pitches, voiceState);
      }

      // Process ties (skip for zero-duration notes because ties have no musical meaning for them)
      if (element.pitches && rhythmResult.duration.numerator !== 0) {
        // First, check if this note should end any pending ties
        processTieEnd(element.pitches, voiceState);

        // Then, check if this note starts a new tie
        if (expr.tie) {
          processTieStart(element.pitches, voiceState);
        }
      }
    }
  }

  visitRestExpr(expr: Rest): void {
    // Calculate duration with broken rhythm handling
    const voiceState = this.state.voices.get(this.state.currentVoice);
    const defaultLength = this.state.tuneDefaults.noteLength;

    // Calculate full duration (with broken rhythm from previous note)
    const rhythmResult = calculateRhythm(expr.rhythm, defaultLength, voiceState);

    // Store next multiplier if present
    if (rhythmResult.nextMultiplier && voiceState) {
      voiceState.nextNoteDurationMultiplier = rhythmResult.nextMultiplier;
    }

    const range = this.rangeVisitor.visitRestExpr(expr);

    const duration = rhythmResult.duration;

    // Determine rest type from lexeme
    // Initial classification (abcjs compatible):
    // - 'x' → "invisible"
    // - 'y' → "spacer"
    // - 'Z' → "multimeasure"
    // - 'X' → "invisible-multimeasure"
    // - 'z' → "rest" (may be upgraded to "whole" below)
    const restLexeme = expr.rest.lexeme;
    let restType: RestType;
    if (restLexeme === "x") {
      restType = RestType.Invisible;
    } else if (restLexeme === "y") {
      restType = RestType.Spacer;
    } else if (restLexeme === "Z") {
      restType = RestType.Multimeasure;
    } else if (restLexeme === "X") {
      restType = RestType.InvisibleMultimeasure;
    } else if (restLexeme === "z") {
      restType = RestType.Rest; // Initial classification
    } else {
      restType = RestType.Rest; // Default
    }

    // Post-processing for 'z' rests (abcjs logic):
    // If rest has FINAL duration==1 (after broken rhythm) and measure duration <=1, upgrade to "whole"
    // This matches abcjs behavior from abc_parse_music.js line 550-554
    // Note: Uses final duration, not base duration!
    if (restLexeme === "z" && duration.numerator === duration.denominator) {
      const measureDuration = this.getMeasureDuration(voiceState);
      if (measureDuration <= 1.0) {
        restType = RestType.Whole;
      }
    }

    const element: NoteElement = {
      el_type: ElementType.Note,
      startChar: this.toAbsolutePosition(range.start.line, range.start.character),
      endChar: this.toAbsolutePosition(range.end.line, range.end.character),
      duration,
      rest: { type: restType },
    };

    this.pushElement(element);

    // Process beaming for this rest (beams break on rests, voiceState already retrieved above)
    if (voiceState) {
      processBeaming(element, voiceState, true); // true = is a rest
    }
  }

  visitChordExpr(expr: Chord): void {
    const pitches: ABCJSPitch[] = [];

    // Get current voice state for clef
    const voiceState = this.state.voices.get(this.state.currentVoice);
    const clef = voiceState?.currentClef;

    for (const content of expr.contents) {
      if (content instanceof Note) {
        const noteLetter = content.pitch.noteLetter.lexeme;
        const accidental = content.pitch.alteration?.lexeme;
        const octave = content.pitch.octave?.lexeme;

        const basePitch = this.getBasePitch(noteLetter);
        const octaveOffset = octave ? this.getOctaveOffset(octave) : 0;
        const pitchNumber = basePitch + octaveOffset;

        pitches.push({
          pitch: pitchNumber,
          name: (accidental || "") + noteLetter,
          verticalPos: this.calculateVerticalPos(pitchNumber, clef),
          accidental: accidental ? convertAccidentalToType(accidental) : undefined,
        });
      }
    }

    if (pitches.length === 0) return;

    // Calculate duration with broken rhythm handling
    const defaultLength = this.state.tuneDefaults.noteLength;
    const rhythmResult = calculateRhythm(expr.rhythm, defaultLength, voiceState);

    // Store next multiplier if present
    if (rhythmResult.nextMultiplier && voiceState) {
      voiceState.nextNoteDurationMultiplier = rhythmResult.nextMultiplier;
    }

    const range = this.rangeVisitor.visitChordExpr(expr);

    const duration = rhythmResult.duration;

    const element: NoteElement = {
      el_type: ElementType.Note,
      startChar: this.toAbsolutePosition(range.start.line, range.start.character),
      endChar: this.toAbsolutePosition(range.end.line, range.end.character),
      duration,
      pitches,
    };

    this.pushElement(element);

    // Process beaming for this chord (voiceState already retrieved above)
    // TODO: this is a lot of duplicated code, let's consolidate into a function.
    if (voiceState) {
      // Process chord symbols (first, as they're typically written before everything)
      applyChordSymbols(element, voiceState);

      // Process grace notes (second, as they precede the note)
      applyGraceNotes(element, voiceState);

      // Process decorations (third, as they're typically written before the note)
      applyDecorations(element, voiceState);

      // Process tuplets (before beaming, as tuplets affect note grouping)
      applyTuplet(element, voiceState);

      processBeaming(element, voiceState, false); // false = not a rest

      // Process slurs
      if (element.pitches) {
        applyStartSlurs(element.pitches, voiceState);
      }

      // Process ties (skip for zero-duration chords because ties have no musical meaning for them)
      if (element.pitches && rhythmResult.duration.numerator !== 0) {
        // First, check if any pitches should end pending ties
        processTieEnd(element.pitches, voiceState);

        // Then, check if this chord starts new ties
        if (expr.tie) {
          processTieStart(element.pitches, voiceState);
        }
      }
    }
  }

  visitBarLineExpr(expr: BarLine): void {
    const barType = determineBarType(expr.barline);

    const range = this.rangeVisitor.visitBarLineExpr(expr);

    const element: BarElement = {
      el_type: ElementType.Bar,
      startChar: this.toAbsolutePosition(range.start.line, range.start.character),
      endChar: this.toAbsolutePosition(range.end.line, range.end.character),
      type: barType,
    };

    this.pushElement(element);

    // Clear beams and broken rhythm at barlines
    const voiceState = this.state.voices.get(this.state.currentVoice);
    if (voiceState) {
      // Broken rhythm does not persist across barlines
      voiceState.nextNoteDurationMultiplier = undefined;
      endBeamGroup(voiceState);
    }

    nextMeasure(this.state);
  }

  visitRhythmExpr(_expr: Rhythm): void {
    // This visitor method is not used - see calculateRhythm() helper function instead
  }

  // Placeholder implementations for other visitors
  visitPitchExpr(_expr: Pitch): void {
    // Pitch is handled inline in visitNoteExpr
  }

  visitToken(token: Token): void {
    if (token.type === TT.SLUR) {
      const voiceState = this.state.voices.get(this.state.currentVoice);
      if (voiceState) {
        if (token.lexeme === "(") {
          // Start slur: push a new entry onto the single open-slur stack.
          // applyStartSlurs marks it applied once it writes the label onto a
          // note's startSlur; it stays on the stack, unremoved, until the
          // matching ')' pops it below.
          const label = voiceState.nextSlurLabel++;
          voiceState.openSlurs.push({ label, startApplied: false });
        } else if (token.lexeme === ")") {
          // End slur: pop the most recently opened slur and retroactively add to last note
          // Because slurs can only be attached to notes, we need to check if any music has been processed yet
          if (this.state.currentSystemNum === -1 || this.state.currentStaffNum === -1 || this.state.currentVoiceIndex === -1) {
            // No music notes have been processed yet, so we skip slur attachment
            // Pop the open slur to keep the stack consistent
            if (voiceState.openSlurs.length > 0) {
              voiceState.openSlurs.pop();
            }
            return;
          }

          const elements = this.getCurrentVoiceElements();
          if (voiceState.openSlurs.length > 0 && elements.length > 0) {
            const slur = voiceState.openSlurs.pop()!;
            const lastElement = elements[elements.length - 1];

            // Add endSlur to the last note's first pitch
            if ("pitches" in lastElement && lastElement.pitches && lastElement.pitches.length > 0) {
              const pitch = lastElement.pitches[0];
              if (!pitch.endSlur) {
                pitch.endSlur = [];
              }
              pitch.endSlur.push(slur.label);
            }
          }
        }
      }
    } else if (token.type === TT.DOTTED_SLUR) {
      // Dotted slur opening (.(): same as regular slur but with style: 'dotted'
      const voiceState = this.state.voices.get(this.state.currentVoice);
      if (voiceState) {
        const label = voiceState.nextSlurLabel++;
        voiceState.openSlurs.push({ label, style: SlurStyle.Dotted, startApplied: false });
      }
    }
  }
  visitAnnotationExpr(expr: Annotation): void {
    const voiceState = this.state.voices.get(this.state.currentVoice);
    if (!voiceState) return;

    // Annotation text is the chord symbol (e.g., "C", "Dm", "G7")
    // The lexeme includes the quotes, so we need to strip them
    let chordName = expr.text.lexeme;

    // Remove surrounding quotes if present
    if ((chordName.startsWith('"') && chordName.endsWith('"')) || (chordName.startsWith("'") && chordName.endsWith("'"))) {
      chordName = chordName.slice(1, -1);
    }

    // Create chord symbol object matching abcjs format
    const chordSymbol: ChordProperties = {
      name: chordName,
      position: ChordPlacement.Default,
    };

    // Store chord symbol to be applied to the next note
    voiceState.pendingChordSymbols.push(chordSymbol);
  }
  visitCommentExpr(_expr: Comment): void {}

  visitDecorationExpr(expr: Decoration): void {
    // Decorations modify the next note, so add them to pending decorations
    const voiceState = this.state.voices.get(this.state.currentVoice);
    if (!voiceState) return;

    const lexeme = expr.decoration.lexeme;

    // Handle !decoration! or +decoration+ syntax
    if (lexeme.startsWith("!") || lexeme.startsWith("+")) {
      // Remove the delimiters
      // FIXME: need some type predicates here?
      let decoration = lexeme.slice(1, -1) as Decorations;

      // Handle leading ^ or _ (positioning hints that we ignore)
      if (decoration.startsWith("^") || decoration.startsWith("_")) {
        decoration = decoration.substring(1) as Decorations;
      }

      // Use the decoration name directly (already in abcjs format)
      if (decoration) {
        voiceState.pendingDecorations.push(decoration);
      }
    } else {
      // Handle single-character decorations
      const mappedDecoration = DECORATION_MAP[lexeme] as Decorations;
      if (mappedDecoration) {
        voiceState.pendingDecorations.push(mappedDecoration);
      }
    }
  }
  visitSystemBreakExpr(_expr: SystemBreak): void {}
  visitGraceGroupExpr(expr: Grace_group): void {
    const voiceState = this.state.voices.get(this.state.currentVoice);
    if (!voiceState) return;

    // Get current clef for vertical position calculations
    const clef = voiceState.currentClef;

    const graceNotes: GraceNote[] = [];
    let isFirstNote = true;

    for (const item of expr.notes) {
      // Skip tokens (spaces, etc.)
      if (item instanceof Token) continue;

      const note = item as Note;
      const noteLetter = note.pitch.noteLetter.lexeme;
      const accidental = note.pitch.alteration?.lexeme;
      const octave = note.pitch.octave?.lexeme;

      const basePitch = this.getBasePitch(noteLetter);
      const octaveOffset = octave ? this.getOctaveOffset(octave) : 0;
      const pitchNumber = basePitch + octaveOffset;

      const graceNote: GraceNote = {
        pitch: pitchNumber,
        name: (accidental || "") + noteLetter,
        duration: 0.125, // Grace notes are typically 1/8th notes in abcjs
        verticalPos: this.calculateVerticalPos(pitchNumber, clef),
        ...(accidental ? { accidental: convertAccidentalToType(accidental) } : {}),
        ...(isFirstNote && expr.isAccacciatura ? { acciaccatura: true } : {}),
      };

      graceNotes.push(graceNote);
      isFirstNote = false;
    }

    // Store grace notes to be applied to the next note
    voiceState.pendingGraceNotes = graceNotes;
  }

  // TODO: create a helper that can be shared with the info lines?
  visitInlineFieldExpr(expr: Inline_field): void {
    // Inline fields are analyzed by SemanticAnalyzer and reuse Info_line analysis logic
    const semanticData = this.state.semanticData.get(expr.id);
    if (!semanticData || !isInfoLineSemanticData(semanticData)) return;

    // Get character range for the inline field
    const startChar = expr.field.position;
    const lastToken = expr.text[expr.text.length - 1];
    const endChar = lastToken ? lastToken.position + lastToken.lexeme.length : expr.field.position + expr.field.lexeme.length;

    // Inline fields are always in tune_body context (they can only appear in music lines)
    // Handle the same way as Info_line in tune_body context
    if (isVoiceInfo(semanticData)) {
      initVxState(this.state, semanticData.data);

      // Same as visitInfoLineExpr: assign staff and force switch
      const { id } = semanticData.data;
      if (!this.state.vxNomenclatures.has(id)) {
        const voice = this.state.voices.get(id)!;
        initVxNomenclature(this.state, id, voice.properties);
      }
      switchToVoice(this.state, id);
    } else if (isKeyInfo(semanticData)) {
      const voice = getCurrentVoice(this.state);
      if (voice) {
        voice.currentKey = semanticData.data.keySignature;
        if (semanticData.data.clef) {
          voice.currentClef = semanticData.data.clef;
        }
      }
      // Also update tune defaults for future voices
      this.state.tuneDefaults.key = semanticData.data.keySignature;
      if (semanticData.data.clef) {
        this.state.tuneDefaults.clef = semanticData.data.clef;
      }

      // Create a key element in the voice for rendering
      const keyElement: KeyElement = {
        el_type: ElementType.Key,
        startChar,
        endChar,
        root: semanticData.data.keySignature.root,
        acc: semanticData.data.keySignature.acc,
        mode: semanticData.data.keySignature.mode,
        accidentals: semanticData.data.keySignature.accidentals,
      };
      this.pushElement(keyElement);
    } else if (isMeterInfo(semanticData)) {
      const voice = getCurrentVoice(this.state);
      if (voice) {
        voice.currentMeter = semanticData.data;
      }
      this.state.tuneDefaults.meter = semanticData.data;

      // Create a meter element in the voice for rendering
      const meterElement: MeterElement = {
        el_type: ElementType.Meter,
        startChar,
        endChar,
        type: semanticData.data.type,
        value: semanticData.data.value,
      };
      this.pushElement(meterElement);
    } else if (isNoteLengthInfo(semanticData)) {
      this.state.tuneDefaults.noteLength = semanticData.data;
    } else if (isTempoInfo(semanticData)) {
      this.state.tuneDefaults.tempo = semanticData.data;
    }
  }

  visitLyricLineExpr(expr: Lyric_line): void {
    // Lyrics come after a music line and need to be mapped to the notes
    // Parse lyric tokens into syllables with dividers
    const lyrics: LyricProperties[] = [];

    for (const token of expr.contents) {
      const lexeme = token.lexeme;

      // Skip spaces and empty tokens
      if (!lexeme || lexeme.trim() === "") continue;

      // Check for dividers: hyphen (-), underscore (_), or space
      if (lexeme === "-") {
        // Hyphen divider: if we have a previous syllable, update its divider
        if (lyrics.length > 0) {
          lyrics[lyrics.length - 1].divider = LyricDivider.Hyphen;
        }
      } else if (lexeme === "_") {
        // Underscore divider: extends previous syllable
        if (lyrics.length > 0) {
          lyrics[lyrics.length - 1].divider = LyricDivider.Underscore;
        }
      } else if (lexeme === "~" || lexeme === "\\-") {
        // Tilde or escaped hyphen: these are special cases in ABC
        // For now, treat as space
        continue;
      } else {
        // Regular syllable
        lyrics.push({
          syllable: lexeme,
          divider: LyricDivider.Space, // Default divider is space
        });
      }
    }

    // Apply lyrics to notes in the current voice
    // Because lyrics can only be attached to notes, we need to check if any music has been processed yet
    // If no system/staff/voice has been initialized (indices still at -1), there are no notes to attach lyrics to
    if (this.state.currentSystemNum === -1 || this.state.currentStaffNum === -1 || this.state.currentVoiceIndex === -1) {
      // No music notes have been processed yet, so we silently skip lyric attachment
      // This matches abcjs behavior which logs "Can't add words before the first line of music"
      // but doesn't fail parsing. We silently ignore to be lenient with non-standard ABC files.
      return;
    }

    // Go through the current voice elements to find notes
    const elements = this.getCurrentVoiceElements();
    const notesWithPitches = elements.filter((el) => "pitches" in el && el.pitches && el.pitches.length > 0) as NoteElement[];

    // Map lyrics to notes (one lyric per note)
    for (let i = 0; i < Math.min(lyrics.length, notesWithPitches.length); i++) {
      const note = notesWithPitches[i];
      if (!note.lyric) {
        note.lyric = [];
      }
      note.lyric.push(lyrics[i]);
    }
  }
  visitLyricSectionExpr(_expr: Lyric_section): void {}
  visitMacroDeclExpr(_expr: Macro_decl): void {}
  visitMacroInvocationExpr(_expr: Macro_invocation): void {}
  visitMultiMeasureRestExpr(expr: MultiMeasureRest): void {
    const range = this.rangeVisitor.visitMultiMeasureRestExpr(expr);

    // Determine rest type from lexeme
    const restLexeme = expr.rest.lexeme;
    let restType: RestType;
    if (restLexeme === "X") {
      restType = RestType.InvisibleMultimeasure;
    } else if (restLexeme === "Z") {
      restType = RestType.Multimeasure;
    } else {
      restType = RestType.Multimeasure; // Default for multi-measure
    }

    // Get the length if specified (e.g., Z4)
    const length = expr.length ? parseInt(expr.length.lexeme) : 1;

    const element: NoteElement = {
      el_type: ElementType.Note,
      startChar: this.toAbsolutePosition(range.start.line, range.start.character),
      endChar: this.toAbsolutePosition(range.end.line, range.end.character),
      duration: createRational(length * this.state.tuneDefaults.noteLength.numerator, this.state.tuneDefaults.noteLength.denominator),
      rest: { type: restType },
    };

    this.pushElement(element);
  }
  visitSymbolExpr(_expr: Symbol): void {}
  visitUserSymbolDeclExpr(_expr: User_symbol_decl): void {}
  visitUserSymbolInvocationExpr(_expr: User_symbol_invocation): void {}
  visitYSpacerExpr(_expr: YSPACER): void {}
  visitBeamExpr(expr: Beam): void {
    // User explicitly grouped these notes with beam syntax
    // We need to:
    // 1. Visit each note to create NoteElements
    // 2. Apply beaming rules to validate and potentially split the group
    // 3. Set startBeam/endBeam on valid beam groups

    // The beaming will be handled automatically by processBeaming()
    // as we visit each note/chord/rest within the beam
    for (const content of expr.contents) {
      content.accept(this);
    }

    // After visiting all notes in the beam, check if we need to end the current beam group
    // (in case the user's beam ends but we have a valid beam group running)
    const voiceState = this.state.voices.get(this.state.currentVoice);
    if (voiceState) {
      // End any pending beam at the end of the user's beam group
      endBeamGroup(voiceState);
    }
  }
  visitVoiceOverlayExpr(_expr: Voice_overlay): void {}
  visitLineContinuationExpr(_expr: Line_continuation): void {}

  visitTupletExpr(expr: Tuplet): void {
    // Parse tuplet notation: (p:q:r or (p:q or (p
    // p = number of notes
    // q = time they fit into (defaults to TUPLET_Q[p])
    // r = how many notes to apply tuplet to (defaults to p)

    const voiceState = this.state.voices.get(this.state.currentVoice);
    if (!voiceState) return;

    const p = parseInt(expr.p.lexeme, 10);
    const q = expr.q ? parseInt(expr.q.lexeme, 10) : TUPLET_Q[p] || 2;
    const r = expr.r ? parseInt(expr.r.lexeme, 10) : p;

    // Set tuplet state for the next r notes
    voiceState.tupletP = p;
    voiceState.tupletQ = q;
    voiceState.tupletR = r;
    voiceState.tupletNotesLeft = r;
  }
  visitErrorExpr(_expr: ErrorExpr): void {}
  visitKV(_expr: KV): void {}
  visitBinary(_expr: Binary): void {}
  visitGrouping(_expr: Grouping): void {}
  visitAbsolutePitch(_expr: AbsolutePitch): void {}
  visitRationalExpr(_expr: Rational): void {}
  visitMeasurementExpr(_expr: Measurement): void {}
  visitUnary(_expr: import("../types/Expr").Unary): void {}
  // ChordSymbol is ABCx-specific - ABCx files must be converted to ABC before interpretation
  visitChordSymbolExpr(_expr: ChordSymbol): void {}

  // ============================================================================
  // Helper Methods
  // ============================================================================

  getBasePitch(noteLetter: string): number {
    // abcjs uses diatonic pitch numbering (staff positions), not chromatic
    // C=0, D=1, E=2, F=3, G=4, A=5, B=6
    // Lowercase letters are one octave higher: c=7, d=8, etc.
    const upperPitches: { [key: string]: number } = {
      C: 0,
      D: 1,
      E: 2,
      F: 3,
      G: 4,
      A: 5,
      B: 6,
    };

    const letter = noteLetter.toUpperCase();
    const basePitch = upperPitches[letter] || 0;

    // If lowercase, add 7 (one octave in diatonic system)
    return noteLetter === noteLetter.toLowerCase() ? basePitch + 7 : basePitch;
  }

  getOctaveOffset(octave: string): number {
    // Octave markers shift by 7 (diatonic octave), not 12 (chromatic)
    if (octave.includes(",")) {
      return -7 * octave.length;
    } else if (octave.includes("'")) {
      return 7 * octave.length;
    }
    return 0;
  }

  /**
   * Calculates the vertical position on staff based on pitch and clef.
   * The pitch number represents the absolute musical pitch (invariant to clef)
   * The verticalPos represents the position on the staff (varies with clef)
   *
   * Formula: verticalPos = pitch - clef.verticalPos
   *
   * Example for note 'a' (pitch=12):
   * - Treble clef (verticalPos=0): verticalPos = 12 - 0 = 12
   * - Bass clef (verticalPos=-12): verticalPos = 12 - (-12) = 24
   */
  calculateVerticalPos(pitch: number, clef?: ClefProperties): number {
    if (!clef || clef.verticalPos === undefined) {
      return pitch; // Default: no adjustment
    }
    return pitch - clef.verticalPos;
  }

  /**
   * Gets the duration of a full measure based on the current meter.
   * For example, M:2/1 means a measure contains 2 whole notes, so duration = 2.0
   * M:4/4 means a measure contains 4 quarter notes = 1 whole note, so duration = 1.0
   * Default is 4/4 = 1.0
   */
  getMeasureDuration(voiceState?: VoiceState): number {
    const meter = voiceState?.currentMeter || this.state.tuneDefaults.meter;

    if (!meter || !meter.value || meter.value.length === 0) {
      return 1.0; // Default: 4/4 = 1 whole note
    }

    // Sum all the fractions in the meter
    let total = 0;
    for (const fraction of meter.value) {
      total += rationalToNumber(fraction);
    }

    return total;
  }

  finalizeTune(): void {
    // Count staffs based on actual content in systems
    // This matches abcjs behavior where the structure reflects what's actually rendered
    let maxStaffCount = 0;

    for (const system of this.state.tune.systems) {
      if (!("staff" in system)) continue;
      const staffSystem = system as StaffSystem;
      maxStaffCount = Math.max(maxStaffCount, staffSystem.staff.length);
    }

    this.state.tune.staffNum = maxStaffCount;
    // voiceNum counts declared voices (matching property test expectation)
    this.state.tune.voiceNum = this.state.voices.size;
    this.state.tune.lineNum = this.state.tune.systems.length;
    // Note: metaText and formatting were already initialized from fileDefaults in visitTuneExpr
  }
}
