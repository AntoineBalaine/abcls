import { ChordToken, ChordTT } from "./types";

export interface ScanResult {
  tokens: ChordToken[];
  consumed: number;
}

interface ChordScanCtx {
  source: string;
  current: number;
  tokens: ChordToken[];
}

const SUPERSCRIPT_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";

/** Replaces each superscript digit of a text by the plain digit of the same value. */
function toPlainDigits(text: string): string {
  return text.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (digit) => String(SUPERSCRIPT_DIGITS.indexOf(digit)));
}

function createChordScanCtx(source: string): ChordScanCtx {
  return { source, current: 0, tokens: [] };
}

function pushToken(ctx: ChordScanCtx, type: ChordTT, lexeme: string): void {
  ctx.tokens.push({ type, lexeme });
}

function scanRoot(ctx: ChordScanCtx): boolean {
  if (ctx.current >= ctx.source.length) return false;
  const char = ctx.source[ctx.current];
  if (/^[A-Ga-g]$/.test(char)) {
    pushToken(ctx, ChordTT.ROOT, char.toUpperCase());
    ctx.current += 1;
    return true;
  }
  return false;
}

function scanAccidental(ctx: ChordScanCtx): boolean {
  if (ctx.current >= ctx.source.length) return false;
  const char = ctx.source[ctx.current];
  if (char === "#" || char === "b") {
    pushToken(ctx, ChordTT.ACCIDENTAL, char);
    ctx.current += 1;
    return true;
  }
  return false;
}

function scanQuality(ctx: ChordScanCtx): boolean {
  if (ctx.current >= ctx.source.length) return false;
  const remaining = ctx.source.substring(ctx.current);

  // Order matters: longest match first
  // sus4 and sus2 must come before sus
  // The triangles ("▵", "△" and the Greek capital delta) are the jazz symbol of the major seventh chord.
  // Because the minor chord with a major seventh is written "mM7", "mMaj7", "m^7", "-M7" and "-Maj7", these spellings come
  // before "maj", "min", "m" and "-", which would otherwise take their first letters and leave the rest unread.
  const qualities = [
    "mMaj",
    "mM",
    "m^",
    "-Maj",
    "-M",
    "Maj",
    "maj",
    "min",
    "dim",
    "aug",
    "sus4",
    "sus2",
    "sus",
    "add",
    "alt",
    "-^",
    "o^",
    "M",
    "m",
    "+",
    "-",
    "°",
    "ø",
    "Ø",
    "▵",
    "△",
    "Δ",
  ];
  for (const q of qualities) {
    if (remaining.startsWith(q)) {
      pushToken(ctx, ChordTT.QUALITY, q);
      ctx.current += q.length;
      return true;
    }
  }
  return false;
}

function scanExtension(ctx: ChordScanCtx): boolean {
  if (ctx.current >= ctx.source.length) return false;
  const remaining = ctx.source.substring(ctx.current);

  // Because lead sheets often write the seventh as a superscript ("A⁷"), we accept the superscript digits
  // and keep the token lexeme in plain digits, which is what the parser reads.
  const match = /^[0-9⁰¹²³⁴⁵⁶⁷⁸⁹]+/.exec(remaining);
  if (match) {
    pushToken(ctx, ChordTT.EXTENSION, toPlainDigits(match[0]));
    ctx.current += match[0].length;
    return true;
  }
  return false;
}

