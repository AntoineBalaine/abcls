/**
 * Verification of the iReal Pro grid scanner, parser and layout against a
 * real library backup.
 *
 * Because the library is personal data it is never committed; the path to a
 * backup HTML page is given on the command line instead:
 *
 *   npx tsx parse/ireal/tools/verifyAgainstLibrary.ts <path-to-backup.html>
 *
 * The invariants are those of `plans/2.ireal-grid-lexer-parser.md` section 9
 * and `plans/3.chord-grid-text-rendering.md` section 9. Unit tests cover the
 * constructs we thought to write down; this covers the ones a real library
 * actually contains, and it has found three defects the unit tests did not.
 *
 * - Token coverage. Scanning covers every character of every chart, and
 *   every `GridTT.UNKNOWN` token is reported, grouped by the character that
 *   produced it and named by the chart it came from.
 * - Parsing. No chart makes `parseGrid` throw.
 * - Chord preservation between the tree and its layout, counting a cell's
 *   alternative chord as well as its own, over the walk the parser exports
 *   for the purpose. The layout groups and reorders bars and must neither
 *   add nor drop one, so the two multisets are compared for equality.
 * - Plausible length. No chart's layout may hold more bars than its tree
 *   does. The absence of any length invariant is what let the old path's
 *   inflation ship unnoticed, so it is checked rather than assumed.
 * - Every labelled section that lays out a bar contributes exactly one
 *   section label, on its first line.
 * - Barlines, which are the layout's central output and the subject of its
 *   whole defect history. A barline between two bars is printed once, so no
 *   repeat sign may appear at both sides of one line break, no line may open
 *   with a barline that closes, and the chart's last line must end the chart
 *   rather than separate it from nothing.
 *
 * - The writer's fixpoint, from `plans/4.abcx-to-ireal-export.md` section 9.
 *   Writing the tree back out as grid text and parsing that must reproduce
 *   the tree, which is what makes the writer trustworthy: the parser is the
 *   only independent judge of what the writer produced. Compared over the
 *   tree rather than over text, since the writer normalises whitespace,
 *   resolves back references and closes an unclosed repeat.
 *
 * An ending sequence that is not consecutive from one is a property of the
 * chart rather than a layout defect, so it is reported beside the unknown
 * tokens rather than failing the run.
 *
 * What is gone from this harness is the comparison against the ABCx
 * conversion, which measured whether the tree named every chord that
 * implementation did. That implementation is deleted, so the tree is now
 * the reference rather than the candidate. `plans/4.abcx-to-ireal-export.md`
 * adds the invariant that replaces it: writing the tree back out as grid
 * text and parsing it must reproduce the tree.
 */
import * as fs from "fs";
import { ABCContext } from "../../parsers/Context";
import { AbcErrorReporter } from "../../parsers/ErrorReporter";
import { parsedChordToIrealText } from "../chordShorthand";
import { parsePlaylistLink, stripChordDataMarker } from "../fields";
import { IrealChart } from "../gridAst";
import { ChartLayout, layoutChart } from "../gridLayout";
import { chartChords, parseGrid } from "../gridParser";
import { scanGrid } from "../gridScanner";
import { GridTT, tokensToGridText } from "../gridTokens";
import { writeGrid } from "../gridWriter";
import { unscramble } from "../scramble";

/**
 * Every chord the layout names, counting a cell's alternative chord as well
 * as its own.
 *
 * The tree side of the same walk is `chartChords` in `gridParser.ts`, which
 * exists so that both sides count the same things; a walk that forgot the
 * alternative branch would let the layout drop every alternative chord in
 * the library while the preservation check still passed.
 */
function layoutChordTexts(layout: ChartLayout): string[] {
  const out: string[] = [];
  for (const line of layout.lines) {
    for (const bar of line.bars) {
      for (const cell of bar.cells) {
        if (cell.chord) out.push(parsedChordToIrealText(cell.chord));
        if (cell.alternative) out.push(parsedChordToIrealText(cell.alternative));
      }
    }
  }
  return out;
}

function treeBarCount(chart: IrealChart): number {
  let n = 0;
  for (const section of chart.sections) {
    n += section.bars.filter((bar) => bar.cells.length > 0).length;
    for (const ending of section.repeat?.endings ?? []) {
      n += ending.bars.filter((bar) => bar.cells.length > 0).length;
    }
  }
  return n;
}

/**
 * The layout conditions that must hold for one chart, as a list of the ones
 * that do not, so that a failing chart names its own problem.
 */
