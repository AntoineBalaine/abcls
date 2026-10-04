/**
 * Token types for iReal Pro chord-grid text.
 *
 * These are kept separate from the main `TT` enumeration in
 * `../parsers/scan` because the grid language is iReal Pro's own, not
 * ABC's, and its tokens are consumed only by `gridScanner.ts` and the
 * grid parser; they mirror the shape of `ChordTT` and `ChordToken` in
 * `../music-theory/types`, which is the closest existing precedent for a
 * small token set local to one module.
 */
export enum GridTT {
  /** A chord cell in iReal Pro's dialect, e.g. `C-7`, `C^7`, `Ch7`, `C-^7`, `C7alt`, `C-7/F`. */
  CHORD = "GRID_CHORD",
  /** `n`, no chord, rendered N.C. */
  NO_CHORD = "GRID_NO_CHORD",
  /** `x`, this bar holds the same content as the previous bar. */
  REPEAT_ONE_BAR = "GRID_REPEAT_ONE_BAR",
  /** `r`, this bar holds the same content as the previous two bars. */
  REPEAT_TWO_BARS = "GRID_REPEAT_TWO_BARS",
  /** `p`, this cell holds the same chord as the previous cell. */
  SAME_CHORD = "GRID_SAME_CHORD",
  /**
   * `W/C`, this cell holds the same chord as the previous cell over the
   * bass that follows the slash. A sibling of `SAME_CHORD`, differing only
   * in carrying an explicit bass; see `gridScanner.ts`'s rule for the
   * evidence behind that reading.
   */
  SAME_CHORD_WITH_BASS = "GRID_SAME_CHORD_WITH_BASS",
  /** `|`, a bar separator. */
  BAR = "GRID_BAR",
  /** `[`, a section opening. */
  SECTION_OPEN = "GRID_SECTION_OPEN",
  /** `]`, a section closing. */
  SECTION_CLOSE = "GRID_SECTION_CLOSE",
  /** `{`, a repeated section opening. */
  REPEAT_OPEN = "GRID_REPEAT_OPEN",
  /** `}`, a repeated section closing. */
  REPEAT_CLOSE = "GRID_REPEAT_CLOSE",
  /** `N1`, `N2` and further numbered markers introducing an ending. */
  ENDING = "GRID_ENDING",
  /** `*A`, `*B`, `*C`, `*D`, `*i`, `*v`, a section label. */
  SECTION_LABEL = "GRID_SECTION_LABEL",
  /** `T44`, a time signature written as two digits after `T`. */
  TIME_SIGNATURE = "GRID_TIME_SIGNATURE",
  /** `<...>`, a text annotation, consumed whole including its delimiters. */
  ANNOTATION = "GRID_ANNOTATION",
  /** `(...)`, an alternative chord, consumed whole including its delimiters. */
  ALTERNATIVE_CHORD = "GRID_ALTERNATIVE_CHORD",
  /** `S`, a segno. */
  SEGNO = "GRID_SEGNO",
  /** `Q`, a coda. */
  CODA = "GRID_CODA",
  /** `U`, a part marker. */
  PART_MARKER = "GRID_PART_MARKER",
  /** `f`, a fermata over the cell that follows. */
  FERMATA = "GRID_FERMATA",
  /** `s`, the chord that follows is drawn cue sized. */
  SMALL = "GRID_SMALL",
  /** `l`, a layout hint carrying no musical meaning. */
  LAYOUT = "GRID_LAYOUT",
  /** `Y`, vertical spacing carrying no musical meaning. */
  SPACER = "GRID_SPACER",
  /** `,`, padding marking a held chord and carrying no further meaning. */
  PAD = "GRID_PAD",
  /** `Z`, the end of the chart. */
  END = "GRID_END",
  /** A run of one or more whitespace characters. */
  WHITESPACE = "GRID_WHITESPACE",
  /**
   * A single character no rule recognized. Carrying it as a token rather
   * than discarding it is what makes content loss a detectable condition:
   * see the total coverage property in `gridScanner.pbt.spec.ts`.
   */
  UNKNOWN = "GRID_UNKNOWN",
}

/**
 * One token of grid text. `position` is the offset of the token's first
 * character in the source string handed to `scanGrid`, so that every
 * token can be reported on and the whole stream can be checked for
 * covering the input exactly.
 */
export interface GridToken {
  type: GridTT;
  lexeme: string;
  position: number;
}

/** Rebuilds the exact source text a token stream was scanned from. */
export function tokensToGridText(tokens: GridToken[]): string {
  let text = "";
  for (const token of tokens) {
    text += token.lexeme;
  }
  return text;
}
