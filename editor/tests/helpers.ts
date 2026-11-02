import { Scanner, Token, parse, ABCContext, AbcFormatter, Expr, Inline_field, Info_line, IRational, createRational } from "abcls-parser";
import { expect } from "chai";
import * as fc from "fast-check";
import * as ParserGen from "../../parse/tests/prs_pbt.generators.spec";
import { fromAst, childrenVisitor } from "../src/csTree/fromAst";
import { toAst } from "../src/csTree/toAst";
import { CSNode } from "../src/csTree/types";
import { RunnerResult } from "../src/runner/runTransform";
import { createSelection, Selection } from "../src/selection";

export function toCSTree(source: string): CSNode {
  const ctx = new ABCContext();
  const tokens = Scanner(source, ctx);
  const ast = parse(tokens, ctx);
  return fromAst(ast, ctx);
}

export function toSelection(source: string): Selection {
  return createSelection(toCSTree(source));
}

function walkIterative(result: CSNode[], start: CSNode): void {
  let current: CSNode | null = start;
  while (current) {
    result.push(current);
    if (current.firstChild) {
      walkIterative(result, current.firstChild);
    }
    current = current.nextSibling;
  }
}

export function collectAll(root: CSNode): CSNode[] {
  const result: CSNode[] = [];
  walkIterative(result, root);
  return result;
}

export function collectSubtree(root: CSNode): CSNode[] {
  const result: CSNode[] = [root];
  if (root.firstChild) {
    walkIterative(result, root.firstChild);
  }
  return result;
}

export function findByTag(root: CSNode, tag: string): CSNode[] {
  return collectAll(root).filter((n) => n.tag === tag);
}

export function siblingCount(node: CSNode): number {
  let count = 0;
  let current = node.firstChild;
  while (current) {
    count++;
    current = current.nextSibling;
  }
  return count;
}

export function findById(root: CSNode, id: number): CSNode | undefined {
  return collectAll(root).find((n) => n.id === id);
}

// --- fast-check arbitraries built on top of existing parser generators ---

function tokensToString(tokens: { lexeme: string }[]): string {
  return tokens.map((t) => t.lexeme).join("");
}

export const genAbcTune: fc.Arbitrary<string> = ParserGen.genMusicSequence_NoBar.map((sequence) => "X:1\nK:C\n" + tokensToString(sequence.tokens) + "|\n");

export const genAbcWithChords: fc.Arbitrary<string> = fc
  .tuple(
    fc.array(ParserGen.genChordExpr, { minLength: 1, maxLength: 3 }),
    fc.array(ParserGen.genNoteExpr, { minLength: 0, maxLength: 3 }),
    fc.array(ParserGen.genRestExpr, { minLength: 0, maxLength: 2 })
  )
  .map(([chords, notes, rests]) => {
    const allTokens = [...chords, ...notes, ...rests].flatMap((e) => e.tokens);
    return "X:1\nK:C\n" + tokensToString(allTokens) + "|\n";
  });

export const genAbcWithMultiMeasureRests: fc.Arbitrary<string> = fc
  .tuple(
    fc.array(ParserGen.genMultiMeasureRestExpr, { minLength: 1, maxLength: 2 }),
    fc.array(ParserGen.genNoteExpr, { minLength: 0, maxLength: 3 }),
    fc.array(ParserGen.genRegularRestExpr, { minLength: 0, maxLength: 2 })
  )
  .map(([mmRests, notes, rests]) => {
    const allTokens = [...mmRests, ...notes, ...rests].flatMap((e) => e.tokens);
    return "X:1\nK:C\n" + tokensToString(allTokens) + "|\n";
  });

export const genAbcWithGraceGroups: fc.Arbitrary<string> = fc
  .tuple(fc.array(ParserGen.genGraceGroupExpr, { minLength: 1, maxLength: 3 }), fc.array(ParserGen.genNoteExpr, { minLength: 1, maxLength: 3 }))
  .map(([graces, notes]) => {
    const allTokens = [...graces, ...notes].flatMap((e) => e.tokens);
    return "X:1\nK:C\n" + tokensToString(allTokens) + "|\n";
  });

export const genAbcMultiTune: fc.Arbitrary<string> = fc
  .array(
    ParserGen.genMusicSequence_NoBar.map((seq) => tokensToString(seq.tokens) + "|\n"),
    { minLength: 2, maxLength: 4 }
  )
  .map((bodies) => bodies.map((body, i) => `X:${i + 1}\nK:C\n${body}`).join("\n"));

function stripValue2(node: Expr | Token): void {
  if (node instanceof Token) return;
  if (node instanceof Inline_field) {
    node.value2 = undefined;
  }
  if (node instanceof Info_line) {
    node.value2 = undefined;
  }
  const children = node.accept(childrenVisitor);
  for (const child of children) {
    stripValue2(child);
  }
}

export function formatAst(source: string): string {
  const ctx = new ABCContext();
  const tokens = Scanner(source, ctx);
  const ast = parse(tokens, ctx);
  stripValue2(ast);
  return new AbcFormatter(ctx).stringify(ast as Expr);
}

export function roundtrip(source: string): string {
  const csTree = toCSTree(source);
  const ast = toAst(csTree);
  return new AbcFormatter(new ABCContext()).stringify(ast as Expr);
}

export function toCSTreeWithContext(source: string): { root: CSNode; ctx: ABCContext } {
  const ctx = new ABCContext();
  const tokens = Scanner(source, ctx);
  const ast = parse(tokens, ctx);
  return { root: fromAst(ast, ctx), ctx };
}

export function formatSelection(sel: Selection): string {
  const ast = toAst(sel.root);
  return new AbcFormatter(new ABCContext()).stringify(ast as Expr);
}

export const genRational: fc.Arbitrary<IRational> = fc
  .tuple(fc.integer({ min: 1, max: 16 }), fc.integer({ min: 1, max: 16 }))
  .map(([n, d]) => createRational(n, d));

export const genSemitones: fc.Arbitrary<number> = fc.integer({ min: -24, max: 24 });

/**
 * Returns the value of a runner result in a test, and fails the test with the result's message when it failed.
 */
export function resultValue<T>(result: RunnerResult<T>): T {
  if (!result.ok) expect.fail(result.error);
  return result.value;
}

/**
 * Returns the message of a runner result that must have failed, and fails the test when it succeeded.
 */
export function resultError<T>(result: RunnerResult<T>): string {
  if (result.ok) expect.fail("expected the runner to fail");
  return result.error;
}