function layoutProblems(chart: IrealChart, layout: ChartLayout): string[] {
  const problems: string[] = [];

  const expected = multisetOf(chartChords(chart).map(parsedChordToIrealText));
  const actual = multisetOf(layoutChordTexts(layout));
  for (const [text, count] of expected) {
    const got = actual.get(text) ?? 0;
    if (got !== count) problems.push(`chord ${text}: tree ${count}, layout ${got}`);
  }
  for (const text of actual.keys()) {
    if (!expected.has(text)) problems.push(`chord ${text}: in layout, not in tree`);
  }

  const laidOutBars = layout.lines.reduce((sum, line) => sum + line.bars.length, 0);
  if (laidOutBars > treeBarCount(chart)) {
    problems.push(`bars: tree ${treeBarCount(chart)}, layout ${laidOutBars}`);
  }

  // A section that lays out no bar at all contributes no line and so owes
  // no label; there is nothing for the label to head.
  const labelled = chart.sections.filter(
    (section) =>
      section.label !== undefined &&
      (section.bars.some((bar) => bar.cells.length > 0) ||
        (section.repeat?.endings ?? []).some((ending) => ending.bars.some((bar) => bar.cells.length > 0)))
  ).length;
  const labels = layout.lines.filter((line) => line.sectionLabel !== undefined).length;
  if (labels !== labelled) problems.push(`section labels: sections ${labelled}, lines ${labels}`);

  // Barlines are the layout's central output and the subject of the whole
  // defect history, so they are checked rather than trusted. A barline
  // between two bars must be printed once: when the two fall on different
  // lines, what closes belongs to the earlier line and what opens to the
  // later one, so the same repeat sign appearing at both sides of one line
  // break is the duplication this checks for.
  for (let i = 0; i + 1 < layout.lines.length; i++) {
    const closing = layout.lines[i].closeBarline;
    const opening = layout.lines[i + 1].bars[0]?.openBarline;
    if (closing !== "plain" && closing === opening) {
      problems.push(`barline ${closing} printed at both sides of the break after line ${i}`);
    }
    if (closing === "closeOpenRepeat" || opening === "closeOpenRepeat") {
      problems.push(`barline ${closing}/${opening} spans a line break, where it must be split`);
    }
    if (opening === "closeRepeat") {
      problems.push(`line ${i + 1} opens with a closing repeat, which belongs to the line before it`);
    }
  }
  if (layout.lines.length > 0 && layout.lines[layout.lines.length - 1].closeBarline === "plain") {
    problems.push("the chart's last line closes with a separator rather than ending the chart");
  }

  return problems;
}

/**
 * The tree as a canonical string, for comparing it with a reparse of what
 * the writer produced.
 *
 * Keys are sorted, because two trees holding the same facts may order their
 * properties differently and a plain stringify calls that a difference.
 * `position` is an offset into text the writer does not reproduce, and
 * `unclosed` is a diagnostic it normalises away by closing the repeat.
 */
function canonicalTree(chart: IrealChart): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value === null || typeof value !== "object") return value;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (key === "position" || key === "unclosed") continue;
      out[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return out;
  };
  return JSON.stringify(canonical(chart));
}

/**
 * The ways writing a chart and reading it back can fail, as a list of the
 * ones that happened.
 */
function writerProblems(chart: IrealChart): string[] {
  const problems: string[] = [];
  const writeCtx = new ABCContext(new AbcErrorReporter());
  const text = writeGrid(chart, writeCtx);
  for (const error of writeCtx.errorReporter.getErrors()) problems.push(`writing: ${error.message}`);

  const readCtx = new ABCContext(new AbcErrorReporter());
  const stream = scanGrid(text, readCtx);
  const unknown = stream.filter((token) => token.type === GridTT.UNKNOWN);
  if (unknown.length > 0) {
    problems.push(`wrote ${unknown.length} character(s) the scanner does not know: ${unknown.map((t) => JSON.stringify(t.lexeme)).join(", ")}`);
  }
  const reparsed = parseGrid(stream, readCtx);
  if (canonicalTree(reparsed) !== canonicalTree(chart)) problems.push("the reparsed tree differs from the one written");
  return problems;
}

/**
 * Ending sequences that are not consecutive from one.
 *
 * Such a section is laid out in the order the chart writes it, which is the
 * order it is read in, since the numbers are not a reliable ordering when
 * they repeat or start above one. This is a property of the chart rather
 * than a layout defect, so it is reported for review alongside the unknown
 * tokens rather than failing the run.
 */
function oddEndingSequences(chart: IrealChart): string[] {
  const odd: string[] = [];
  for (const section of chart.sections) {
    const numbers = (section.repeat?.endings ?? []).map((ending) => ending.number);
    if (numbers.length > 0 && !numbers.every((n, i) => n === i + 1)) odd.push(numbers.join(","));
  }
  return odd;
}

