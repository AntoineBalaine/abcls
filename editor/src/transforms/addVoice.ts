import { insertBefore, appendChild } from "abcls-cstree";
import { ABCContext, TT } from "abcls-parser";
import { createCSNode, CSNode, TAGS, isTokenNode, getTokenData } from "../csTree/types";
import { Selection } from "../selection";
import { findHeaderOfTune, findTunesWithSelection } from "./lineUtils";

export interface VoiceParams {
  name?: string;
  clef?: string;
  transpose?: number;
}

/**
 * Adds a V: declaration to the header of every tune that holds a selected node.
 *
 * Because a document may contain several tunes, the target header is resolved from the
 * selection rather than taken from the first tune. A selection that identifies no tune
 * leaves the document untouched.
 */
export function addVoice(selection: Selection, voiceId: string, params: VoiceParams, ctx: ABCContext): Selection {
  const selectedIds = new Set<number>();
  for (const cursor of selection.cursors) {
    for (const id of cursor) {
      selectedIds.add(id);
    }
  }

  for (const tune of findTunesWithSelection(selection.root, selectedIds)) {
    const tuneHeader = findHeaderOfTune(tune);
    if (tuneHeader === null) continue;
    addVoiceToHeader(tuneHeader, voiceId, params, ctx);
  }

  return selection;
}

/**
 * Inserts a V: declaration into the given tune header, ahead of its K: line when there is
 * one. Callers that have already resolved the tune they are working on use this directly.
 */
export function addVoiceToHeader(tuneHeader: CSNode, voiceId: string, params: VoiceParams, ctx: ABCContext): void {
  const voiceText = buildVoiceText(voiceId, params);
  const voiceInfoLine = buildVoiceInfoLineNode(voiceText, ctx);

  const kLineResult = findKLine(tuneHeader);
  if (kLineResult !== null) {
    insertBefore(kLineResult.node, voiceInfoLine);
  } else {
    appendChild(tuneHeader, voiceInfoLine);
  }
}

function buildVoiceText(voiceId: string, params: VoiceParams): string {
  const parts = [voiceId];
  if (params.name !== undefined) {
    parts.push('name="' + params.name + '"');
  }
  if (params.clef !== undefined) {
    parts.push("clef=" + params.clef);
  }
  if (params.transpose !== undefined) {
    parts.push("transpose=" + params.transpose.toString());
  }
  return parts.join(" ");
}

function buildVoiceInfoLineNode(voiceText: string, ctx: ABCContext): CSNode {
  const keyToken = createCSNode(TAGS.Token, ctx.generateId(), {
    lexeme: "V:",
    tokenType: TT.INF_HDR,
    line: 0,
    position: 0,
  });

  const valueToken = createCSNode(TAGS.Token, ctx.generateId(), {
    lexeme: voiceText,
    tokenType: TT.INFO_STR,
    line: 0,
    position: 2,
  });

  const infoLineNode = createCSNode(TAGS.Info_line, ctx.generateId(), null);
  appendChild(infoLineNode, keyToken);
  appendChild(infoLineNode, valueToken);

  return infoLineNode;
}

function findKLine(tuneHeader: CSNode): { node: CSNode; prev: CSNode | null } | null {
  let prev: CSNode | null = null;
  let current = tuneHeader.firstChild;
  while (current !== null) {
    if (current.tag === TAGS.Info_line) {
      const keyChild = current.firstChild;
      if (keyChild !== null && isTokenNode(keyChild)) {
        if (getTokenData(keyChild).lexeme === "K:") {
          return { node: current, prev };
        }
      }
    }
    prev = current;
    current = current.nextSibling;
  }
  return null;
}
