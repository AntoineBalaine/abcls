/**
 * Voice Filter Visitor
 *
 * Filters voices from ABC AST based on %%abcls-voices show/hide directives.
 * Similar to AbcxToAbcConverter, this operates on the AST and returns a filtered AST.
 *
 * Architecture:
 *   1. VoiceFilterCollector: Traverses AST to collect %%abcls-voices directives and determine filter state
 *   2. VoiceFilterVisitor: Filters the AST based on collected filter state
 *   3. filterVoiceInAst: Main entry point that runs both passes
 *
 * Scoping rules:
 *   - File header directives → default filter for all tunes
 *   - Tune header directives → override for that specific tune
 *   - "Last wins" within each scope
 *
 * Filter behavior:
 *   - mode: "show" → only include specified voices
 *   - mode: "hide" → exclude specified voices
 *   - mode: null → no filtering (pass through all)
 */

import { analyzeDirective } from "../analyzers/directive-analyzer";
import { SemanticAnalyzer } from "../analyzers/semantic-analyzer";
import { isToken } from "../helpers";
import { ABCContext } from "../parsers/Context";
import { parse } from "../parsers/parse";
import { Token } from "../parsers/scan";
import { Scanner, TT } from "../parsers/scan";
import { AbclsVoicesDirectiveData } from "../types/directive-specs";
import {
  Directive,
  Expr,
  File_header,
  File_structure,
  Info_line,
  Inline_field,
  Tune,
  Tune_Body,
  Tune_header,
  tune_body_code,
  Voice_overlay,
  System,
} from "../types/Expr";
import { AbcFormatter } from "./Formatter";
import { applyDeletions, joinRangesAcrossBlanks, lineColumnToOffset, lineStartOffsets, mergeOffsetRanges, OffsetRange } from "./OffsetDeletionMap";
import { filterScoreDirective } from "./ScoreDirectiveFilter";

/**
 * The directives whose text is printed on the score between the systems, whatever the voice that comes before them.
 */
const SCORE_LEVEL_DIRECTIVES = new Set(["text", "center", "begintext"]);

/** The directives that lay the voices out on staves, and so name voices. */
const STAFF_LAYOUT_DIRECTIVES = new Set(["score", "staves"]);

/**
 * Tells whether an element of the tune body belongs to the score and not to a voice.
 *
 * Because a part label (`P:`) and the text that is printed between the systems (`%%text`, `%%center` and
 * `%%begintext`) are not music of a voice, the voice that happens to come before them must not hide them.
 */
export function isScoreLevelElement(element: tune_body_code): boolean {
  if (element instanceof Info_line) {
    return element.key.lexeme === "P:";
  }
  if (element instanceof Directive) {
    return SCORE_LEVEL_DIRECTIVES.has(element.key.lexeme.toLowerCase());
  }
  return false;
}

/**
 * Filter state for a single scope (file or tune)
 */
export interface VoiceFilterState {
  mode: "show" | "hide" | null;
  voiceIds: Set<string>;
}

/**
 * Context containing filter states for file and per-tune overrides
 */
export interface FilterContext {
  fileDefault: VoiceFilterState;
  tuneOverrides: Map<number, VoiceFilterState>;
}

/**
 * Creates an empty filter state (no filtering)
 */
function createEmptyFilterState(): VoiceFilterState {
  return { mode: null, voiceIds: new Set() };
}

/**
 * Determines if a voice is included based on filter state
 */
function voiceIsIncluded(voiceId: string, state: VoiceFilterState): boolean {
  if (state.mode === null) {
    return true;
  }
  if (state.mode === "show") {
    return state.voiceIds.has(voiceId);
  }
  if (state.mode === "hide") {
    return !state.voiceIds.has(voiceId);
  }
  return true;
}

/**
 * Extracts voice ID from a V: info line or [V:id] inline field
 *
 * For Info_line V:melody clef=treble, the structure is:
 *   key: "V:", value: ["melody", "clef=treble"]
 *
 * For Inline_field [V:melody], the structure is:
 *   field: "V:", text: ["V:", "melody"]
 *   (note: text[0] duplicates the field key)
 */
export function extractVoiceIdFromMarker(line: Info_line | Inline_field): string | null {
  if (line instanceof Info_line) {
    const key = line.key.lexeme.trim().toUpperCase();
    if (key === "V:") {
      // Voice ID is the first token in the value array
      if (line.value.length > 0) {
        return line.value[0].lexeme.trim();
      }
    }
  } else if (line instanceof Inline_field) {
    const key = line.field.lexeme.trim().toUpperCase();
    if (key === "V:") {
      // Because text[0] duplicates the field key "V:", we start at index 1
      if (line.text.length > 1) {
        return line.text[1].lexeme.trim();
      } else if (line.text.length === 1) {
        // Handle case where text only has the ID (different parser versions)
        const firstToken = line.text[0].lexeme.trim();
        // If it's the V: key, there's no voice ID
        if (firstToken.toUpperCase() === "V:" || firstToken.toUpperCase() === "V") {
          return null;
        }
        return firstToken;
      }
    }
  }
  return null;
}

