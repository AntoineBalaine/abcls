import { ABCContext } from "./parsers/Context";
import { Token, TT } from "./parsers/scan";
import {
  AccidentalType,
  BarElement,
  BarType,
  Decorations,
  ElementType,
  GraceNote,
  isBarElement,
  isMusicLine,
  KeySignature,
  Meter,
  MeterType,
  NoteElement,
  Pitch,
  RestType,
  StaffSystem,
  Tune,
  VoiceElement,
} from "./types/abcjs-ast";
import {
  BarLine,
  Beam,
  Beam_contents,
  Chord,
  Decoration,
  Grace_group,
  Info_line,
  MultiMeasureRest,
  Note,
  Pitch as PitchExpr,
  Rest,
  Rhythm,
  Tune as TuneExpr,
  Tune_Body,
  Tune_header,
  Tuplet,
  music_code,
  tune_body_code,
} from "./types/Expr";
import { createRational, divideRational, IRational, rationalToRhythmExpr } from "./Visitors/fmt/rational";
import { AbcFormatter } from "./Visitors/Formatter";

/**
 * Default note length reconstruction always uses. Because a Tune object
 * carries no field recording which L: value was in effect when it was
 * interpreted, reconstruction is free to pick any default as long as the
 * corresponding L: line is emitted and every rhythm multiplier is computed
 * against the same value; 1/8 is ABC's own conventional default.
 */
const DEFAULT_NOTE_LENGTH: IRational = createRational(1, 8);

function synthToken(ctx: ABCContext, type: TT, lexeme: string): Token {
  return new Token(type, lexeme, ctx.generateId());
}

const ACCIDENTAL_TO_ABC_SYMBOL: Partial<Record<AccidentalType, string>> = {
  [AccidentalType.Natural]: "=",
  [AccidentalType.Sharp]: "^",
  [AccidentalType.Flat]: "_",
  [AccidentalType.DblSharp]: "^^",
  [AccidentalType.DblFlat]: "__",
  // Quarter tones have no ABC token; TuneInterpreter never produces them from
  // real ABC input (see convertAccidentalToType), so this is a defensive
  // fallback rather than a case expected to occur in practice.
  [AccidentalType.QuarterSharp]: "^",
  [AccidentalType.QuarterFlat]: "_",
};

/**
 * Exact inverse of TuneInterpreter.getBasePitch/getOctaveOffset: given the
 * diatonic pitch number (C=0..B=6, +7 per octave, independent of clef),
 * recovers the ABC note letter (upper/lowercase) and its octave marks
 * (","/"'").
 */
export function diatonicPitchToLetterAndMarks(pitchNumber: number): { letter: string; marks: string } {
  const registerIndex = Math.floor(pitchNumber / 7);
  const stepIndex = ((pitchNumber % 7) + 7) % 7;
  const step = ["C", "D", "E", "F", "G", "A", "B"][stepIndex];
  if (registerIndex <= 0) {
    return { letter: step, marks: ",".repeat(-registerIndex) };
  }
  return { letter: step.toLowerCase(), marks: "'".repeat(registerIndex - 1) };
}

function pitchToPitchExpr(ctx: ABCContext, pitch: Pitch): PitchExpr {
  const { letter, marks } = diatonicPitchToLetterAndMarks(pitch.pitch);
  const alteration = pitch.accidental !== undefined ? synthToken(ctx, TT.ACCIDENTAL, ACCIDENTAL_TO_ABC_SYMBOL[pitch.accidental] ?? "") : undefined;
  const noteLetter = synthToken(ctx, TT.NOTE_LETTER, letter);
  const octave = marks.length > 0 ? synthToken(ctx, TT.OCTAVE, marks) : undefined;
  return new PitchExpr(ctx.generateId(), { alteration, noteLetter, octave });
}

