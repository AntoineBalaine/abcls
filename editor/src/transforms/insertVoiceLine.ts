import { cloneSubtree, appendChild, insertAfter, remove } from "abcls-cstree";
import { ABCContext, TT } from "abcls-parser";
import { createCSNode, CSNode, TAGS, isTokenNode, getTokenData } from "../csTree/types";
import { Selection } from "../selection";
import { addVoiceToHeader } from "./addVoice";
import {
  groupElementsBySourceLine,
  reassignIds,
  findTargetNote,
  nodeOrDescendantInSet,
  findTunesWithSelection,
  findHeaderOfTune,
  findBodyOfTune,
  isEolNode,
  createEolNode,
} from "./lineUtils";
import { noteToRest, chordToRest } from "./toRest";

/**
 * Inserts a new voice line by duplicating lines containing selected notes.
 * Non-selected notes are converted to rests, preserving rhythm.
 * If the voice ID doesn't exist in the header, it is added automatically.
 *
 * Because a document may contain several tunes, each tune that holds a selected node is
 * processed on its own, against its own header and its own body. A selection spanning two
 * tunes therefore inserts a voice line in both of them.
 */
export function insertVoiceLine(selection: Selection, voiceName: string, ctx: ABCContext): Selection {
  // Flatten all cursor sets into a single Set of selected node IDs
  const selectedIds = new Set<number>();
  for (const cursor of selection.cursors) {
    for (const id of cursor) {
      selectedIds.add(id);
    }
  }

  if (selectedIds.size === 0) {
    return selection;
  }

  const tunes = findTunesWithSelection(selection.root, selectedIds);
  if (tunes.length === 0) {
    return selection;
  }

  // Process the tunes from last to first, for the same reason we process lines from last to
  // first: an insertion must not shift the position of content not yet processed.
  for (let tuneIndex = tunes.length - 1; tuneIndex >= 0; tuneIndex--) {
    const tune = tunes[tuneIndex];

    const tuneBody = findBodyOfTune(tune);
    if (!tuneBody) continue;

    // Add the voice to this tune's own header if it declares no such voice
    const tuneHeader = findHeaderOfTune(tune);
    if (tuneHeader !== null && !voiceExistsInHeader(tuneHeader, voiceName)) {
      addVoiceToHeader(tuneHeader, voiceName, {}, ctx);
    }

    // Group Tune_Body children by their source line number
    const elementsByLine = groupElementsBySourceLine(tuneBody);

    // Find which source lines contain selected nodes
    const linesWithSelection = new Set<number>();
    for (const [lineNum, elements] of elementsByLine) {
      for (const elem of elements) {
        if (nodeOrDescendantInSet(elem, selectedIds)) {
          linesWithSelection.add(lineNum);
          break;
        }
      }
    }

    // Sort line numbers in descending order to process from end to start
    const sortedLines = Array.from(linesWithSelection).sort((a, b) => b - a);

    // Process each line that has selections
    for (const lineNum of sortedLines) {
      const elements = elementsByLine.get(lineNum);
      if (!elements || elements.length === 0) continue;

      // Clone all elements on this line using cloneSubtree (preserves IDs for now, reassigned later)
      const clonedElements: CSNode[] = elements.map((e) => cloneSubtree(e, () => e.id, true));

      // Build a temporary container to hold the chain during processing
      const tempContainer = createCSNode(TAGS.System, -1, null);

      // Build the cloned chain: voice marker, space, then cloned elements
      const voiceMarker = createInlineVoiceMarker(voiceName, ctx);
      const spaceAfterMarker = createCSNode(TAGS.Token, ctx.generateId(), {
        lexeme: " ",
        tokenType: TT.WS,
        line: 0,
        position: 0,
      });

      // Link nodes into temp container using appendChild
      appendChild(tempContainer, voiceMarker);
      appendChild(tempContainer, spaceAfterMarker);
      for (const cloned of clonedElements) {
        appendChild(tempContainer, cloned);
      }

      // Remove grace groups before non-selected notes (must be done before note-to-rest conversion)
      removeUnselectedGraceGroups(spaceAfterMarker, selectedIds);

      // Process cloned elements: convert non-selected to rests
      let processNode: CSNode | null = spaceAfterMarker.nextSibling;
      while (processNode !== null) {
        processElementForVoiceInsert(processNode, selectedIds, ctx);
        processNode = processNode.nextSibling;
      }

      // Reassign IDs to voice marker, space, and all cloned elements
      reassignIds(voiceMarker, ctx);
      spaceAfterMarker.id = ctx.generateId();
      for (const cloned of clonedElements) {
        reassignIds(cloned, ctx);
      }

      // Insert the chain after the last original element on this line.
      // Detach all nodes from the temp container and insert them after lastOriginal.
      const lastOriginal = elements[elements.length - 1];
      let insertAnchor: CSNode = lastOriginal;

      // In every tune but the last, the newline terminating the line is not part of the tune
      // body, so the clone carries none either. We open a new line ahead of the clone rather
      // than terminating it, because the newline that closes the inserted line already sits
      // outside the tune body.
      if (!isEolNode(lastOriginal)) {
        const eol = createEolNode(ctx);
        insertAfter(insertAnchor, eol);
        insertAnchor = eol;
      }

      let toMove = tempContainer.firstChild;
      while (toMove !== null) {
        const next = toMove.nextSibling;
        remove(toMove);
        insertAfter(insertAnchor, toMove);
        insertAnchor = toMove;
        toMove = next;
      }
    }
  }

  return selection;
}