/**
 * Checks if a directive is an abcls-voices directive and extracts its data
 */
function extractAbclsVoicesData(directive: Directive, analyzer: SemanticAnalyzer): AbclsVoicesDirectiveData | null {
  if (directive.key.lexeme.toLowerCase() !== "abcls-voices") {
    return null;
  }
  const result = analyzeDirective(directive, analyzer);
  if (result && result.type === "abcls-voices") {
    return result.data as AbclsVoicesDirectiveData;
  }
  return null;
}

/**
 * Pass 1: Collects %%abcls-voices directives from the AST and builds FilterContext
 */
export class VoiceFilterCollector {
  context: ABCContext;
  analyzer: SemanticAnalyzer;
  filterContext: FilterContext;

  constructor(context: ABCContext) {
    this.context = context;
    this.analyzer = new SemanticAnalyzer(context);
    this.filterContext = {
      fileDefault: createEmptyFilterState(),
      tuneOverrides: new Map(),
    };
  }

  collect(ast: File_structure): FilterContext {
    // Collect from file header
    if (ast.file_header) {
      this.collectFromFileHeader(ast.file_header);
    }

    // Collect from each tune
    for (let i = 0; i < ast.contents.length; i++) {
      const item = ast.contents[i];
      if (item instanceof Tune) {
        this.collectFromTune(item, i);
      }
    }

    return this.filterContext;
  }

  collectFromFileHeader(header: File_header): void {
    for (const item of header.contents) {
      if (item instanceof Directive) {
        const data = extractAbclsVoicesData(item, this.analyzer);
        if (data) {
          // "Last wins" - overwrite any previous file-level directive
          this.filterContext.fileDefault = {
            mode: data.mode,
            voiceIds: new Set(data.voiceIds),
          };
        }
      }
    }
  }

  collectFromTune(tune: Tune, tuneIndex: number): void {
    let tuneState: VoiceFilterState | null = null;

    // Collect from tune header
    for (const item of tune.tune_header.info_lines) {
      if (item instanceof Directive) {
        const data = extractAbclsVoicesData(item, this.analyzer);
        if (data) {
          // "Last wins" - overwrite any previous tune-level directive
          tuneState = {
            mode: data.mode,
            voiceIds: new Set(data.voiceIds),
          };
        }
      }
    }

    if (tuneState) {
      this.filterContext.tuneOverrides.set(tuneIndex, tuneState);
    }
  }
}

/**
 * Pass 2: Filters the AST based on collected FilterContext
 */
export class VoiceFilterVisitor {
  context: ABCContext;
  filterContext: FilterContext;
  /**
   * Because the preview needs to convert offsets of the filtered text back to the original text,
   * every node that the filter drops is recorded here, in the order in which it was visited.
   */
  removedNodes: Array<Expr | Token> = [];
  /**
   * The tokens that were taken out of a %%score or %%staves directive that stays. Because such a token is one of several
   * on its line, the blanks that follow it are removed with it, so that the directive does not keep stray spaces.
   */
  layoutTokens: Set<Token> = new Set();

  constructor(context: ABCContext, filterContext: FilterContext) {
    this.context = context;
    this.filterContext = filterContext;
  }

  filter(ast: File_structure): File_structure {
    // Filter file header
    const filteredFileHeader = ast.file_header ? this.filterFileHeader(ast.file_header) : null;

    // Filter tunes
    const filteredContents: Array<Tune | Token> = [];
    for (let i = 0; i < ast.contents.length; i++) {
      const item = ast.contents[i];
      if (item instanceof Tune) {
        filteredContents.push(this.filterTune(item, i));
      } else {
        filteredContents.push(item);
      }
    }

    return new File_structure(this.context.generateId(), filteredFileHeader, filteredContents, ast.linear, structuredClone(ast.formatterConfig));
  }

  getFilterState(tuneIndex: number): VoiceFilterState {
    // Tune override takes precedence over file default
    const tuneOverride = this.filterContext.tuneOverrides.get(tuneIndex);
    if (tuneOverride) {
      return tuneOverride;
    }
    return this.filterContext.fileDefault;
  }

