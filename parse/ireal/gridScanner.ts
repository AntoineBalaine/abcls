import { ABCContext } from "../parsers/Context";
import { Token, TT } from "../parsers/scan";
import { ParserErrorType } from "../types/types";
import { GridToken, GridTT } from "./gridTokens";

/**
 * Scanner for iReal Pro chord-grid text, as produced by `unscramble` in
 * `scramble.ts`.
 *
 * Because the previous cell splitter in `gridNotation.ts` discarded any
 * cell it could not classify, musical content went missing with no trace
 * of it anywhere; this scanner instead guarantees that every character of
 * the source belongs to exactly one token, and that a character no rule
 * recognizes becomes a `GridTT.UNKNOWN` token plus an error reporter
 * entry rather than a deletion. Concatenating the lexemes of the returned
 * stream reproduces the source exactly, which is the invariant the
 * property tests in `gridScanner.pbt.spec.ts` assert.
 *
 * The grammar implemented here is documented in
 * `plans/2.ireal-grid-lexer-parser.md` section 4, measured against a real
 * library of 657 charts.
 */

/**
 * The characters a chord's quality, extension and alteration run may use,
 * once the root letter and its accidental have been consumed. Every one of
 * them is either a quality symbol (`-` minor, `^` major seventh, `o`
 * diminished, `h` half-diminished, `+` augmented), an alteration sign, or
 * an extension digit. No root letter is in this set, so a greedy run can
 * never reach into a following chord cell.
 */
const CHORD_TAIL_CHARACTERS = "-^oh+#b0123456789";

/** The multi-letter words a chord's tail may carry: `G7sus`, `C7alt`, `Cadd9`. */
const CHORD_TAIL_WORDS = ["sus", "alt", "add"];

/**
 * Single characters that stand for themselves, tried only after every
 * longer rule has failed. `S`, `Q` and `U` are listed here rather than
 * deleted by a whole-string pass, which is what used to destroy section
 * labels built on the same letters.
 */
const SINGLE_CHARACTER_RULES: Array<[string, GridTT]> = [
  ["|", GridTT.BAR],
  ["[", GridTT.SECTION_OPEN],
  ["]", GridTT.SECTION_CLOSE],
  ["{", GridTT.REPEAT_OPEN],
  ["}", GridTT.REPEAT_CLOSE],
  ["n", GridTT.NO_CHORD],
  ["x", GridTT.REPEAT_ONE_BAR],
  ["r", GridTT.REPEAT_TWO_BARS],
  ["p", GridTT.SAME_CHORD],
  [",", GridTT.PAD],
  ["Z", GridTT.END],
  ["S", GridTT.SEGNO],
  ["Q", GridTT.CODA],
  ["U", GridTT.PART_MARKER],
  ["f", GridTT.FERMATA],
  ["s", GridTT.SMALL],
  ["l", GridTT.LAYOUT],
  ["Y", GridTT.SPACER],
];

const ROOT_LETTERS = "ABCDEFG";
const ACCIDENTALS = "#b";
const DIGITS = "0123456789";

function isRoot(c: string | undefined): boolean {
  return c !== undefined && ROOT_LETTERS.includes(c);
}

function isDigit(c: string | undefined): boolean {
  return c !== undefined && DIGITS.includes(c);
}

/**
 * Returns the length of the chord lexeme starting at `start`, or 0 when no
 * chord starts there.
 *
 * The tail is consumed greedily so that a combined quality symbol stays in
 * one lexeme: `C-^7` yields a single token rather than a minor chord
 * followed by a stray `^`, and `C7sus` keeps its `s` instead of leaving it
 * to be taken for the cue-size marker.
 */
function chordLength(source: string, start: number): number {
  if (!isRoot(source[start])) return 0;
  let i = start + 1;
  if (source[i] !== undefined && ACCIDENTALS.includes(source[i])) i++;
  for (;;) {
    const c = source[i];
    if (c !== undefined && CHORD_TAIL_CHARACTERS.includes(c)) {
      i++;
      continue;
    }
    const word = CHORD_TAIL_WORDS.find((w) => source.startsWith(w, i));
    if (word !== undefined) {
      i += word.length;
      continue;
    }
    break;
  }
  // A slash bass is part of the chord, but only when a root letter
  // actually follows the slash; a dangling `/` belongs to whatever comes
  // next and must not be swallowed here.
  if (source[i] === "/" && isRoot(source[i + 1])) {
    i += 2;
    if (source[i] !== undefined && ACCIDENTALS.includes(source[i])) i++;
  }
  return i - start;
}

/**
 * Describes a delimited run starting at `start`, or `null` when `open` is
 * not the character there.
 *
 * A bar separator bounds the search for the closing delimiter, because no
 * annotation and no alternative chord in the sample library contains one
 * (0 of 168 annotations do). Without that bound a single stray `<` or `(`
 * would absorb every remaining bar of the chart into one token, putting
 * the whole tail of the chart out of the parser's reach; with it, a stray
 * delimiter costs at most the bar it sits in. The run is still consumed
 * rather than refused, which is what keeps total coverage: the caller
 * reports the missing delimiter instead of dropping the text.
 */
