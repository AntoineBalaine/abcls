import { findChild, remove, replace, getParent, insertBefore as cstreeInsertBefore, appendChild as cstreeAppendChild } from "abcls-cstree";
import { encode } from "abcls-parser/interpreter/ContextInterpreter";
import { TT } from "abcls-parser";
import { CSNode, TAGS, isTokenNode, getTokenData } from "../csTree/types";

export function findChildByTag(parent: CSNode, tag: string): CSNode | null {
  return findChild(parent, (n) => n.tag === tag);
}

export function findRhythmChild(parent: CSNode): CSNode | null {
  return findChild(parent, (n) => n.tag === TAGS.Rhythm);
}

export function findTieChild(parent: CSNode): CSNode | null {
  return findChild(parent, (n) => isTokenNode(n) && getTokenData(n).tokenType === TT.TIE);
}

export function replaceNodeWithSequence(oldNode: CSNode, newNodes: CSNode[]): void {
  if (newNodes.length === 0) {
    remove(oldNode);
    return;
  }
  for (const newNode of newNodes) {
    cstreeInsertBefore(oldNode, newNode);
  }
  remove(oldNode);
}

export function replaceRhythm(parent: CSNode, newRhythm: CSNode | null): void {
  const existing = findRhythmChild(parent);
  if (existing) {
    if (newRhythm) {
      replace(existing, newRhythm);
    } else {
      remove(existing);
    }
    return;
  }
  if (newRhythm === null) return;
  const tie = findTieChild(parent);
  if (tie) {
    cstreeInsertBefore(tie, newRhythm);
  } else {
    cstreeAppendChild(parent, newRhythm);
  }
}

export function getNodeLineAndChar(node: CSNode): { line: number; char: number } {
  let current: CSNode | null = node;
  while (current !== null) {
    if (isTokenNode(current)) {
      const data = getTokenData(current);
      return { line: data.line, char: data.position };
    }
    current = current.firstChild;
  }
  return { line: 0, char: 0 };
}

/**
 * Finds the encoded position where the bar accidentals reset after the given node.
 *
 * Because the interpreter forgets the accidentals of a bar at the next bar line and at the end of the line, the first
 * of those two that follows the node is where an accidental that we write must stop applying.
 *
 * @returns The encoded position of the next bar line or end of line, or null when the node is the last one of the tune
 */
export function findNextBarResetPos(node: CSNode): number | null {
  let current: CSNode | null = node;
  while (current !== null) {
    for (let sibling = current.nextSibling; sibling !== null; sibling = sibling.nextSibling) {
      if (sibling.tag === TAGS.BarLine) {
        const { line, char } = getNodeLineAndChar(sibling);
        return encode(line, char);
      }
      if (isTokenNode(sibling) && getTokenData(sibling).tokenType === TT.EOL) {
        const data = getTokenData(sibling);
        return encode(data.line, data.position);
      }
    }
    current = getParent(current);
  }
  return null;
}