  /**
   * Takes the hidden voices out of a %%score or %%staves directive.
   *
   * Because the directive names the voices that make the staves, a name that the filter removed made abcjs fail on
   * the first staff and the preview showed nothing new. The groups that hold no voice any more go as well.
   * Returns the directive itself when nothing changes, a new directive without the hidden voices, or null when no voice stays.
   */
  filterLayoutDirective(directive: Directive, filterState: VoiceFilterState): Directive | null {
    if (filterState.mode === null || !STAFF_LAYOUT_DIRECTIVES.has(directive.key.lexeme.toLowerCase())) {
      return directive;
    }
    const result = filterScoreDirective(directive.values, (voiceId) => !voiceIsIncluded(voiceId, filterState));
    if (result === null || result.removed.length === 0) {
      return directive;
    }
    if (result.allRemoved) {
      this.removedNodes.push(directive);
      return null;
    }
    for (const token of result.removed) {
      this.removedNodes.push(token);
      this.layoutTokens.add(token);
    }
    return new Directive(this.context.generateId(), directive.key, result.kept);
  }

  filterFileHeader(header: File_header): File_header {
    // Remove %%abcls-voices directives from file header
    const filteredContents: typeof header.contents = [];
    for (const item of header.contents) {
      if (item instanceof Directive && item.key.lexeme.toLowerCase() === "abcls-voices") {
        this.removedNodes.push(item);
        continue;
      }
      if (item instanceof Directive) {
        // Because the file header applies to every tune, its layout directive follows the filter of the file.
        const layout = this.filterLayoutDirective(item, this.filterContext.fileDefault);
        if (layout !== null) filteredContents.push(layout);
        continue;
      }
      filteredContents.push(item);
    }

    return new File_header(this.context.generateId(), filteredContents);
  }

  filterTune(tune: Tune, tuneIndex: number): Tune {
    const filterState = this.getFilterState(tuneIndex);

    // Filter tune header
    const filteredHeader = this.filterTuneHeader(tune.tune_header, filterState);

    // Filter tune body
    const filteredBody = tune.tune_body ? this.filterTuneBody(tune.tune_body, filterState) : undefined;

    return new Tune(this.context.generateId(), filteredHeader, filteredBody || null, tune.linear, { ...tune.formatterConfig });
  }

  filterTuneHeader(header: Tune_header, filterState: VoiceFilterState): Tune_header {
    // If no filtering, still remove %%abcls-voices directives
    const filteredInfoLines: typeof header.info_lines = [];

    for (const item of header.info_lines) {
      // Remove %%abcls-voices directives
      if (item instanceof Directive && item.key.lexeme.toLowerCase() === "abcls-voices") {
        this.removedNodes.push(item);
        continue;
      }

      // Take the hidden voices out of the %%score and %%staves directives
      if (item instanceof Directive) {
        const layout = this.filterLayoutDirective(item, filterState);
        if (layout !== null) filteredInfoLines.push(layout);
        continue;
      }

      // Filter V: info lines based on voice filter state
      if (item instanceof Info_line) {
        const voiceId = extractVoiceIdFromMarker(item);
        if (voiceId !== null) {
          if (!voiceIsIncluded(voiceId, filterState)) {
            this.removedNodes.push(item);
            continue;
          }
        }
      }

      filteredInfoLines.push(item);
    }

    // Update voices array to only include filtered voices
    const filteredVoices = header.voices.filter((voiceId) => voiceIsIncluded(voiceId, filterState));

    return new Tune_header(this.context.generateId(), filteredInfoLines, filteredVoices);
  }

  filterTuneBody(body: Tune_Body, filterState: VoiceFilterState): Tune_Body {
    // If no filtering, return body as-is
    if (filterState.mode === null) {
      return body;
    }

    const filteredSequence: System[] = [];

    // Because we need to track the current voice state while processing the body,
    // we use an empty string for content before any explicit voice switch.
    // This means that when using "show" mode, content before any V: or [V:] will be
    // filtered out unless "" is in the voice list (which it won't be).
    // The state must carry across systems because a V: declaration in one system
    // applies to content in subsequent systems until another V: is encountered.
    let currentVoice: string = "";
    let currentVoiceIncluded = voiceIsIncluded(currentVoice, filterState);

    for (const system of body.sequence) {
      const result = this.filterSystem(system, filterState, currentVoice, currentVoiceIncluded);
      currentVoice = result.currentVoice;
      currentVoiceIncluded = result.currentVoiceIncluded;
      // Only add non-empty systems
      if (result.filteredElements.length > 0) {
        filteredSequence.push(result.filteredElements);
      }
    }

    // Filter voices list to match filtered content
    const filteredVoices = body.voices.filter((voiceId) => voiceIsIncluded(voiceId, filterState));

    return new Tune_Body(this.context.generateId(), filteredSequence, filteredVoices);
  }