/**
 * Exact inverse of TuneInterpreter.calculateRhythm's base-multiplier
 * computation (duration = defaultLength * multiplier), reusing the existing
 * rationalToRhythmExpr helper (already used by the editor's timed-explosion
 * transform) for the multiplier-to-token-text mapping, per its own documented
 * behavior: 1/1 emits no rhythm token, and denominators other than 2 are
 * always spelled out explicitly rather than reconstructing ABC's multi-slash
 * shorthand — both acceptable simplifications for a first version, since the
 * explicit form is always valid ABC.
 */
export function durationToRhythmExpr(ctx: ABCContext, duration: IRational, defaultLength: IRational): Rhythm | null {
  const multiplier = divideRational(duration, defaultLength);
  return rationalToRhythmExpr(multiplier, ctx);
}

function buildDecorationExprs(ctx: ABCContext, decorations: Decorations[] | undefined): Decoration[] {
  if (!decorations || decorations.length === 0) return [];
  return decorations.map((name) => new Decoration(ctx.generateId(), synthToken(ctx, TT.DECORATION, `!${name}!`)));
}

function buildTupletExpr(ctx: ABCContext, element: NoteElement): Tuplet | null {
  if (element.startTriplet === undefined) return null;
  const p = element.startTriplet;
  const q = element.tripletMultiplier !== undefined ? Math.round(element.tripletMultiplier * p) : p;
  const r = element.tripletR ?? p;
  return new Tuplet(
    ctx.generateId(),
    synthToken(ctx, TT.TUPLET_P, String(p)),
    synthToken(ctx, TT.TUPLET_Q, String(q)),
    synthToken(ctx, TT.TUPLET_R, String(r)),
    synthToken(ctx, TT.TUPLET_LPAREN, "("),
    synthToken(ctx, TT.TUPLET_COLON, ":"),
    synthToken(ctx, TT.TUPLET_COLON, ":")
  );
}

function buildGraceGroup(ctx: ABCContext, graceNotes: GraceNote[]): Grace_group {
  const isAccacciatura = graceNotes.length > 0 && !!graceNotes[0].acciaccatura;
  const notes = graceNotes.map((gn) => {
    const { letter, marks } = diatonicPitchToLetterAndMarks(gn.pitch);
    const alteration = gn.accidental !== undefined ? synthToken(ctx, TT.ACCIDENTAL, ACCIDENTAL_TO_ABC_SYMBOL[gn.accidental] ?? "") : undefined;
    const noteLetter = synthToken(ctx, TT.NOTE_LETTER, letter);
    const octave = marks.length > 0 ? synthToken(ctx, TT.OCTAVE, marks) : undefined;
    const pitch = new PitchExpr(ctx.generateId(), { alteration, noteLetter, octave });
    return new Note(ctx.generateId(), pitch);
  });
  return new Grace_group(ctx.generateId(), notes, isAccacciatura);
}

interface OpenSlur {
  label: number;
}

/**
 * Reconstructs one NoteElement (a note, rest, chord, or multi-measure rest)
 * into the corresponding music_code sequence: any preceding decoration,
 * tuplet marker, or grace group tokens, an opening slur paren if this
 * element's first pitch starts a slur, the Note/Chord/Rest expression
 * itself with its own tie token, and a closing slur paren if it ends one.
 *
 * Ties and (for chords) per-note tie tokens are read directly off each
 * Pitch's startTie/endTie per TuneInterpreter's processTieStart/processTieEnd;
 * only startTie needs a token emitted (ABC's "-" always follows the note the
 * tie starts on, never the note it resolves to). Slur numbering is not
 * needed at all on this side (unlike phase 1's SlurNumberAllocator, which
 * only existed to fit MusicXML's 1-16 numbering) since ABC's slur
 * parentheses carry no explicit number.
 */