const HREF_IREAL_LINK = /href="(irealb:\/\/[^"]*)"/g;

interface Chart {
  title: string;
  grid: string;
}

function extractCharts(html: string): Chart[] {
  const charts: Chart[] = [];
  for (const match of html.matchAll(HREF_IREAL_LINK)) {
    // Because a single malformed link would otherwise throw out of this
    // function and end the run before any chart was scanned, the link is
    // parsed inside the guard too, not only its songs' chord data.
    let playlist;
    try {
      playlist = parsePlaylistLink(match[1]);
    } catch (err) {
      process.stdout.write(`skipped an unparsable link: ${String(err)}\n`);
      continue;
    }
    for (const song of playlist.songs) {
      try {
        charts.push({ title: song.title, grid: unscramble(stripChordDataMarker(song.rawChordData)) });
      } catch (err) {
        process.stdout.write(`skipped ${song.title}: ${String(err)}\n`);
      }
    }
  }
  return charts;
}


/** A chord multiset, keyed by the chord's own iReal Pro text. */
type Multiset = Map<string, number>;

function multisetOf(texts: string[]): Multiset {
  const counts: Multiset = new Map();
  for (const text of texts) counts.set(text, (counts.get(text) ?? 0) + 1);
  return counts;
}

/**
 * Every chord the chart names in playing order, with a repeated section's
 * bars counted once per time they are played.
 *
 * The expansion is needed for the comparison rather than for its own sake:
 * the current implementation resolves a repeat by duplicating its text
 * (`gridAnnotations.ts`'s `fillRepeats`), so its chord multiset counts a
 * repeated section's chords twice, where the tree deliberately stores
 * those bars once. Comparing the tree against it unexpanded would report
 * a loss on every chart that has a repeat, which is an artifact of the two
 * representations rather than a lost chord.
 */
function performedChords(chart: IrealChart): string[] {
  const chords: string[] = [];
  const barChords = (bars: IrealChart["sections"][number]["bars"]): string[] => {
    const texts: string[] = [];
    for (const bar of bars) {
      for (const cell of bar.cells) {
        if (cell.chord) texts.push(parsedChordToIrealText(cell.chord));
        if (cell.alternative) texts.push(parsedChordToIrealText(cell.alternative));
      }
    }
    return texts;
  };
  for (const section of chart.sections) {
    const common = barChords(section.bars);
    const repeat = section.repeat;
    if (repeat?.kind === "endings") {
      // Each ending plays the common bars before its own, and this holds
      // whether or not the opening brace was ever closed: an unclosed
      // brace loses the repeat, not the bars written inside the endings.
      for (const ending of repeat.endings ?? []) {
        chords.push(...common, ...barChords(ending.bars));
      }
      continue;
    }
    chords.push(...common);
    if (repeat && !repeat.unclosed) chords.push(...common);
  }
  return chords;
}