function delimitedRun(source: string, start: number, open: string, close: string): { length: number; closed: boolean } | null {
  if (source[start] !== open) return null;
  let limit = source.indexOf("|", start + 1);
  if (limit === -1) limit = source.length;
  const end = source.indexOf(close, start + 1);
  if (end !== -1 && end < limit) return { length: end + 1 - start, closed: true };
  return { length: limit - start, closed: false };
}

function whitespaceLength(source: string, start: number): number {
  let i = start;
  while (i < source.length && /\s/.test(source[i])) i++;
  return i - start;
}

/**
 * Reports a grid token through the shared error reporter.
 *
 * `Token.position` is line relative everywhere else in this codebase, and
 * the absolute offset is used here instead; the two are the same number
 * because grid text holds no line break at all (0 of the 657 charts in the
 * sample library contain a newline or a tab), which is also why `line`
 * stays at the 0 the `Token` constructor's string branch gives it.
 */
function report(ctx: ABCContext, message: string, token: GridToken): void {
  const reported = new Token(TT.INVALID, token.lexeme, ctx.generateId());
  reported.position = token.position;
  ctx.errorReporter.report(message, reported, ParserErrorType.SCANNER);
}

/**
 * Describes the match a rule made at the cursor. A rule returns `null` when
 * it does not apply.
 */
type Match = { type: GridTT; length: number; error?: string } | null;

/**
 * The rules, in the order they are tried. The order is load bearing, and
 * each of these orderings has already caused a defect once:
 *
 * - The annotation rule runs before everything else that could read inside
 *   `<...>`, so an annotation's own text, including its `*nn` size code and
 *   any non-ASCII, is never scanned as grid content.
 * - `N` followed by a digit is tried before the single character rules, so
 *   an ending marker is not read as a chord-less letter.
 * - `T` followed by two digits is tried before anything else that could
 *   consume `T`.
 * - A section label, `*` followed by one word character, is tried before
 *   the single character rules.
 * - The chord rule is tried before the single character decoration rules,
 *   so the `s` of `C7sus` and the `l` of `C7alt` stay inside their chord.
 */
const RULES: Array<(source: string, cursor: number) => Match> = [
  (source, cursor) => {
    const length = whitespaceLength(source, cursor);
    return length > 0 ? { type: GridTT.WHITESPACE, length } : null;
  },
  (source, cursor) => {
    const run = delimitedRun(source, cursor, "<", ">");
    if (!run) return null;
    return { type: GridTT.ANNOTATION, length: run.length, error: run.closed ? undefined : "Unterminated annotation: no closing '>' before the next bar separator" };
  },
  (source, cursor) => {
    const run = delimitedRun(source, cursor, "(", ")");
    if (!run) return null;
    return { type: GridTT.ALTERNATIVE_CHORD, length: run.length, error: run.closed ? undefined : "Unterminated alternative chord: no closing ')' before the next bar separator" };
  },
  (source, cursor) => {
    if (source[cursor] !== "N") return null;
    let i = cursor + 1;
    while (isDigit(source[i])) i++;
    return i > cursor + 1 ? { type: GridTT.ENDING, length: i - cursor } : null;
  },
  (source, cursor) => {
    if (source[cursor] !== "T" || !isDigit(source[cursor + 1]) || !isDigit(source[cursor + 2])) return null;
    return { type: GridTT.TIME_SIGNATURE, length: 3 };
  },
  (source, cursor) => {
    if (source[cursor] !== "*" || source[cursor + 1] === undefined || !/\w/.test(source[cursor + 1])) return null;
    return { type: GridTT.SECTION_LABEL, length: 2 };
  },
  (source, cursor) => {
    const length = chordLength(source, cursor);
    return length > 0 ? { type: GridTT.CHORD, length } : null;
  },
  (source, cursor) => {
    for (const [lexeme, type] of SINGLE_CHARACTER_RULES) {
      if (source[cursor] === lexeme) return { type, length: 1 };
    }
    return null;
  },
];

export function scanGrid(source: string, ctx: ABCContext): GridToken[] {
  const tokens: GridToken[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    let matched: Match = null;
    for (const rule of RULES) {
      matched = rule(source, cursor);
      if (matched) break;
    }
    if (matched) {
      const token: GridToken = { type: matched.type, lexeme: source.slice(cursor, cursor + matched.length), position: cursor };
      tokens.push(token);
      if (matched.error !== undefined) report(ctx, matched.error, token);
      cursor += matched.length;
      continue;
    }
    const unknown: GridToken = { type: GridTT.UNKNOWN, lexeme: source[cursor], position: cursor };
    tokens.push(unknown);
    report(ctx, `Unrecognized character in iReal Pro grid text: '${unknown.lexeme}'`, unknown);
    cursor += 1;
  }
  return tokens;
}
