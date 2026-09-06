import { ABCContext } from "./parsers/Context";
import { Token, TT } from "./parsers/scan";
import {
  BarLine,
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
import { AbcFormatter } from "./Visitors/Formatter";
import { createRational, divideRational, IRational, rationalToRhythmExpr } from "./Visitors/fmt/rational";
import {
  AccidentalType,
  BarElement,
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
 * reconstructs the voice's full continuous body. This also means the
 * output does not preserve the original line-break positions from
 * tune.systems, which is intentional: the plan this implements treats line
 * breaks as a rendering concern the Formatter's own line-wrapping decides,
 * not something reconstruction needs to reproduce.
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

function buildVoiceBody(ctx: ABCContext, elements: VoiceElement[], defaultLength: IRational): music_code[] {
  const out: music_code[] = [];
  const openSlurs: OpenSlur[] = [];
  for (const element of elements) {
    if (isBarElement(element)) {
      const barElement = element as BarElement;
      out.push(new BarLine(ctx.generateId(), [synth_barlineToken(ctx, barElement)]));
      continue;
    }
    if (element.el_type === ElementType.Note) {
      out.push(...noteElementToMusicCode(ctx, element as NoteElement, defaultLength, openSlurs));
    }
    // Clef/Key/Meter/Tempo mid-body elements are not reconstructed as inline
    // fields in this version; the tune-level K:/M: header lines emitted from
    // the first staff's values cover the common case.
  }
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
 * Converts a Tune (interpreter output) into a synthetic ABC AST (a Tune
 * Expr), reusing the existing Formatter for stringification rather than
 * writing a bespoke text serializer, per the architecture decision recorded
 * in .private/3.tune-to-abc-serializer.md.
 */
export function tuneToAst(tune: Tune, ctx: ABCContext): TuneExpr {
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
  if (isSingleDefaultVoice) {
    if (voiceEntries.length === 1) {
      bodySequence.push(buildVoiceBody(ctx, voiceEntries[0].elements, DEFAULT_NOTE_LENGTH));
    }
  } else {
    for (const voice of voiceEntries) {
      const marker = new Info_line(ctx.generateId(), [synthToken(ctx, TT.INF_HDR, "V:"), synthToken(ctx, TT.INFO_STR, voice.id)]);
      const content = buildVoiceBody(ctx, voice.elements, DEFAULT_NOTE_LENGTH);
      bodySequence.push([marker, eol(), ...content, eol()]);
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
export function tuneToAbcText(tune: Tune, ctx: ABCContext): string {
  const ast = tuneToAst(tune, ctx);
  const formatter = new AbcFormatter(ctx);
  return formatter.format(ast);
}
