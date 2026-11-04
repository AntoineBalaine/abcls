/**
 * Score Directive Filter
 *
 * Removes the hidden voices from the values of a %%score or %%staves directive.
 *
 * Because abcjs draws one staff for each group of the directive, and fails with "Cannot read properties of undefined (reading
 * 'meter')" when the first staff of the directive has no voice that has music, a directive that still names the voices that the
 * voice filter removed made the whole preview fail, and the preview kept showing its previous drawing.
 *
 * The values of the directive are voice ids and grouping symbols:
 *   - `( ... )` puts voices on one staff,
 *   - `{ ... }` and `[ ... ]` group staves, and may contain parentheses,
 *   - `|` connects the bar lines of the staves that it stands between.
 */

import { Token, TT } from "../parsers/scan";

type ScoreNode = ScoreVoice | ScorePipe | ScoreGroup;

interface ScoreVoice {
  kind: "voice";
  token: Token;
}

interface ScorePipe {
  kind: "pipe";
  token: Token;
}

interface ScoreGroup {
  kind: "group";
  open: Token;
  close: Token | null;
  children: ScoreNode[];
}

/** What the filter decided for the values of a directive. */
export interface ScoreDirectiveFilterResult {
  /** The tokens that stay, in their order. */
  kept: Token[];
  /** The tokens that are removed: the hidden voices, the groups that became empty, and the separators that are left dangling. */
  removed: Token[];
  /** True when no voice stays, so that the whole directive can be dropped. */
  allRemoved: boolean;
}

const OPENING: ReadonlySet<TT> = new Set([TT.LPAREN, TT.LBRACE, TT.LBRACKET]);
const CLOSING_OF: ReadonlyMap<TT, TT> = new Map([
  [TT.RPAREN, TT.LPAREN],
  [TT.RBRACE, TT.LBRACE],
  [TT.RBRACKET, TT.LBRACKET],
]);

/** Reads the tokens as a tree of groups. Returns null when the tokens are not made of voices, pipes and balanced groups. */
function parseScoreTokens(values: ReadonlyArray<unknown>): ScoreGroup | null {
  const root: ScoreGroup = { kind: "group", open: null as unknown as Token, close: null, children: [] };
  const stack: ScoreGroup[] = [root];

  for (const value of values) {
    if (!(value instanceof Token)) return null;
    const current = stack[stack.length - 1];

    if (OPENING.has(value.type)) {
      const group: ScoreGroup = { kind: "group", open: value, close: null, children: [] };
      current.children.push(group);
      stack.push(group);
    } else if (CLOSING_OF.has(value.type)) {
      if (stack.length === 1 || stack[stack.length - 1].open.type !== CLOSING_OF.get(value.type)) return null;
      current.close = value;
      stack.pop();
    } else if (value.type === TT.PIPE) {
      current.children.push({ kind: "pipe", token: value });
    } else if (value.type === TT.NUMBER || value.type === TT.IDENTIFIER) {
      current.children.push({ kind: "voice", token: value });
    } else {
      return null;
    }
  }

  return stack.length === 1 ? root : null;
}

/** Counts the voices that a node holds. */
function countVoices(node: ScoreNode): number {
  if (node.kind === "voice") return 1;
  if (node.kind === "pipe") return 0;
  return node.children.reduce((sum, child) => sum + countVoices(child), 0);
}

/** Lists the tokens of a node, in their order. */
function tokensOf(node: ScoreNode, tokens: Token[]): void {
  if (node.kind === "group") {
    if (node.open !== null) tokens.push(node.open);
    for (const child of node.children) tokensOf(child, tokens);
    if (node.close !== null) tokens.push(node.close);
  } else {
    tokens.push(node.token);
  }
}

/**
 * Takes the hidden voices out of the children of a group, and the groups that then hold no voice.
 * The separators are then cleaned: none stays first, last, or next to another one, because a separator stands between two staves.
 * The tokens that go are added to `removed`.
 */
function pruneChildren(children: ScoreNode[], isHidden: (voiceId: string) => boolean, removed: Token[]): ScoreNode[] {
  const kept: ScoreNode[] = [];

  for (const child of children) {
    if (child.kind === "voice") {
      if (isHidden(child.token.lexeme)) {
        removed.push(child.token);
      } else {
        kept.push(child);
      }
    } else if (child.kind === "group") {
      child.children = pruneChildren(child.children, isHidden, removed);
      if (countVoices(child) === 0) {
        // The group holds no voice any more: its brackets and what is left in it go too.
        const tokens: Token[] = [];
        tokensOf(child, tokens);
        removed.push(...tokens);
      } else {
        kept.push(child);
      }
    } else {
      kept.push(child);
    }
  }

  // A separator needs a staff on each side. The first, the last, and the ones that follow another separator go.
  const cleaned: ScoreNode[] = [];
  for (let i = 0; i < kept.length; i++) {
    const node = kept[i];
    const previous = cleaned[cleaned.length - 1];
    const isLast = kept.slice(i + 1).every((later) => later.kind === "pipe");
    if (node.kind === "pipe" && (previous === undefined || previous.kind === "pipe" || isLast)) {
      removed.push(node.token);
    } else {
      cleaned.push(node);
    }
  }
  return cleaned;
}

/**
 * Takes the hidden voices out of the values of a %%score or %%staves directive.
 *
 * Returns null when the values are not what such a directive holds (for example, unbalanced groups), so that the caller
 * leaves the directive as it is.
 */
export function filterScoreDirective(values: ReadonlyArray<unknown>, isHidden: (voiceId: string) => boolean): ScoreDirectiveFilterResult | null {
  const root = parseScoreTokens(values);
  if (root === null) return null;

  const removed: Token[] = [];
  root.children = pruneChildren(root.children, isHidden, removed);

  const removedSet = new Set(removed);
  const kept = (values as Token[]).filter((token) => !removedSet.has(token));
  return { kept, removed: (values as Token[]).filter((token) => removedSet.has(token)), allRemoved: countVoices(root) === 0 };
}
