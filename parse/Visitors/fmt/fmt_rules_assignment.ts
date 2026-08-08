import { isChord, isNote, isToken } from "../../helpers";
import { ABCContext } from "../../parsers/Context";
import { Ctx, Token, TT } from "../../parsers/scan";
import { BarLine, Beam, Decoration, Expr, Grace_group, MultiMeasureRest, System, Tune, Tune_Body, tune_body_code, Tuplet } from "../../types/Expr";
import { isBarLine, isBeam, isMultiMeasureRest } from "./fmt_timeMapHelpers";

// Types for rules assignment
export enum SpcRul {
  NO_SPC,
  PRECEDE_SPC,
}

export function resolveRules(ast: Tune, ctx: ABCContext): Tune {
  const tune_body = ast.tune_body;
  // Start at tune body level
  if (tune_body) {
    ast = preprocessTune(ast, ctx);
    const ruleMap = assignTuneBodyRules(ast);
    ast.tune_body = resolveTuneBody(tune_body, ruleMap, ctx);
  }
  return ast;
}

/**
 * Strip WS tokens and - if it's a multi-voice tune - expand multi-measure rests in tune.
 */
export function preprocessTune(tune: Tune, ctx: ABCContext): Tune {
  const tuneBody = tune.tune_body!;
  const is_multivoice = tune.tune_header.voices.length > 1;

  tuneBody.sequence = tuneBody.sequence.map((system) => {
    if (is_multivoice) {
      system = expandMultiMeasureRests(system, ctx);
    }
    return system.filter((node) => !(isToken(node) && node.type === TT.WS));
  });

  return tune;
}
function isSlur(expr: Expr | Token) {
  return isToken(expr) && expr.type === TT.SLUR;
}
function isMusic(cur: Expr | Token) {
  return isNote(cur) || isChord(cur) || isBeam(cur);
}

function slurAfterNote(ruleMap: Map<Expr | Token, SpcRul>, prev: Expr | Token, cur: Expr | Token): boolean {
  if (!(isMusic(prev) && isSlur(cur))) return false;
  ruleMap.set(cur, SpcRul.NO_SPC);
  return true;
}
function noteAfterSlur(ruleMap: Map<Expr | Token, SpcRul>, prev: Expr | Token, cur: Expr | Token): boolean {
  if (!(isSlur(prev) && isMusic(cur))) return false;
  ruleMap.set(cur, SpcRul.NO_SPC);
  return true;
}
function noteAfterTuplet(ruleMap: Map<Expr | Token, SpcRul>, prev: Expr | Token, cur: Expr | Token): boolean {
  if (!(prev instanceof Tuplet && isMusic(cur))) return false;
  ruleMap.set(cur, SpcRul.NO_SPC);
  return true;
}
export function assignTuneBodyRules(tune: Tune): Map<Expr | Token, SpcRul> {
  const tuneBody = tune.tune_body!;
  const ruleMap = new Map<Expr | Token, SpcRul>();
  // Process each system
  for (const system of tuneBody.sequence) {
    for (let i = 0; i < system.length; i++) {
      const newIdx = symLnRules(system, i, ruleMap);
      if (newIdx !== null) {
        i = newIdx;
        continue;
      }
      const prev = system[i - 1];
      const node = system[i];
      if (noteAfterSlur(ruleMap, prev, node)) continue;
      if (slurAfterNote(ruleMap, prev, node)) continue;
      if (noteAfterTuplet(ruleMap, prev, node)) continue;
      if (
        isToken(node) &&
        // node.type === TT.SLUR  ||
        (node.type === TT.EOL || node.type === TT.EOF)
      ) {
        ruleMap.set(node, SpcRul.NO_SPC);
      } else {
        ruleMap.set(node, SpcRul.PRECEDE_SPC);
      }
    }
  }
  return ruleMap;
}

/**
 * Updates the parse tree in place
 */
export function resolveTuneBody(tuneBody: Tune_Body, ruleMap: Map<Expr | Token, SpcRul>, ctx: ABCContext): Tune_Body {
  for (let s = 0; s < tuneBody.sequence.length; s++) {
    const system = tuneBody.sequence[s];
    const spacingDecisions = resolveSystem(ruleMap, system);
    for (let i = 0; i < system.length; i++) {
      const node = system[i];
      const decision = spacingDecisions.get(node);
      if (decision === TT.WS) {
        const tknCtx = new Ctx(" ", ctx);
        tknCtx.current = tknCtx.source.length;
        tuneBody.sequence[s].splice(i, 0, new Token(TT.WS, tknCtx, ctx.generateId()));
        i += 1;
      }
    }
  }
  return tuneBody;
}

