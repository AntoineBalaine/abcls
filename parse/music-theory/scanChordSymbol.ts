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
  const qualities = ["maj", "min", "dim", "aug", "sus4", "sus2", "sus", "add", "alt", "M", "m", "+", "-", "°", "ø", "Ø"];
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

  const match = /^[0-9]+/.exec(remaining);
  if (match) {
    pushToken(ctx, ChordTT.EXTENSION, match[0]);
    ctx.current += match[0].length;
    return true;
  }
  return false;
}

function scanAlteration(ctx: ChordScanCtx): boolean {
  if (ctx.current >= ctx.source.length) return false;
  const remaining = ctx.source.substring(ctx.current);

  const match = /^[#b][0-9]+/.exec(remaining);
  if (match) {
    pushToken(ctx, ChordTT.ALTERATION, match[0]);
    ctx.current += match[0].length;
    return true;
  }
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

  // 5. Alterations (optional, repeatable)
  while (scanAlteration(ctx)) {
    // continue scanning alterations
  }

  // 6. Bass note (optional)
  scanBass(ctx);

  return { tokens: ctx.tokens, consumed: ctx.current };
}