function noteElementToMusicCode(ctx: ABCContext, element: NoteElement, defaultLength: IRational, openSlurs: OpenSlur[]): music_code[] {
  const out: music_code[] = [];

  out.push(...buildDecorationExprs(ctx, element.decoration));

  const tuplet = buildTupletExpr(ctx, element);
  if (tuplet) out.push(tuplet);

  if (element.gracenotes && element.gracenotes.length > 0) {
    out.push(buildGraceGroup(ctx, element.gracenotes));
  }

  const firstPitch = element.pitches?.[0];
  const opensSlur = firstPitch?.startSlur && firstPitch.startSlur.length > 0;
  const closesSlurLabels = firstPitch?.endSlur ?? [];

  if (opensSlur) {
    for (const _slur of firstPitch!.startSlur!) {
      openSlurs.push({ label: openSlurs.length });
      out.push(synthToken(ctx, TT.SLUR, "("));
    }
  }

  if (element.rest) {
    if (element.rest.type === RestType.Multimeasure || element.rest.type === RestType.InvisibleMultimeasure) {
      // ABC's Z<n>/X<n> length is always a plain integer count of measures;
      // that is only an exact reconstruction when duration/defaultLength is
      // itself a whole number. When it is not (defaultLength here is a fixed
      // choice this module makes, not necessarily the one the duration was
      // originally computed against), rounding would silently change the
      // reconstructed duration, so fall back to a plain rest with an exact
      // fractional rhythm instead of a lossy Z/X token.
      const restLexeme = element.rest.type === RestType.InvisibleMultimeasure ? "X" : "Z";
      const lengthMultiplier = divideRational(element.duration, defaultLength);
      const isWholeNumber = lengthMultiplier.numerator % lengthMultiplier.denominator === 0;
      if (isWholeNumber) {
        const lengthValue = lengthMultiplier.numerator / lengthMultiplier.denominator;
        const lengthToken = lengthValue > 1 ? synthToken(ctx, TT.NUMBER, String(lengthValue)) : undefined;
        out.push(new MultiMeasureRest(ctx.generateId(), synthToken(ctx, TT.REST, restLexeme), lengthToken));
      } else {
        const plainRestLexeme = element.rest.type === RestType.InvisibleMultimeasure ? "x" : "z";
        const rhythm = durationToRhythmExpr(ctx, element.duration, defaultLength) ?? undefined;
        out.push(new Rest(ctx.generateId(), synthToken(ctx, TT.REST, plainRestLexeme), rhythm ?? undefined));
      }
    } else {
      const restLexeme = element.rest.type === RestType.Invisible ? "x" : element.rest.type === RestType.Spacer ? "y" : "z";
      const rhythm = durationToRhythmExpr(ctx, element.duration, defaultLength) ?? undefined;
      out.push(new Rest(ctx.generateId(), synthToken(ctx, TT.REST, restLexeme), rhythm ?? undefined));
    }
  } else if (element.pitches && element.pitches.length === 1) {
    const pitch = element.pitches[0];
    const pitchExpr = pitchToPitchExpr(ctx, pitch);
    const rhythm = durationToRhythmExpr(ctx, element.duration, defaultLength) ?? undefined;
    const tie = pitch.startTie ? synthToken(ctx, TT.TIE, "-") : undefined;
    out.push(new Note(ctx.generateId(), pitchExpr, rhythm, tie));
  } else if (element.pitches && element.pitches.length > 1) {
    const notes = element.pitches.map((pitch) => {
      const pitchExpr = pitchToPitchExpr(ctx, pitch);
      const tie = pitch.startTie ? synthToken(ctx, TT.TIE, "-") : undefined;
      return new Note(ctx.generateId(), pitchExpr, undefined, tie);
    });
    const rhythm = durationToRhythmExpr(ctx, element.duration, defaultLength) ?? undefined;
    out.push(new Chord(ctx.generateId(), notes, rhythm ?? undefined));
  }

  for (const label of closesSlurLabels) {
    void label;
    // Only emit a closing paren when a tracked open slur actually exists:
    // if endSlur ever reports more closes than this voice has recorded
    // opens (e.g. a slur spanning a boundary this per-voice stack does not
    // capture), emitting an unconditional ')' would produce unbalanced,
    // invalid ABC text rather than just dropping the extra close marker.
    if (openSlurs.length === 0) continue;
    openSlurs.pop();
    out.push(synthToken(ctx, TT.SLUR, ")"));
  }

  return out;
}