/**
 * IN MULTI-VOICE SCORES ONLY
 * multi-measure rests need to be expanded to align bar lines.
 * @param system
 * @returns
 */
export function expandMultiMeasureRests(system: System, ctx: ABCContext): System {
  const expanded: System = [];

  for (const node of system) {
    if (isMultiMeasureRest(node) && node.length) {
      const is_invisible_rest = node.rest.lexeme === "X";
      const measures = node.length ? parseInt(node.length.lexeme) : 1;

      // Add first Z
      const firstRestCtx = new Ctx(is_invisible_rest ? "X" : "Z", ctx);
      firstRestCtx.current = firstRestCtx.source.length;
      const firstRest = new Token(TT.REST, firstRestCtx, ctx.generateId());
      expanded.push(new MultiMeasureRest(ctx.generateId(), firstRest));

      // Add barline and Z for remaining measures
      for (let i = 1; i < measures; i++) {
        const barCtx = new Ctx("|", ctx);
        barCtx.current = barCtx.source.length;
        const barToken = new Token(TT.BARLINE, barCtx, ctx.generateId());
        expanded.push(new BarLine(ctx.generateId(), [barToken]));

        const restCtx = new Ctx(is_invisible_rest ? "X" : "Z", ctx);
        restCtx.current = restCtx.source.length;
        const restToken = new Token(TT.REST, restCtx, ctx.generateId());
        expanded.push(new MultiMeasureRest(ctx.generateId(), restToken));
      }
    } else {
      expanded.push(node);
    }
  }

  return expanded;
}

export function resolveSystem(ruleMap: Map<Expr | Token, SpcRul>, system: System) {
  // Will hold final spacing decisions
  const spacingDecisions = new Map<Expr | Token, TT | null>();

  for (let i = 0; i < system.length; i++) {
    const node = system[i];
    const currentRules: SpcRul | undefined = ruleMap.get(node);
    if (currentRules === undefined) {
      continue;
    }

    // Resolve spacing between current and next node
    switch (currentRules) {
      case SpcRul.PRECEDE_SPC: {
        const prevNode = i > 0 ? system[i - 1] : null;

        if (!noPrev(prevNode, node)) {
          spacingDecisions.set(node, TT.WS);
        }
        break;
      }
      case SpcRul.NO_SPC:
      default: {
        spacingDecisions.set(node, null);
        break;
      }
    }
  }

  return spacingDecisions;
}

function noPrev(prev: tune_body_code | null, cur: tune_body_code): boolean {
  return (
    !prev || // start of input
    (isToken(prev) && prev.type === TT.EOL) || // start of line
    (prev instanceof Decoration && isNote(cur)) ||
    (prev instanceof Decoration && isChord(cur)) ||
    (prev instanceof Decoration && cur instanceof Decoration) ||
    (prev instanceof Decoration && cur instanceof Beam) ||
    (prev instanceof Grace_group && isNote(cur)) ||
    (prev instanceof Grace_group && cur instanceof Beam) ||
    (prev instanceof Grace_group && isChord(cur))
  );
}

// special rules for symbol lines: only barlines get spaces.
function symLnRules(system: System, idx: number, ruleMap: Map<Expr | Token, SpcRul>): number | null {
  const strtNode = system[idx];
  if (!(isToken(strtNode) && strtNode.type === TT.SY_HDR)) return null;
  let i = idx + 1;
  for (; i < system.length; i++) {
    const node = system[i];
    if (isToken(node) && (node.type === TT.EOL || node.type === TT.EOF)) {
      return i;
    }
    if (isToken(node) && (node.type === TT.SY_STAR || node.type === TT.SY_TXT)) {
      if (idx === i - 1 || isBarLine(system[i - 1])) {
        ruleMap.set(node, SpcRul.PRECEDE_SPC);
      } else ruleMap.set(node, SpcRul.NO_SPC);
      continue;
    }
    ruleMap.set(node, SpcRul.PRECEDE_SPC);
  }
  return i;
}