/**
 * Creates an inline voice marker [V:name] as an Inline_field CSNode.
 */
function createInlineVoiceMarker(voiceName: string, ctx: ABCContext): CSNode {
  const leftBracket = createCSNode(TAGS.Token, ctx.generateId(), {
    lexeme: "[",
    tokenType: TT.INLN_FLD_LFT_BRKT,
    line: 0,
    position: 0,
  });

  const field = createCSNode(TAGS.Token, ctx.generateId(), {
    lexeme: "V:",
    tokenType: TT.INF_HDR,
    line: 0,
    position: 1,
  });

  const text = createCSNode(TAGS.Token, ctx.generateId(), {
    lexeme: voiceName,
    tokenType: TT.INFO_STR,
    line: 0,
    position: 3,
  });

  const rightBracket = createCSNode(TAGS.Token, ctx.generateId(), {
    lexeme: "]",
    tokenType: TT.INLN_FLD_RGT_BRKT,
    line: 0,
    position: 3 + voiceName.length,
  });

  const inlineField = createCSNode(TAGS.Inline_field, ctx.generateId(), null);
  appendChild(inlineField, leftBracket);
  appendChild(inlineField, field);
  appendChild(inlineField, text);
  appendChild(inlineField, rightBracket);

  return inlineField;
}

/**
 * Checks if a chord has any notes whose IDs are in the selected set.
 */
function chordHasSelectedNotes(chord: CSNode, selectedIds: Set<number>): boolean {
  let child = chord.firstChild;
  while (child !== null) {
    if (child.tag === TAGS.Note && selectedIds.has(child.id)) {
      return true;
    }
    child = child.nextSibling;
  }
  return false;
}

/**
 * Removes notes from a chord that are not in the selected set.
 */
function removeUnselectedNotesFromChord(chord: CSNode, selectedIds: Set<number>): void {
  let current = chord.firstChild;

  while (current !== null) {
    const next = current.nextSibling;

    if (current.tag === TAGS.Note && !selectedIds.has(current.id)) {
      remove(current);
    }

    current = next;
  }
}

/**
 * Checks if a voice with the given ID is declared in the given tune header.
 */
function voiceExistsInHeader(tuneHeader: CSNode, voiceId: string): boolean {
  let current = tuneHeader.firstChild;
  while (current !== null) {
    if (current.tag === TAGS.Info_line) {
      const keyChild = current.firstChild;
      if (keyChild !== null && isTokenNode(keyChild)) {
        const keyData = getTokenData(keyChild);
        if (keyData.lexeme === "V:") {
          // Check if this voice line declares the voiceId
          const valueChild = keyChild.nextSibling;
          if (valueChild !== null) {
            const declaredId = extractVoiceIdFromValueChild(valueChild);
            if (declaredId === voiceId) {
              return true;
            }
          }
        }
      }
    }
    current = current.nextSibling;
  }

  return false;
}