function keySignatureToAbcString(key: KeySignature): string {
  return `${key.root}${key.acc}${key.mode}`;
}

function meterToAbcString(meter: Meter | undefined): string | null {
  if (!meter) return null;
  if (meter.type === MeterType.CommonTime) return "C";
  if (meter.type === MeterType.CutTime) return "C|";
  if (meter.type === MeterType.Specified && meter.value && meter.value.length > 0) {
    return meter.value.map((f) => `${f.numerator}/${f.denominator}`).join("+");
  }
  return null;
}

interface VoiceEntry {
  id: string;
  name?: string;
  elements: VoiceElement[];
}

/**
 * Gathers every voice's content across every system in the Tune, keyed by
 * voice id. A given voice id always writes to the same (staffNum, index)
 * slot across the whole tune (per TuneInterpreter's vxNomenclatures), so
 * concatenating that slot's content across systems in system order
 * reconstructs the voice's full continuous body. Because the Formatter does
 * not wrap lines, this concatenated form writes each voice on one line; line
 * breaks are only produced when tuneToAst receives TuneToAbcOptions, in which
 * case resolveSlices splits the voices into systems.
 */
function collectVoiceEntries(tune: Tune): VoiceEntry[] {
  const order: string[] = [];
  const byId = new Map<string, VoiceEntry>();

  for (const system of tune.systems) {
    if (!isMusicLine(system)) continue;
    const staffSystem = system as StaffSystem;
    staffSystem.staff.forEach((staff, staffIndex) => {
      staff.voices.forEach((elements, voiceIndex) => {
        const id = staff.voiceIds?.[voiceIndex] ?? `${staffIndex}-${voiceIndex}`;
        let entry = byId.get(id);
        if (!entry) {
          entry = { id, name: staff.voiceNames?.[voiceIndex], elements: [] };
          byId.set(id, entry);
          order.push(id);
        } else if (!entry.name && staff.voiceNames?.[voiceIndex]) {
          entry.name = staff.voiceNames[voiceIndex];
        }
        entry.elements.push(...elements);
      });
    });
  }

  return order.map((id) => byId.get(id)!);
}

function firstStaffOf(tune: Tune): { key: KeySignature; meter?: Meter } | null {
  for (const system of tune.systems) {
    if (!isMusicLine(system)) continue;
    const staffSystem = system as StaffSystem;
    if (staffSystem.staff.length > 0) {
      return { key: staffSystem.staff[0].key, meter: staffSystem.staff[0].meter };
    }
  }
  return null;
}

/**
 * The beam group being collected by buildVoiceBody. Because the formatter
 * only writes notes without separating spaces when they sit inside a Beam
 * expression, a flagged run of notes is gathered here and wrapped at the end.
 */
interface BeamRunContext {
  run: music_code[];
  noteCount: number;
  open: boolean;
}

/**
 * Emits the collected run: as a Beam when it holds at least two notes,
 * otherwise as plain elements, since a beam needs two notes. Resets the run.
 */
function flushBeamRun(ctx: ABCContext, beamRun: BeamRunContext, out: music_code[]): void {
  if (beamRun.noteCount >= 2) {
    out.push(new Beam(ctx.generateId(), beamRun.run as Beam_contents[]));
  } else {
    out.push(...beamRun.run);
  }
  beamRun.run = [];
  beamRun.noteCount = 0;
  beamRun.open = false;
}

/**
 * State of one voice that must survive across buildVoiceBody calls. Because
 * a slur can open in one system and close in the next, the open slurs are
 * carried from one system's call to the next.
 */