function main(): void {
  const path = process.argv[2];
  if (!path) {
    process.stderr.write("usage: verifyAgainstLibrary.ts <path-to-backup.html>\n");
    process.exit(2);
  }

  const charts = extractCharts(fs.readFileSync(path, "utf8"));

  let characters = 0;
  let tokens = 0;
  let coverageFailures = 0;
  // Keyed by the unknown character, so the report reads as a short list of
  // grammar gaps rather than one line per occurrence.
  const unknowns = new Map<string, { count: number; charts: Set<string>; samples: Set<string> }>();
  // Reported separately from unknown tokens, because an unterminated
  // annotation or alternative chord is reported without producing a single
  // unknown token: counting only unknowns would let that condition pass
  // the run unnoticed.
  const reported: Array<{ title: string; message: string }> = [];
  let parseFailures = 0;
  let treeChords = 0;
  let layoutFailures = 0;
  let writerFailures = 0;
  const oddEndings: Array<{ title: string; sequence: string }> = [];
  let laidOutBarTotal = 0;
  let laidOutLineTotal = 0;
  let treeBarTotal = 0;

  for (const chart of charts) {
    const ctx = new ABCContext(new AbcErrorReporter());
    const stream = scanGrid(chart.grid, ctx);
    characters += chart.grid.length;
    tokens += stream.length;

    if (tokensToGridText(stream) !== chart.grid) {
      coverageFailures++;
      process.stdout.write(`coverage failure: ${chart.title}\n`);
    }
    // Parsing and chord preservation. A chart that throws is counted and
    // the run carries on, so one bad chart does not hide the state of the
    // other 656.
    let tree: IrealChart | null = null;
    try {
      tree = parseGrid(stream, ctx);
    } catch (err) {
      parseFailures++;
      process.stdout.write(`parse failure: ${chart.title}: ${String(err)}\n`);
    }
    if (tree !== null) {
      treeChords += performedChords(tree).length;

      const laidOut = layoutChart(tree);
      const problems = layoutProblems(tree, laidOut);
      if (problems.length > 0) {
        layoutFailures++;
        process.stdout.write(`layout: ${chart.title}: ${problems.join("; ")}\n`);
      }
      const writerIssues = writerProblems(tree);
      if (writerIssues.length > 0) {
        writerFailures++;
        process.stdout.write(`writer: ${chart.title}: ${writerIssues.join("; ")}\n`);
      }

      for (const sequence of oddEndingSequences(tree)) {
        oddEndings.push({ title: chart.title, sequence });
      }
      laidOutBarTotal += laidOut.lines.reduce((sum, line) => sum + line.bars.length, 0);
      laidOutLineTotal += laidOut.lines.length;
      treeBarTotal += treeBarCount(tree);
    }

    // Read after parsing, so that what the parser reports is surfaced too
    // and not only what the scanner reported.
    for (const error of ctx.errorReporter.getErrors()) {
      if (error.message.startsWith("Unrecognized character")) continue;
      reported.push({ title: chart.title, message: error.message });
    }

    for (let i = 0; i < stream.length; i++) {
      const token = stream[i];
      if (token.type !== GridTT.UNKNOWN) continue;
      let entry = unknowns.get(token.lexeme);
      if (!entry) {
        entry = { count: 0, charts: new Set(), samples: new Set() };
        unknowns.set(token.lexeme, entry);
      }
      entry.count++;
      entry.charts.add(chart.title);
      entry.samples.add(chart.grid.slice(Math.max(0, token.position - 8), token.position + 8));
    }
  }

  const unknownCount = [...unknowns.values()].reduce((sum, e) => sum + e.count, 0);

  process.stdout.write(`charts: ${charts.length}\n`);
  process.stdout.write(`characters: ${characters}\n`);
  process.stdout.write(`tokens: ${tokens}\n`);
  process.stdout.write(`coverage failures: ${coverageFailures}\n`);
  process.stdout.write(`UNKNOWN tokens: ${unknownCount}\n`);
  process.stdout.write(`parse failures: ${parseFailures}\n`);
  process.stdout.write(`chords named by the tree, repeats expanded: ${treeChords}\n`);
  process.stdout.write(`charts failing a layout invariant: ${layoutFailures}\n`);
  process.stdout.write(`charts failing the writer fixpoint: ${writerFailures}\n`);
  process.stdout.write(`bars in the tree: ${treeBarTotal}\n`);
  process.stdout.write(`bars laid out: ${laidOutBarTotal}\n`);
  process.stdout.write(`lines laid out: ${laidOutLineTotal}\n`);
  process.stdout.write(`sections whose ending numbers are not consecutive from one: ${oddEndings.length}\n`);
  for (const entry of [...new Map(oddEndings.map((e) => [`${e.title}:${e.sequence}`, e])).values()]) {
    process.stdout.write(`  ${entry.title}: endings ${entry.sequence}\n`);
  }
  // Grouped by message rather than listed per chart, because a single
  // condition holding on fifty charts is one thing to look at, not fifty.
  const byMessage = new Map<string, string[]>();
  for (const entry of reported) {
    const titles = byMessage.get(entry.message) ?? [];
    titles.push(entry.title);
    byMessage.set(entry.message, titles);
  }
  process.stdout.write(`other reported conditions: ${reported.length}, in ${byMessage.size} kinds\n`);
  for (const [message, titles] of [...byMessage.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const named = [...new Set(titles)];
    process.stdout.write(`  x${titles.length} ${message} (${named.slice(0, 4).join(", ")}${named.length > 4 ? `, and ${named.length - 4} more` : ""})\n`);
  }
  for (const [lexeme, entry] of [...unknowns.entries()].sort((a, b) => b[1].count - a[1].count)) {
    process.stdout.write(`  ${JSON.stringify(lexeme)} x${entry.count} in ${[...entry.charts].join(", ")}\n`);
    for (const sample of entry.samples) {
      process.stdout.write(`      ${JSON.stringify(sample)}\n`);
    }
  }

  // A coverage failure means a character was dropped, a parse failure
  // means a chart did not import at all, and a chord loss means the tree
  // names fewer chords than the implementation it replaces: each of the
  // three is a condition this work exists to make impossible. Unknown
  // tokens are reported for review rather than failing the run, because
  // the plan allows a listed and explained exception set.
  process.exit(coverageFailures === 0 && parseFailures === 0 && layoutFailures === 0 && writerFailures === 0 ? 0 : 1);
}

main();
