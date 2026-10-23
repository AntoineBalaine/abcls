import { ABCContext, Range, Scanner, SemanticAnalyzer, parse } from "abcls-parser";
import { ChordPositionCollector } from "abcls-parser/interpreter/ChordPositionCollector";
import { fromAst } from "../csTree/fromAst";
import { TAGS } from "../csTree/types";
import { interpretContext } from "../context/csContextInterpreter";
import { Selection, createSelection } from "../selection";
import { selectVoices } from "../selectors/voiceSelector";
import { serializeCSTree } from "./csTreeSerializer";
import { findNodesInRange, resolveContiguousRanges } from "./selectionRangeResolver";
import { GROUPED_CURSOR_TRANSFORMS, POSITION_BASED_TRANSFORMS, TRANSFORM_NODE_TAGS } from "./transformConstants";
import { CONTEXT_AWARE_TRANSFORMS, lookupTransform } from "./transformLookup";

/**
 * The transforms whose result depends on the accidentals already written in the bar.
 */
const TRANSFORMS_NEEDING_ACCIDENTALS = new Set(["harmonizeVoicing", "transpose", "dropVoicing", "parallelVoicing", "enharmonizeToKey"]);

export interface TransformRequest {
  /** The ABC text to transform. */
  source: string;
  /** The name of the transform, as listed in the transform lookup. */
  transform: string;
  /** The arguments of the transform, after the selection and the context. */
  args: unknown[];
  /** The ranges that select the nodes to transform. Null selects the whole document. */
  ranges: Range[] | null;
}

export class TransformError extends Error {}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseSource(source: string): { ast: ReturnType<typeof parse>; ctx: ABCContext } {
  const ctx = new ABCContext();
  const ast = parse(Scanner(source, ctx), ctx);
  return { ast, ctx };
}

/**
 * Returns the line ranges that hold the music of the given voices.
 * Because the voice selector works on the tree, the ranges come from the same selection engine as the editor commands.
 */
export function rangesOfVoices(source: string, voiceIds: string): Range[] {
  // Because the voice selector returns the whole selection when a voice does not exist, a typo would transform every voice.
  for (const id of voiceIds.split(",").map((part) => part.trim())) {
    const declared = new RegExp(`(^|\\n)(\\[V:${escapeRegExp(id)}[\\s\\]]|V:${escapeRegExp(id)}(\\s|$))`).test(source);
    if (!declared) {
      throw new TransformError(`Voice "${id}" not found in the file.`);
    }
  }
  const { ast, ctx } = parseSource(source);
  const root = fromAst(ast, ctx);
  return resolveContiguousRanges(selectVoices(createSelection(root), voiceIds));
}

/**
 * Applies a transform to a text and returns the new text.
 * This is the logic that the language server runs for the "abc.applyTransform" request,
 * extracted so the command line can run it without a server.
 */
export function runTransform(request: TransformRequest): string {
  const transformFn = lookupTransform(request.transform);
  if (transformFn === null) {
    throw new TransformError(`Unknown transform: "${request.transform}"`);
  }
  if (POSITION_BASED_TRANSFORMS.has(request.transform)) {
    throw new TransformError(`The transform "${request.transform}" works on cursor positions, which the command line does not have.`);
  }

  const { ast, ctx } = parseSource(request.source);
  const root = fromAst(ast, ctx);

  const tags = TRANSFORM_NODE_TAGS[request.transform] ?? [TAGS.Note, TAGS.Chord];
  const ranges: Range[] = request.ranges ?? [
    { start: { line: 0, character: 0 }, end: { line: Number.MAX_SAFE_INTEGER, character: 0 } },
  ];

  // Grouped transforms (such as legato) need to see the sequence of nodes, so they get a single cursor.
  const cursors: Set<number>[] = [];
  const grouped = new Set<number>();
  for (const range of ranges) {
    for (const id of findNodesInRange(root, range, tags)) {
      if (GROUPED_CURSOR_TRANSFORMS.has(request.transform)) {
        grouped.add(id);
      } else {
        cursors.push(new Set([id]));
      }
    }
  }
  if (grouped.size > 0) cursors.push(grouped);
  if (cursors.length === 0) {
    return request.source;
  }

  const selection: Selection = { root, cursors };

  let transformArgs = request.args;
  if (CONTEXT_AWARE_TRANSFORMS.has(request.transform)) {
    const analyzer = new SemanticAnalyzer(ctx);
    ast.accept(analyzer);
    const snapshots = interpretContext(root, analyzer.data, {
      snapshotAccidentals: TRANSFORMS_NEEDING_ACCIDENTALS.has(request.transform),
    });
    transformArgs = [snapshots, ...transformArgs];

    if (request.transform === "harmonizeVoicing") {
      transformArgs = [...transformArgs, new ChordPositionCollector(analyzer.data).collect(ast)];
    }
    if (request.transform === "parallelVoicing") {
      const collector = new ChordPositionCollector(analyzer.data, { minVoices: 1, includeAstChord: true });
      transformArgs = [...transformArgs, collector.collect(ast)];
    }
  }

  const result = transformFn(selection, ctx, ...transformArgs);
  return serializeCSTree(result.root, ctx);
}
