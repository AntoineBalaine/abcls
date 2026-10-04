/**
 * Token-level verification of `gridScanner.ts` against a real iReal Pro
 * library backup.
 *
 * Because the library is personal data it is never committed; the path to a
 * backup HTML page is given on the command line instead:
 *
 *   npx tsx parse/ireal/tools/verifyAgainstLibrary.ts <path-to-backup.html>
 *
 * This is the Phase 1 harness described in
 * `plans/2.ireal-grid-lexer-parser.md` section 9, limited to the token
 * level: it checks that scanning covers every character of every chart and
 * reports every `GridTT.UNKNOWN` token it finds, grouped by the character
 * that produced it and named by the chart it came from. Phases 2 and 3 add
 * the parser and emitter invariants.
 */
import * as fs from "fs";
import { parsePlaylistLink, stripChordDataMarker } from "../fields";
import { ABCContext } from "../../parsers/Context";
import { AbcErrorReporter } from "../../parsers/ErrorReporter";
import { unscramble } from "../scramble";
import { scanGrid } from "../gridScanner";
import { GridTT, tokensToGridText } from "../gridTokens";

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

  for (const chart of charts) {
    const ctx = new ABCContext(new AbcErrorReporter());
    const stream = scanGrid(chart.grid, ctx);
    characters += chart.grid.length;
    tokens += stream.length;

    if (tokensToGridText(stream) !== chart.grid) {
      coverageFailures++;
      process.stdout.write(`coverage failure: ${chart.title}\n`);
    }
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
  process.stdout.write(`other reported conditions: ${reported.length}\n`);
  for (const entry of reported) {
    process.stdout.write(`  ${entry.title}: ${entry.message}\n`);
  }
  for (const [lexeme, entry] of [...unknowns.entries()].sort((a, b) => b[1].count - a[1].count)) {
    process.stdout.write(`  ${JSON.stringify(lexeme)} x${entry.count} in ${[...entry.charts].join(", ")}\n`);
    for (const sample of entry.samples) {
      process.stdout.write(`      ${JSON.stringify(sample)}\n`);
    }
  }

  // Coverage failures mean a character was dropped, which is the one
  // condition this phase exists to make impossible; unknown tokens are
  // reported for review rather than failing the run, because the plan
  // allows a listed and explained exception set.
  process.exit(coverageFailures === 0 ? 0 : 1);
}

main();