/**
 * Extracts the voice ID from a value child node.
 * Because the CSTree may contain KV expressions (from value2 preservation),
 * we need to handle both token and KV cases.
 */
function extractVoiceIdFromValueChild(valueChild: CSNode): string | null {
  // Handle token children (legacy format or simple values)
  if (isTokenNode(valueChild)) {
    const lexeme = getTokenData(valueChild).lexeme.trim();
    const firstWord = lexeme.split(/\s+/)[0];
    return firstWord || null;
  }

  // Handle KV expression children (new format with value2)
  // For voice IDs like "ExistingVoice" in "V:ExistingVoice", the KV has just a value.
  if (valueChild.tag === TAGS.KV) {
    let child = valueChild.firstChild;
    let lastChild: CSNode | null = null;
    while (child) {
      lastChild = child;
      child = child.nextSibling;
    }
    if (lastChild && isTokenNode(lastChild)) {
      return getTokenData(lastChild).lexeme.trim();
    }
  }

  return null;
}

/**
 * Removes grace groups whose target notes are not selected.
 * Must be called before note-to-rest conversion because it examines the original IDs.
 * Also recursively handles grace groups inside Beam/Tuplet containers.
 */
function removeUnselectedGraceGroups(startNode: CSNode, selectedIds: Set<number>): void {
  let current = startNode.nextSibling;

  while (current !== null) {
    const next = current.nextSibling;

    if (current.tag === TAGS.Grace_group) {
      const targetNote = findTargetNote(current);
      let shouldRemove = false;

      if (targetNote === null) {
        shouldRemove = false;
      } else if (targetNote.tag === TAGS.Rest) {
        shouldRemove = true;
      } else if (targetNote.tag === TAGS.Note) {
        shouldRemove = !selectedIds.has(targetNote.id);
      } else if (targetNote.tag === TAGS.Chord) {
        shouldRemove = !chordHasSelectedNotes(targetNote, selectedIds);
      }

      if (shouldRemove) {
        remove(current);
        current = next;
        continue;
      }
    } else if (current.tag === TAGS.Beam || current.tag === TAGS.Tuplet) {
      // Recursively handle grace groups inside containers
      removeUnselectedGraceGroupsInContainer(current, selectedIds);
    }

    current = next;
  }
}

function removeUnselectedGraceGroupsInContainer(container: CSNode, selectedIds: Set<number>): void {
  let current = container.firstChild;
  while (current !== null) {
    const next = current.nextSibling;
    if (current.tag === TAGS.Grace_group) {
      const targetNote = findTargetNote(current);
      let shouldRemove = false;
      if (targetNote === null) {
        shouldRemove = false;
      } else if (targetNote.tag === TAGS.Rest) {
        shouldRemove = true;
      } else if (targetNote.tag === TAGS.Note) {
        shouldRemove = !selectedIds.has(targetNote.id);
      } else if (targetNote.tag === TAGS.Chord) {
        shouldRemove = !chordHasSelectedNotes(targetNote, selectedIds);
      }
      if (shouldRemove) {
        remove(current);
      }
    } else if (current.tag === TAGS.Beam || current.tag === TAGS.Tuplet) {
      removeUnselectedGraceGroupsInContainer(current, selectedIds);
    }
    current = next;
  }
}

/**
 * Processes a single element for voice insertion.
 * Converts non-selected notes to rests and handles chords.
 * Grace groups should be removed before calling this function.
 */
function processElementForVoiceInsert(node: CSNode, selectedIds: Set<number>, ctx: ABCContext): void {
  if (node.tag === TAGS.Note) {
    if (!selectedIds.has(node.id)) {
      noteToRest(node, ctx);
    }
  } else if (node.tag === TAGS.Chord) {
    if (!chordHasSelectedNotes(node, selectedIds)) {
      chordToRest(node, ctx);
    } else {
      removeUnselectedNotesFromChord(node, selectedIds);
    }
  } else if (node.tag === TAGS.Grace_group) {
    // Grace groups are handled by removeUnselectedGraceGroups; skip here
    return;
  }

  // Recurse into children (for Beam, Tuplet, etc.)
  let child = node.firstChild;
  while (child !== null) {
    processElementForVoiceInsert(child, selectedIds, ctx);
    child = child.nextSibling;
  }
}