function scanAlteration(ctx: ChordScanCtx): boolean {
  if (ctx.current >= ctx.source.length) return false;
  const remaining = ctx.source.substring(ctx.current);

  // Because the degree of an alteration may also be a superscript ("C⁷b⁹"), we normalise its digits to plain ones.
  const match = /^[#b][0-9⁰¹²³⁴⁵⁶⁷⁸⁹]+/.exec(remaining);
  if (match) {
    pushToken(ctx, ChordTT.ALTERATION, toPlainDigits(match[0]));
    ctx.current += match[0].length;
    return true;
  }
  return false;
}

/** The patterns of one item inside a parenthesised group: an alteration ("b9"), an added tone ("add9"), or a major seventh marker with its optional number ("Maj7"). */
const GROUP_ALTERATION = /^[#b][0-9⁰¹²³⁴⁵⁶⁷⁸⁹]+/;
const GROUP_ADDED_TONE = /^add[0-9⁰¹²³⁴⁵⁶⁷⁸⁹]+/;
const GROUP_MAJOR_MARKER = /^(?:Maj|maj|M|▵|△|Δ)(?:[0-9⁰¹²³⁴⁵⁶⁷⁸⁹]+)?/;

/**
 * Scans a parenthesised group such as "(b9)", "(#11,b13)", "(add9)" or "(Maj7)", which surrounds the symbols that follow a quality or an extension.
 *
 * Because a group that is only partly understood would leave text that still looks like a chord, the group is read whole or not at all:
 * when any item inside it is unknown, or when the closing parenthesis is missing, we roll back and the chord ends before the opening parenthesis.
 */
function scanGroup(ctx: ChordScanCtx): boolean {
  if (ctx.source[ctx.current] !== "(") return false;
  const start = ctx.current;
  const tokenCount = ctx.tokens.length;
  pushToken(ctx, ChordTT.GROUP_OPEN, "(");
  ctx.current += 1;

  let itemCount = 0;
  while (ctx.current < ctx.source.length) {
    const remaining = ctx.source.substring(ctx.current);
    const alteration = GROUP_ALTERATION.exec(remaining);
    const addedTone = alteration === null ? GROUP_ADDED_TONE.exec(remaining) : null;
    const marker = alteration === null && addedTone === null ? GROUP_MAJOR_MARKER.exec(remaining) : null;
    if (alteration !== null) {
      pushToken(ctx, ChordTT.ALTERATION, toPlainDigits(alteration[0]));
      ctx.current += alteration[0].length;
    } else if (addedTone !== null) {
      pushToken(ctx, ChordTT.QUALITY, "add");
      pushToken(ctx, ChordTT.EXTENSION, toPlainDigits(addedTone[0].slice(3)));
      ctx.current += addedTone[0].length;
    } else if (marker !== null) {
      const digits = /[0-9⁰¹²³⁴⁵⁶⁷⁸⁹]+$/.exec(marker[0]);
      const word = digits === null ? marker[0] : marker[0].slice(0, marker[0].length - digits[0].length);
      pushToken(ctx, ChordTT.QUALITY, word);
      if (digits !== null) pushToken(ctx, ChordTT.EXTENSION, toPlainDigits(digits[0]));
      ctx.current += marker[0].length;
    } else {
      break;
    }
    itemCount += 1;

    if (ctx.source[ctx.current] === ",") {
      ctx.current += 1;
      continue;
    }
    if (ctx.source[ctx.current] === ")") {
      pushToken(ctx, ChordTT.GROUP_CLOSE, ")");
      ctx.current += 1;
      return itemCount > 0;
    }
    break;
  }

  ctx.tokens.length = tokenCount;
  ctx.current = start;
  return false;
}

function scanBass(ctx: ChordScanCtx): boolean {
  if (ctx.current >= ctx.source.length) return false;
  if (ctx.source[ctx.current] !== "/") return false;

  pushToken(ctx, ChordTT.BASS_SLASH, "/");
  ctx.current += 1;

  // Bass root (required after slash)
  if (!scanRoot(ctx)) {
    // Invalid: slash without bass root. Roll back the slash token.
    ctx.tokens.pop();
    ctx.current -= 1;
    return false;
  }

  // Bass accidental (optional)
  scanAccidental(ctx);

  return true;
}

/**
 * Scans a chord symbol string into tokens.
 * Returns null if the input does not start with a valid chord root,
 * or a ScanResult with tokens and consumed length if successful.
 */
export function scanChordSymbol(input: string): ScanResult | null {
  if (!input || input.length === 0) return null;

  const ctx = createChordScanCtx(input);

  // 1. Root (required)
  if (!scanRoot(ctx)) return null;

  // 2. Root accidental (optional)
  scanAccidental(ctx);

  // 3. Quality (optional)
  scanQuality(ctx);

  // 4. Extension number (optional)
  scanExtension(ctx);

  // 5. Alterations and parenthesised groups (optional, repeatable)
  while (scanAlteration(ctx) || scanGroup(ctx)) {
    // continue scanning alterations and parenthesised groups
  }

  // 6. Bass note (optional)
  scanBass(ctx);

  return { tokens: ctx.tokens, consumed: ctx.current };
}

/**
 * Returns whether the whole text reads as a chord symbol, and not only its beginning.
 *
 * Because scanChordSymbol stops after the longest prefix that reads as a chord, a text annotation such as "Fine",
 * "Coda" or "Allegro" scans as F, C or A. A caller that reads annotations as chords must therefore check this function
 * first, so that only a text that reads as a chord to its end counts as one.
 */
export function isChordSymbolText(text: string): boolean {
  const scanned = scanChordSymbol(text);
  return scanned !== null && scanned.consumed === text.length;
}