  filterSystem(
    system: System,
    filterState: VoiceFilterState,
    currentVoice: string,
    currentVoiceIncluded: boolean
  ): { filteredElements: System; currentVoice: string; currentVoiceIncluded: boolean } {
    const filteredElements: tune_body_code[] = [];
    // Because a score-level element ends its line with a newline token of its own, we keep that newline with it.
    let keepLineEnd = false;

    for (const element of system) {
      if (isScoreLevelElement(element)) {
        filteredElements.push(element);
        keepLineEnd = true;
        continue;
      }
      if (keepLineEnd) {
        keepLineEnd = false;
        if (isToken(element) && element.type === TT.EOL) {
          filteredElements.push(element);
          continue;
        }
      }

      // Check for voice switches
      if (element instanceof Info_line) {
        const voiceId = extractVoiceIdFromMarker(element);
        if (voiceId !== null) {
          currentVoice = voiceId;
          currentVoiceIncluded = voiceIsIncluded(currentVoice, filterState);
          // Include the V: line only if the voice is included
          if (currentVoiceIncluded) {
            filteredElements.push(element);
          } else {
            this.removedNodes.push(element);
          }
          continue;
        }
      }

      // Check for inline voice field [V:id]
      if (element instanceof Inline_field) {
        const voiceId = extractVoiceIdFromMarker(element);
        if (voiceId !== null) {
          currentVoice = voiceId;
          currentVoiceIncluded = voiceIsIncluded(currentVoice, filterState);
          // Include the inline field only if the voice is included
          if (currentVoiceIncluded) {
            filteredElements.push(element);
          } else {
            this.removedNodes.push(element);
          }
          continue;
        }
      }

      // Handle voice overlays: remove if parent voice is excluded
      if (element instanceof Voice_overlay) {
        if (currentVoiceIncluded) {
          filteredElements.push(element);
        } else {
          this.removedNodes.push(element);
        }
        continue;
      }

      // Include other elements only if current voice is included
      if (currentVoiceIncluded) {
        filteredElements.push(element);
      } else {
        this.removedNodes.push(element);
      }
    }

    return { filteredElements, currentVoice, currentVoiceIncluded };
  }
}

/**
 * Main entry point: filters voices from ABC AST based on %%abcls-voices directives
 *
 * @param ast The ABC file AST
 * @param context The ABC context for generating new node IDs
 * @returns A new AST with voices filtered according to %%abcls-voices directives
 */
export function filterVoiceInAst(ast: File_structure, context: ABCContext): File_structure {
  // Pass 1: Collect directives and build filter context
  const collector = new VoiceFilterCollector(context);
  const filterContext = collector.collect(ast);

  // Pass 2: Filter the AST (will also remove %%abcls-voices directives regardless of filtering mode)
  const visitor = new VoiceFilterVisitor(context, filterContext);
  return visitor.filter(ast);
}

/**
 * The result of filtering an ABC string, with the deletions that turn the original text into the filtered text.
 */
export interface FilteredAbc {
  /** The original text without the hidden voices. It is never printed again, so every character of it comes from the original text. */
  text: string;
  /** The ranges of the original text that were removed, merged and in order. */
  deletions: OffsetRange[];
}

/**
 * Collects the tokens that a node holds, at any depth.
 *
 * Because a node holds its tokens as properties, directly or inside other nodes or arrays, we walk the properties,
 * and we do not depend on one visit method per node type.
 */
export function collectTokens(node: Expr | Token, found: Token[] = []): Token[] {
  if (isToken(node)) {
    found.push(node);
    return found;
  }
  for (const value of Object.values(node)) {
    const children: unknown[] = Array.isArray(value) ? value : [value];
    for (const child of children) {
      if (isToken(child) || child instanceof Expr) {
        collectTokens(child, found);
      }
    }
  }
  return found;
}

/**
 * Gives the ranges of the original text that the removed nodes cover, as offsets.
 *
 * Because every token knows the line and the column where it starts in the original text, the ranges are exact,
 * whereas the ranges that RangeVisitor gives leave out some punctuation (for example the brackets of a chord).
 * Because a directive does not keep its leading `%%` as a token, we take the `%%` that precedes its key,
 * so that deleting the directive does not leave those two characters behind.
 * The tokens of `withFollowingBlanks` take the spaces and tabs that follow them.
 */