interface VoiceBodyState {
  openSlurs: OpenSlur[];
}

function buildVoiceBody(ctx: ABCContext, elements: VoiceElement[], defaultLength: IRational, state: VoiceBodyState): music_code[] {
  const out: music_code[] = [];
  const openSlurs = state.openSlurs;
  const beamRun: BeamRunContext = { run: [], noteCount: 0, open: false };
  for (const element of elements) {
    if (isBarElement(element)) {
      flushBeamRun(ctx, beamRun, out);
      const barElement = element as BarElement;
      out.push(new BarLine(ctx.generateId(), [synth_barlineToken(ctx, barElement)]));
      continue;
    }
    if (element.el_type === ElementType.Note) {
      const noteElement = element as NoteElement;
      const code = noteElementToMusicCode(ctx, noteElement, defaultLength, openSlurs);
      // Because Rest is not a valid Beam content, a rest always closes the run.
      if (noteElement.rest) {
        flushBeamRun(ctx, beamRun, out);
        out.push(...code);
        continue;
      }
      if (noteElement.startBeam) {
        flushBeamRun(ctx, beamRun, out);
        beamRun.open = true;
      }
      if (beamRun.open) {
        beamRun.run.push(...code);
        beamRun.noteCount += 1;
        if (noteElement.endBeam) flushBeamRun(ctx, beamRun, out);
      } else {
        out.push(...code);
      }
      continue;
    }
    flushBeamRun(ctx, beamRun, out);
    // Clef/Key/Meter/Tempo mid-body elements are not reconstructed as inline
    // fields in this version; the tune-level K:/M: header lines emitted from
    // the first staff's values cover the common case.
  }
  flushBeamRun(ctx, beamRun, out);
  return out;
}

function synth_barlineToken(ctx: ABCContext, _bar: BarElement): Token {
  // BarType-to-lexeme reconstruction is intentionally minimal for a first
  // version: every bar renders as a plain "|", since the common lead-sheet
  // and small-score scope this whole effort targets rarely depends on the
  // visual distinction between e.g. thin-thick and double-repeat bars
  // surviving a round trip, and getting every BarType/repeat-number
  // combination exactly right is real, separate work.
  return synthToken(ctx, TT.BARLINE, "|");
}

/**
 * How tuneToAst breaks the output into lines (systems).
 * - "source" keeps the Tune's own systems, and falls back to a fixed number
 *   of bars per line when the Tune has a single system.
 * - "fixed" always breaks every `barsPerLine` bars.
 */
export type TuneToAbcLineBreaks = { mode: "source"; fallbackBarsPerLine: number } | { mode: "fixed"; barsPerLine: number };

export interface TuneToAbcOptions {
  /** When omitted, each voice is written on a single line, as before. */
  lineBreaks?: TuneToAbcLineBreaks;
}

/** One output system: for each voice id, the elements of that voice in the system. */
interface SystemSlice {
  elementsByVoiceId: Map<string, VoiceElement[]>;
}

/** Builds one slice per music line of tune.systems, keyed by the same voice ids as collectVoiceEntries. */
function collectSystemSlices(tune: Tune): SystemSlice[] {
  const slices: SystemSlice[] = [];
  for (const system of tune.systems) {
    if (!isMusicLine(system)) continue;
    const staffSystem = system as StaffSystem;
    const elementsByVoiceId = new Map<string, VoiceElement[]>();
    staffSystem.staff.forEach((staff, staffIndex) => {
      staff.voices.forEach((elements, voiceIndex) => {
        const id = staff.voiceIds?.[voiceIndex] ?? `${staffIndex}-${voiceIndex}`;
        elementsByVoiceId.set(id, [...(elementsByVoiceId.get(id) ?? []), ...elements]);
      });
    });
    slices.push({ elementsByVoiceId });
  }
  return slices;
}

