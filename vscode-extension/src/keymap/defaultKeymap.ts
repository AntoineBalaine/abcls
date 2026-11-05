/**
 * The default keymap of the select and transform menus.
 *
 * The keys are in the notation of notation.ts. Both menus also hold the mode switches
 * (< and > and Tab), which are leaves of kind "mode".
 */

import { ArgTemplate, CountTemplate, Group, Keymap, Leaf } from "./types";

function count(defaultValue: number, multiplier: number): CountTemplate {
  return { count: { default: defaultValue, multiplier } };
}

function leaf(
  label: string,
  category: string,
  kind: Leaf["action"]["kind"],
  name: string,
  args: ArgTemplate[],
  extra?: { short?: string; isNew?: boolean }
): Leaf {
  return { type: "leaf", label, category, action: { kind, name, args }, ...(extra ?? {}) };
}

function group(label: string, category: string, children: Group["children"], short?: string): Group {
  return { type: "group", label, category, children, ...(short ? { short } : {}) };
}

export const DEFAULT_KEYMAP: Keymap = {
  select: group("select", "selectType", {
    "<": leaf("go to select mode", "mode", "mode", "select", [], { short: "to select" }),
    ">": leaf("go to transform mode", "mode", "mode", "transform", [], { short: "to transform" }),
    "<tab>": leaf("switch mode", "mode", "mode", "toggle", []),
    "1": leaf("top note (same as t)", "selectPosition", "selector", "selectNthFromTop", [0], { short: "top (as t)" }),
    "2": leaf("2nd from top", "selectPosition", "selector", "selectNthFromTop", [1]),
    "3": leaf("3rd from top", "selectPosition", "selector", "selectNthFromTop", [2]),
    "4": leaf("4th from top", "selectPosition", "selector", "selectNthFromTop", [3]),
    "5": leaf("5th from top", "selectPosition", "selector", "selectNthFromTop", [4]),
    "6": leaf("6th from top", "selectPosition", "selector", "selectNthFromTop", [5]),
    "7": leaf("7th from top", "selectPosition", "selector", "selectNthFromTop", [6]),
    "8": leaf("8th from top", "selectPosition", "selector", "selectNthFromTop", [7]),
    "9": leaf("9th from top", "selectPosition", "selector", "selectNthFromTop", [8]),
    c: leaf("chords", "selectType", "selector", "selectChords", []),
    n: leaf("notes", "selectType", "selector", "selectNotes", []),
    N: leaf("non-chord notes", "selectType", "selector", "selectNonChordNotes", [], { short: "non-chord" }),
    C: leaf("chord notes", "selectType", "selector", "selectChordNotes", []),
    z: leaf("rests", "selectType", "selector", "selectRests", []),
    A: leaf("annotations", "selectType", "selector", "selectAnnotations", [], { isNew: true }),
    r: leaf("rhythm", "selectRhythm", "selector", "selectRhythm", []),
    R: leaf("rhythm parents", "selectRhythm", "selector", "selectRhythmParent", [], { short: "rhythm parent" }),
    x: leaf("tune", "selectStructure", "selector", "selectTune", []),
    m: leaf("measures", "selectStructure", "selector", "selectMeasures", []),
    s: leaf("system", "selectStructure", "selector", "selectSystem", []),
    v: leaf("voices (prompts for ids)", "selectStructure", "command", "abc.selectVoices", [], { short: "voices…" }),
    u: leaf("undo", "history", "command", "undo", [], { isNew: true }),
    t: leaf("top note", "selectPosition", "selector", "selectTop", []),
    T: leaf("all but top", "selectPosition", "selector", "selectAllButTop", []),
    b: leaf("bottom note", "selectPosition", "selector", "selectBottom", []),
    B: leaf("all but bottom", "selectPosition", "selector", "selectAllButBottom", []),
    i: group("inside…", "selectDelimiter", {
      c: leaf("inside chord", "selectDelimiter", "selector", "selectInsideChord", []),
      g: leaf("inside grace group", "selectDelimiter", "selector", "selectInsideGraceGroup", [], { short: "in. grace" }),
      f: leaf("inside inline field", "selectDelimiter", "selector", "selectInsideInlineField", [], { short: "in. field" }),
      p: leaf("inside grouping", "selectDelimiter", "selector", "selectInsideGrouping", [], { short: "in. group" }),
    }),
    a: group("around…", "selectDelimiter", {
      c: leaf("around chord", "selectDelimiter", "selector", "selectAroundChord", []),
      g: leaf("around grace group", "selectDelimiter", "selector", "selectAroundGraceGroup", [], { short: "around grace" }),
      f: leaf("around inline field", "selectDelimiter", "selector", "selectAroundInlineField", [], { short: "around field" }),
      p: leaf("around grouping", "selectDelimiter", "selector", "selectAroundGrouping", [], { short: "around group" }),
    }),
  }),
  transform: group("transform", "pitch", {
    "<": leaf("go to select mode", "mode", "mode", "select", [], { short: "to select" }),
    ">": leaf("go to transform mode", "mode", "mode", "transform", [], { short: "to transform" }),
    "<tab>": leaf("switch mode", "mode", "mode", "toggle", []),
    t: leaf("octave up", "pitch", "transform", "transpose", [count(1, 12)]),
    T: leaf("octave down", "pitch", "transform", "transpose", [count(1, -12)]),
    "<c-up>": leaf("octave up", "pitch", "transform", "transpose", [count(1, 12)]),
    "<c-down>": leaf("octave down", "pitch", "transform", "transpose", [count(1, -12)]),
    "+": leaf("semitone up", "pitch", "transform", "transpose", [count(1, 1)]),
    "-": leaf("semitone down", "pitch", "transform", "transpose", [count(1, -1)]),
    "<c-S-up>": leaf("harmonize octave up", "harmony", "transform", "harmonize", [count(1, 7)], { short: "harm. 8ve up" }),
    "<c-S-down>": leaf("harmonize octave down", "harmony", "transform", "harmonize", [count(1, -7)], { short: "harm. 8ve down" }),
    "<a-t>": leaf("harmonize octave up", "harmony", "transform", "harmonize", [count(1, 7)], { short: "harm. 8ve up" }),
    "<a-T>": leaf("harmonize octave down", "harmony", "transform", "harmonize", [count(1, -7)], { short: "harm. 8ve down" }),
    p: leaf("harmonize up (diatonic)", "harmony", "transform", "harmonize", [count(1, 1)], { short: "harm. up" }),
    P: leaf("harmonize down (diatonic)", "harmony", "transform", "harmonize", [count(1, -1)], { short: "harm. down" }),
    a: leaf("add sharp", "accidental", "transform", "addSharp", []),
    A: leaf("add flat", "accidental", "transform", "addFlat", []),
    e: leaf("enharmonize", "accidental", "transform", "enharmonize", [], { short: "enharm." }),
    E: leaf("enharmonize to key", "accidental", "transform", "enharmonizeToKey", [], { short: "enharm. key" }),
    "*": leaf("multiply length", "rhythm", "transform", "multiplyRhythm", [count(2, 1)], { short: "multiply" }),
    "/": leaf("divide length", "rhythm", "transform", "divideRhythm", [count(2, 1)]),
    r: leaf("to rest", "rest", "transform", "toRest", []),
    R: leaf("consolidate rests", "rest", "transform", "consolidateRests", [], { short: "merge rests" }),
    l: leaf("legato (extend through rests)", "rest", "transform", "legato", [], { short: "legato" }),
    v: leaf("V:1 to [V:1]", "voice", "transform", "voiceInfoLineToInline", [], { short: "V: to [V:]" }),
    V: leaf("[V:1] to V:1", "voice", "transform", "voiceInlineToInfoLine", [], { short: "[V:] to V:" }),
    o: leaf("add voice (prompts)", "voice", "command", "abc.addVoice", [], { short: "add voice…" }),
    O: leaf("insert voice line (prompts)", "voice", "command", "abc.insertVoiceLine", [], { short: "voice line…" }),
    x: leaf("explode chords", "voice", "transform", "explode", [count(2, 1)], { short: "explode" }),
    "(": leaf("wrap crescendo", "dynamics", "command", "abc.wrapCrescendo", [], { short: "cresc.", isNew: true }),
    ")": leaf("wrap decrescendo", "dynamics", "command", "abc.wrapDecrescendo", [], { short: "decresc.", isNew: true }),
    h: leaf("close voicing, 4 voices", "voicing", "transform", "harmonizeVoicing", ["close", 4, null], { short: "close, 4" }),
    H: leaf("close voicing, 5 voices", "voicing", "transform", "harmonizeVoicing", ["close", 5, null], { short: "close, 5" }),
    "<a-h>": leaf("close voicing, 6 voices", "voicing", "transform", "harmonizeVoicing", ["close", 6, null], { short: "close, 6" }),
    g: group(
      "voicing menu… (count = voices)",
      "voicing",
      {
        "2": leaf("drop 2 (revoices chords)", "voicing", "transform", "dropVoicing", ["drop2"], { short: "drop 2" }),
        "3": leaf("drop 3 (revoices chords)", "voicing", "transform", "dropVoicing", ["drop3"], { short: "drop 3" }),
        "4": leaf("drop 2-4 (revoices chords)", "voicing", "transform", "dropVoicing", ["drop24"], { short: "drop 2-4" }),
        c: leaf("close voicing", "voicing", "transform", "harmonizeVoicing", ["close", count(4, 1), null]),
        k: leaf("cluster voicing", "voicing", "transform", "harmonizeVoicing", ["cluster", count(4, 1), null]),
        s: leaf("spread voicing", "voicing", "transform", "harmonizeVoicing", ["spread", count(4, 1), null], { isNew: true }),
      },
      "voicings ›"
    ),
    y: leaf("parallel diatonic //<-prev", "parallel", "transform", "parallelVoicing", ["prev", "diatonic"], { short: "diat //<-prev" }),
    Y: leaf("parallel diatonic //->next", "parallel", "transform", "parallelVoicing", ["next", "diatonic"], { short: "diat //->next" }),
    "{": leaf("parallel chromatic //<-prev", "parallel", "transform", "parallelVoicing", ["prev", "chromatic"], { short: "chrom //<-prev" }),
    "<a-Y>": leaf("parallel chromatic //->next", "parallel", "transform", "parallelVoicing", ["next", "chromatic"], { short: "chrom //->next" }),
    s: leaf("split system at cursor", "layout", "command", "abc.splitSystem", [], { short: "split system", isNew: true }),
    j: leaf("join system with next", "layout", "command", "abc.joinSystems", [], { short: "join system", isNew: true }),
    i: leaf("interleave voices", "layout", "command", "abc.interleaveVoices", [], { short: "interleave", isNew: true }),
    u: leaf("undo", "history", "command", "undo", [], { isNew: true }),
    m: leaf("export to MIDI", "io", "command", "abc.exportToMidi", [], { short: "to MIDI" }),
    M: leaf("import from MIDI (prompts)", "io", "command", "abc.importFromMidi", [], { short: "from MIDI…" }),
  }),
};