export function removedNodeRanges(original: string, removed: ReadonlyArray<Expr | Token>, withFollowingBlanks: ReadonlySet<Token> = new Set()): OffsetRange[] {
  const lineStarts = lineStartOffsets(original);
  const ranges: OffsetRange[] = [];
  for (const node of removed) {
    for (const token of collectTokens(node)) {
      let start = lineColumnToOffset(lineStarts, token.line, token.position);
      if (node instanceof Directive && token === node.key && original.slice(start - 2, start) === "%%") {
        start -= 2;
      }
      let end = lineColumnToOffset(lineStarts, token.line, token.position) + token.lexeme.length;
      // A token that was taken out of a directive that stays takes the blanks that follow it, so that no gap is left.
      if (withFollowingBlanks.has(token)) {
        while (end < original.length && (original[end] === " " || original[end] === "\t")) end++;
      }
      ranges.push({ start, end });
    }
  }
  return ranges;
}

/**
 * When a removed range reaches the end of its line, the blanks that come before it would stay as trailing spaces,
 * so the range takes them. Because only the last range of a line can reach its end, nothing else is affected.
 */
export function trimBlanksBeforeLineEnd(text: string, ranges: readonly OffsetRange[]): OffsetRange[] {
  return ranges.map((range) => {
    let lineEnd = range.end;
    while (lineEnd < text.length && text[lineEnd] !== "\n") lineEnd++;
    if (text.slice(range.end, lineEnd).trim() !== "") return range;
    let start = range.start;
    while (start > 0 && (text[start - 1] === " " || text[start - 1] === "\t")) start--;
    return { start, end: lineEnd };
  });
}

/**
 * When a removed range leaves only blanks on its line, the whole line is gone, so we widen the range to take its newline too.
 * Because a blank line ends a tune in ABC, a removed line must not leave an empty one behind.
 * The newline that follows the line is taken, or the one that precedes it when the line is the last of the text.
 */
export function widenToWholeLines(text: string, ranges: readonly OffsetRange[]): OffsetRange[] {
  return ranges.map((range) => {
    let lineStart = range.start;
    while (lineStart > 0 && text[lineStart - 1] !== "\n") lineStart--;
    let lineEnd = range.end;
    while (lineEnd < text.length && text[lineEnd] !== "\n") lineEnd++;
    const before = text.slice(lineStart, range.start);
    const after = text.slice(range.end, lineEnd);
    if (before.trim() !== "" || after.trim() !== "") {
      return range;
    }
    if (lineEnd < text.length) {
      return { start: lineStart, end: lineEnd + 1 };
    }
    return { start: Math.max(lineStart - 1, 0), end: lineEnd };
  });
}

/**
 * Filters voices from an ABC string, and gives the filtered text together with the deletions that relate it to the original text.
 *
 * Because the text is the original one with spans cut out, and is never printed again, a character offset in the
 * filtered text can be converted to the original text and back (see OffsetDeletionMap.ts). The printed text that
 * `filterVoicesInAbc` returns cannot give that, because the printer also adds text of its own, such as separator comments.
 */
export function filterVoicesInAbcWithDeletions(abc: string, context: ABCContext): FilteredAbc {
  const tokens = Scanner(abc, context);
  const ast = parse(tokens, context);

  const collector = new VoiceFilterCollector(context);
  const filterContext = collector.collect(ast);
  const visitor = new VoiceFilterVisitor(context, filterContext);
  visitor.filter(ast);

  const removedRanges = removedNodeRanges(abc, visitor.removedNodes, visitor.layoutTokens);
  const ranges = joinRangesAcrossBlanks(abc, mergeOffsetRanges(removedRanges));
  const deletions = mergeOffsetRanges(widenToWholeLines(abc, trimBlanksBeforeLineEnd(abc, ranges)));
  return { text: applyDeletions(abc, deletions), deletions };
}

/**
 * Convenience function to filter voices from an ABC string directly.
 *
 * Because this function parses, filters, and re-formats the ABC content,
 * it's suitable for use in rendering pipelines where the input is a string.
 *
 * Usage:
 *   const filteredAbc = filterVoicesInAbc(abcString, context);
 *
 * @param abc The ABC notation string to filter
 * @param context The ABC context for parsing and generating new node IDs
 * @returns The filtered ABC string with voices filtered according to %%abcls-voices directives
 */
export function filterVoicesInAbc(abc: string, context: ABCContext): string {
  // Avoid circular dependency by using dynamic require

  // Parse the ABC string
  const tokens = Scanner(abc, context);
  const ast = parse(tokens, context);

  // Filter the AST
  const filteredAst = filterVoiceInAst(ast, context);

  // Convert back to string
  const formatter = new AbcFormatter(context);
  return formatter.stringify(filteredAst);
}