/**
 * Because the importer writes a left-repeat bar at the start of a repeated
 * measure in addition to the previous measure's closing bar, only the bars
 * that are not left repeats count as measure ends.
 */
function isClosingBar(element: VoiceElement): boolean {
  return isBarElement(element) && (element as BarElement).type !== BarType.BarLeftRepeat;
}

/** Splits a voice after every `barsPerLine`-th closing bar. A trailing chunk without a closing bar is kept. */
function chunkByBars(elements: VoiceElement[], barsPerLine: number): VoiceElement[][] {
  const chunks: VoiceElement[][] = [];
  let current: VoiceElement[] = [];
  let bars = 0;
  for (const element of elements) {
    current.push(element);
    if (isClosingBar(element)) {
      bars += 1;
      if (bars === barsPerLine) {
        chunks.push(current);
        current = [];
        bars = 0;
      }
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Chunks every voice into lines of `barsPerLine` bars. A voice with fewer
 * chunks than the others gets empty lists in the later slices, so that every
 * slice lists every voice.
 */
function sliceByFixedBars(voiceEntries: VoiceEntry[], barsPerLine: number): SystemSlice[] {
  const chunksByVoice = voiceEntries.map((voice) => chunkByBars(voice.elements, Math.max(1, barsPerLine)));
  const sliceCount = Math.max(1, ...chunksByVoice.map((chunks) => chunks.length));
  const slices: SystemSlice[] = [];
  for (let k = 0; k < sliceCount; k++) {
    const elementsByVoiceId = new Map<string, VoiceElement[]>();
    voiceEntries.forEach((voice, i) => elementsByVoiceId.set(voice.id, chunksByVoice[i][k] ?? []));
    slices.push({ elementsByVoiceId });
  }
  return slices;
}

function synthVoiceMarker(ctx: ABCContext, id: string): Info_line {
  return new Info_line(ctx.generateId(), [synthToken(ctx, TT.INF_HDR, "V:"), synthToken(ctx, TT.INFO_STR, id)]);
}

function resolveSlices(tune: Tune, voiceEntries: VoiceEntry[], lineBreaks: TuneToAbcLineBreaks): SystemSlice[] {
  if (lineBreaks.mode === "fixed") return sliceByFixedBars(voiceEntries, lineBreaks.barsPerLine);
  const slices = collectSystemSlices(tune);
  if (slices.length <= 1) return sliceByFixedBars(voiceEntries, lineBreaks.fallbackBarsPerLine);
  return slices;
}

/**
 * Converts a Tune (interpreter output) into a synthetic ABC AST (a Tune
 * Expr), reusing the existing Formatter for stringification rather than
 * writing a bespoke text serializer, per the architecture decision recorded
 * in .private/3.tune-to-abc-serializer.md.
 */
export function tuneToAst(tune: Tune, ctx: ABCContext, options?: TuneToAbcOptions): TuneExpr {
  const voiceEntries = collectVoiceEntries(tune);
  const headerLines: Info_line[] = [];

  headerLines.push(new Info_line(ctx.generateId(), [synthToken(ctx, TT.INF_HDR, "X:"), synthToken(ctx, TT.INFO_STR, "1")]));

  const title = typeof tune.metaText.title === "string" ? tune.metaText.title : undefined;
  if (title) {
    headerLines.push(new Info_line(ctx.generateId(), [synthToken(ctx, TT.INF_HDR, "T:"), synthToken(ctx, TT.INFO_STR, title)]));
  }

  const isSingleDefaultVoice = voiceEntries.length <= 1 && (voiceEntries.length === 0 || !voiceEntries[0].id);

  if (!isSingleDefaultVoice) {
    for (const voice of voiceEntries) {
      const parts = [synthToken(ctx, TT.INF_HDR, "V:"), synthToken(ctx, TT.INFO_STR, voice.id)];
      headerLines.push(new Info_line(ctx.generateId(), parts));
    }
  }

  headerLines.push(new Info_line(ctx.generateId(), [synthToken(ctx, TT.INF_HDR, "L:"), synthToken(ctx, TT.INFO_STR, "1/8")]));

  const staffDefaults = firstStaffOf(tune);
  if (staffDefaults) {
    headerLines.push(
      new Info_line(ctx.generateId(), [synthToken(ctx, TT.INF_HDR, "K:"), synthToken(ctx, TT.KEY_SIGNATURE, keySignatureToAbcString(staffDefaults.key))])
    );
    const meterStr = meterToAbcString(staffDefaults.meter);
    if (meterStr) {
      headerLines.splice(
        headerLines.length - 1,
        0,
        new Info_line(ctx.generateId(), [synthToken(ctx, TT.INF_HDR, "M:"), synthToken(ctx, TT.INFO_STR, meterStr)])
      );
    }
  } else {
    headerLines.push(new Info_line(ctx.generateId(), [synthToken(ctx, TT.INF_HDR, "K:"), synthToken(ctx, TT.KEY_SIGNATURE, "C")]));
  }

  const tuneHeader = new Tune_header(
    ctx.generateId(),
    headerLines,
    voiceEntries.map((v) => v.id)
  );

  // visitTuneBodyExpr joins each system's formatted output with an empty
  // string, relying on real EOL tokens embedded in the sequence itself to
  // produce line breaks (matching how the real parser includes the
  // newline as the trailing token of each source line). A synthetic
  // sequence has no such tokens unless explicitly inserted here.
  const eol = () => synthToken(ctx, TT.EOL, "\n");
  const bodySequence: tune_body_code[][] = [];
  if (options?.lineBreaks) {
    // Because ABC writes a multi-voice score system by system, each output
    // system holds one line per voice (deferred style), in header order.
    const states = new Map<string, VoiceBodyState>(voiceEntries.map((voice) => [voice.id, { openSlurs: [] }]));
    for (const slice of resolveSlices(tune, voiceEntries, options.lineBreaks)) {
      const system: tune_body_code[] = [];
      if (isSingleDefaultVoice) {
        if (voiceEntries.length === 1) {
          const voice = voiceEntries[0];
          system.push(...buildVoiceBody(ctx, slice.elementsByVoiceId.get(voice.id) ?? [], DEFAULT_NOTE_LENGTH, states.get(voice.id)!), eol());
        }
      } else {
        for (const voice of voiceEntries) {
          const content = buildVoiceBody(ctx, slice.elementsByVoiceId.get(voice.id) ?? [], DEFAULT_NOTE_LENGTH, states.get(voice.id)!);
          system.push(synthVoiceMarker(ctx, voice.id), eol(), ...content, eol());
        }
      }
      bodySequence.push(system);
    }
  } else if (isSingleDefaultVoice) {
    if (voiceEntries.length === 1) {
      bodySequence.push(buildVoiceBody(ctx, voiceEntries[0].elements, DEFAULT_NOTE_LENGTH, { openSlurs: [] }));
    }
  } else {
    for (const voice of voiceEntries) {
      const content = buildVoiceBody(ctx, voice.elements, DEFAULT_NOTE_LENGTH, { openSlurs: [] });
      bodySequence.push([synthVoiceMarker(ctx, voice.id), eol(), ...content, eol()]);
    }
  }

  const tuneBody = new Tune_Body(
    ctx.generateId(),
    bodySequence,
    voiceEntries.map((v) => v.id)
  );

  return new TuneExpr(ctx.generateId(), tuneHeader, tuneBody);
}

/**
 * Converts a Tune (interpreter output) into ABC source text, reusing the
 * existing Formatter for stringification. See tuneToAst for the AST
 * reconstruction itself.
 */
export function tuneToAbcText(tune: Tune, ctx: ABCContext, options?: TuneToAbcOptions): string {
  const ast = tuneToAst(tune, ctx, options);
  const formatter = new AbcFormatter(ctx);
  return formatter.format(ast);
}
