// TypeScript port of midi2abc.js by marmooo
// (https://github.com/marmooo/midi2abc)
// Original license: MIT
//
// This port adds TypeScript types and replaces global mutable state with a
// ConversionContext object. The conversion logic is otherwise unchanged.

import { Note, Tempo, TimeSignature, NoteSequence, ConversionOptions, KeyLength, ConversionContext } from "./types";

function approximateKeyLength(duration: number): KeyLength {
  const base = 60;
  duration = Math.round(duration * 1e6) / 1e6;
  if (duration === base) return new KeyLength(1, 1, 0, 0);
  if (duration <= 0) {
    return new KeyLength(0, 0, 0, duration);
  }
  if (duration * 8 < base) {
    // abcjs does not support durations less than z/8
    return new KeyLength(0, 0, 0, duration);
  }
  let n = 2;
  if (duration > base) {
    // normal note
    while (duration / n > base) n *= 2;
    if (duration / n === base) return new KeyLength(n, 1, 0, 0);
    // dotted note
    n /= 2;
    let nearestDiff = duration / n - base;
    let nearestNumerator = n;
    let nearestDenominator = 1;
    for (let p = 2; p <= 16; p *= 2) {
      const q = 2 * p - 1;
      const k = (n * q) / p;
      const diff = round(duration / k, 1e6) - base;
      if (diff === 0) {
        if (k === Math.round(k)) {
          return new KeyLength(k, 1, 0, 0);
        } else {
          return new KeyLength(n * q, p, 0, 0);
        }
      } else if (0 < diff && diff < nearestDiff) {
        nearestDiff = diff;
        nearestNumerator = n * q;
        nearestDenominator = p;
      }
    }
    // tuplet (prime numbers only, max denominator 9 due to abcjs limitation)
    n *= 2;
    for (; n >= 1; n /= 2) {
      for (const i of [3, 5, 7]) {
        for (let j = 1; j <= i - 1; j++) {
          if ((duration / n) * (i / j) === base) {
            return new KeyLength(j, i, -n, 0);
          }
        }
      }
    }
    const diff = duration - (base * nearestNumerator) / nearestDenominator;
    return new KeyLength(nearestNumerator, nearestDenominator, 0, diff);
  } else {
    // normal note
    while (duration * n < base) n *= 2;
    if (duration * n === base) return new KeyLength(1, n, 0, 0);
    // dotted note
    let nearestDiff = duration * n - base;
    let nearestNumerator = 1;
    let nearestDenominator = n;
    for (let p = 2; p <= 16; p *= 2) {
      const q = 2 * p - 1;
      const k = q / (n * p);
      const diff = Math.abs(round(duration / k, 1e6) - base);
      if (diff === 0) {
        if (k === Math.round(k)) {
          return new KeyLength(k, 1, 0, 0);
        } else {
          return new KeyLength(q, n * p, 0, 0);
        }
      } else if (diff < nearestDiff) {
        nearestDiff = diff;
        nearestNumerator = q;
        nearestDenominator = n * p;
      }
    }
    // tuplet
    for (; n >= 1; n /= 2) {
      for (const i of [3, 5, 7]) {
        for (let j = 1; j <= i - 1; j++) {
          if (duration * n * (i / j) === base) {
            return new KeyLength(j, i, n, 0);
          }
        }
      }
    }
    const diff = duration - (base * nearestNumerator) / nearestDenominator;
    return new KeyLength(nearestNumerator, nearestDenominator, 0, diff);
  }
}

function calcKeyLength(keyLength: KeyLength): [string | null, string | null] {
  const n = keyLength.numerator;
  const d = keyLength.denominator;
  const f = keyLength.factor;
  if (n === 0) return [null, null];
  if (d === 1) {
    if (n === 1) return ["", ""];
    return ["", `${n}`];
  }
  if (f === 0) {
    if (n === 1) return ["", `/${d}`];
    return ["", `${n}/${d}`];
  }
  if (f > 0) {
    if (f === 1) return [`(${d}:${n}`, ""];
    return [`(${d}:${n}`, `/${f}`];
  } else {
    return [`(${d}:${n}`, `${-f}`];
  }
}

function noteToKeyString(note: Note): string {
  const pitch = note.pitch;
  const doremi = ["C", "^C", "D", "^D", "E", "F", "^F", "G", "^G", "A", "^A", "B"];
  const baseline = pitch - 60;
  const key = ((baseline % 12) + 12) % 12;
  const height = Math.floor(baseline / 12);
  if (height >= 1) {
    const count = height - 1;
    let keyString = doremi[key].toLowerCase();
    for (let i = 0; i < count; i++) {
      keyString += "'";
    }
    return keyString;
  } else {
    const count = -height;
    let keyString = doremi[key];
    for (let i = 0; i < count; i++) {
      keyString += ",";
    }
    return keyString;
  }
}

function getTupletString(len1: string, keyLength: KeyLength, ctx: ConversionContext): string {
  if (ctx.tupletCount === 0 && keyLength.factor !== 0) {
    ctx.tupletNum = keyLength.denominator;
    ctx.tupletCount += 1;
    return len1;
  } else if (ctx.tupletCount < ctx.tupletNum) {
    ctx.tupletCount += 1;
    if (ctx.tupletCount === ctx.tupletNum) {
      ctx.tupletCount = 0;
      ctx.tupletNum = 0;
    }
    return "";
  } else {
    return "";
  }
}

function round(x: number, epsilon: number): number {
  return Math.round(x * epsilon) / epsilon;
}

function fixIllegalDuration(
  chord: Note[],
  nextChord: Note[] | null,
  unitTime: number,
  keyLength: KeyLength,
  duration: number,
  ctx: ConversionContext
): string | undefined {
  const error = keyLength.error;
  if (error !== 0) {
    let abcString = "";
    if (keyLength.numerator / keyLength.denominator > 1) {
      const base = 60;
      const startTime = chord[0].startTime;
      const endTime = chord[0].endTime;
      const newDuration = (base * keyLength.numerator) / keyLength.denominator / unitTime;
      const t = chord[0].startTime + newDuration;
      chord.forEach((note) => {
        note.startTime = t;
      });
      const abc2 = chordToString(chord, nextChord, unitTime, ctx);
      chord.forEach((note) => {
        note.startTime = startTime;
        note.endTime = t;
      });
      if (abc2 === "") {
        chord.forEach((note) => (note.tie = false));
      } else {
        chord.forEach((note) => (note.tie = true));
      }
      const abc1 = chordToString(chord, null, unitTime, ctx);
      chord.forEach((note) => {
        note.endTime = endTime;
      });
      duration = round(duration, 1e6);
      return abc1 + abc2;
    } else if (nextChord) {
      const diff = error / unitTime;
      if (chord[0].endTime === nextChord[0].startTime) {
        nextChord.forEach((n) => (n.startTime -= diff));
      }
      chord.forEach((n) => (n.endTime -= diff));
      abcString += chordToString(chord, nextChord, unitTime, ctx);
      duration = round(duration, 1e6);
      return abcString;
    }
  }
  return undefined;
}

function noteToString(chord: Note[], nextChord: Note[] | null, unitTime: number, ctx: ConversionContext): string {
  const note = chord[0];
  const keyString = noteToKeyString(note);
  const duration = (note.endTime - note.startTime) * unitTime;
  const keyLength = approximateKeyLength(duration);
  if (keyLength.numerator === 0) return "";
  const abc = fixIllegalDuration(chord, nextChord, unitTime, keyLength, duration, ctx);
  if (abc) return abc;
  const [len1, len2] = calcKeyLength(keyLength);
  const tie = note.tie ? "-" : "";
  const tupletString = getTupletString(len1!, keyLength, ctx);
  return tupletString + keyString + len2 + tie;
}

function chordToString(chord: Note[], nextChord: Note[] | null, unitTime: number, ctx: ConversionContext): string {
  if (chord.length === 1 && !chord[0].splitted) {
    return noteToString(chord, nextChord, unitTime, ctx);
  } else {
    const str = chord
      .map((note) => {
        const tie = note.tie ? "-" : "";
        return noteToKeyString(note) + tie;
      })
      .join("");
    const n = chord[0];
    const duration = (n.endTime - n.startTime) * unitTime;
    const keyLength = approximateKeyLength(duration);
    if (keyLength.numerator === 0) return "";
    const abc = fixIllegalDuration(chord, nextChord, unitTime, keyLength, duration, ctx);
    if (abc) return abc;
    const [len1, len2] = calcKeyLength(keyLength);
    const tupletString = getTupletString(len1!, keyLength, ctx);
    return tupletString + `[${str}]` + len2;
  }
}

function splitRestDuration(duration: number): number[] {
  const base = 60;
  duration = Math.round(duration * 1e6) / 1e6;
  if (duration <= base) return [duration];
  const result: number[] = [];
  while (duration > 60) {
    let n = 2;
    while (duration / n > base) n *= 2;
    if (duration / n === base) {
      result.push(duration);
      return result;
    } else {
      const rest = n * 30;
      result.push(rest);
      duration -= rest;
    }
  }
  result.push(duration);
  return result;
}

function durationToRestString(startTime: number, endTime: number, unitTime: number, ctx: ConversionContext): string {
  if (startTime < endTime) {
    const duration = (endTime - startTime) * unitTime;
    let abc = "";
    splitRestDuration(duration).forEach((d) => {
      const keyLength = approximateKeyLength(d);
      const [len1, len2] = calcKeyLength(keyLength);
      if (len2 === null) return;
      const tupletString = getTupletString(len1!, keyLength, ctx);
      abc += tupletString + "z" + len2;
    });
    return abc;
  } else {
    return "";
  }
}

function chordToTieString(chord: Note[], nextChord: Note[] | null, unitTime: number, sectionLength: number, tempo: Tempo, ctx: ConversionContext): string {
  let abcString = "";
  const endTime = chord[0].endTime;
  chord.forEach((note) => (note.endTime = ctx.sectionEnd));
  if (round(ctx.sectionEnd, 1e13) === round(endTime, 1e13)) {
    chord.forEach((note) => (note.tie = false));
    abcString += chordToString(chord, nextChord, unitTime, ctx);
    abcString += "|";
    if (ctx.section % 4 === 0) abcString += "\n";
    ctx.section += 1;
    ctx.sectionEnd = tempo.time + ctx.section * sectionLength;
    return abcString;
  } else {
    chord.forEach((note) => (note.tie = true));
    abcString += chordToString(chord, nextChord, unitTime, ctx);
    abcString += "|";
    const count = Math.floor((endTime - chord[0].startTime) / sectionLength);
    if (ctx.section % 4 === 0) abcString += "\n";
    for (let i = 1; i < count; i++) {
      const nextSection = ctx.section + 1;
      const nextSectionEnd = tempo.time + nextSection * sectionLength;
      chord.forEach((note) => {
        note.startTime = ctx.sectionEnd;
        note.endTime = nextSectionEnd;
      });
      if (round(nextSectionEnd, 1e13) === round(endTime, 1e13)) {
        chord.forEach((note) => (note.tie = false));
        abcString += chordToString(chord, nextChord, unitTime, ctx);
        abcString += "|";
        if (nextSection % 4 === 0) abcString += "\n";
        ctx.section = nextSection;
        ctx.sectionEnd = nextSectionEnd;
        return abcString;
      } else {
        chord.forEach((note) => (note.tie = true));
        abcString += chordToString(chord, nextChord, unitTime, ctx);
        abcString += "|";
        if (nextSection % 4 === 0) abcString += "\n";
        ctx.section = nextSection;
        ctx.sectionEnd = nextSectionEnd;
      }
    }
    chord.forEach((note) => {
      note.startTime = ctx.sectionEnd;
      note.endTime = endTime;
      note.tie = false;
    });
    abcString += chordToString(chord, nextChord, unitTime, ctx);
    ctx.section += 1;
    ctx.sectionEnd = tempo.time + ctx.section * sectionLength;
    return abcString;
  }
}

function durationToRestStrings(startTime: number, endTime: number, tempo: Tempo, unitTime: number, sectionLength: number, ctx: ConversionContext): string {
  let abcString = "";
  if (round(ctx.sectionEnd, 1e13) <= round(endTime, 1e13)) {
    let prevSectionEnd = ctx.sectionEnd;
    if (round(startTime, 1e13) < round(ctx.sectionEnd, 1e13)) {
      abcString += durationToRestString(startTime, ctx.sectionEnd, unitTime, ctx);
      abcString += "|";
      if (ctx.section % 4 === 0) abcString += "\n";
      ctx.section += 1;
      ctx.sectionEnd = tempo.time + ctx.section * sectionLength;
      const count = Math.floor((endTime - prevSectionEnd) / sectionLength);
      for (let i = 0; i < count; i++) {
        abcString += durationToRestString(prevSectionEnd, ctx.sectionEnd, unitTime, ctx);
        abcString += "|";
        if (ctx.section % 4 === 0) abcString += "\n";
        ctx.section += 1;
        prevSectionEnd = ctx.sectionEnd;
        ctx.sectionEnd = tempo.time + ctx.section * sectionLength;
      }
      abcString += durationToRestString(prevSectionEnd, endTime, unitTime, ctx);
    } else {
      if (round(ctx.sectionEnd, 1e13) === round(startTime, 1e13)) {
        abcString += "|";
        if (ctx.section % 4 === 0) abcString += "\n";
        ctx.section += 1;
        ctx.sectionEnd = tempo.time + ctx.section * sectionLength;
      }
      if (round(endTime, 1e13) < round(ctx.sectionEnd, 1e13)) {
        abcString += durationToRestString(startTime, endTime, unitTime, ctx);
      } else {
        abcString += durationToRestString(startTime, ctx.sectionEnd, unitTime, ctx);
        abcString += "|";
        if (ctx.section % 4 === 0) abcString += "\n";
        ctx.section += 1;
        prevSectionEnd = ctx.sectionEnd;
        ctx.sectionEnd = ctx.section * sectionLength;
        const count = Math.floor((endTime - prevSectionEnd) / sectionLength);
        for (let i = 0; i < count; i++) {
          abcString += durationToRestString(prevSectionEnd, ctx.sectionEnd, unitTime, ctx);
          abcString += "|";
          if (ctx.section % 4 === 0) abcString += "\n";
          ctx.section += 1;
          prevSectionEnd = ctx.sectionEnd;
          ctx.sectionEnd = tempo.time + ctx.section * sectionLength;
        }
        abcString += durationToRestString(prevSectionEnd, endTime, unitTime, ctx);
      }
    }
  } else if (round(startTime, 1e13) < round(endTime, 1e13)) {
    abcString += durationToRestString(startTime, endTime, unitTime, ctx);
  }
  return abcString;
}

function cloneNote(note: Note): Note {
  return {
    instrument: note.instrument,
    program: note.program,
    startTime: note.startTime,
    endTime: note.endTime,
    pitch: note.pitch,
    velocity: note.velocity,
    isDrum: note.isDrum,
    tie: false,
    splitted: false,
  };
}

function getTargetPosition(ns: Note[], i: number): number {
  const endTime = ns[i].endTime;
  i += 1;
  while (ns[i] && ns[i].startTime < endTime) {
    i += 1;
  }
  return i;
}

function getNotationBreaks(ns: Note[]): number[] {
  const set = new Set<number>();
  ns.forEach((n) => {
    set.add(n.startTime);
    set.add(n.endTime);
  });
  const arr = [...set];
  arr.sort((a, b) => a - b);
  return arr.slice(1);
}

function getChord(ns: Note[]): Note[][] {
  let notes = ns;
  let i = 0;
  const result: Note[][] = [];
  while (notes[i]) {
    const j = getTargetPosition(notes, i);
    const target = notes.slice(i, j);
    const notationBreaks = getNotationBreaks(target);
    if (notationBreaks.length === 1) {
      result.push(target);
      i = j;
    } else {
      const endTime = notes[i].endTime;
      const targetBreaks = notationBreaks.filter((t) => t <= endTime);
      const chords = splitChord(target, targetBreaks);
      result.push(...chords);
      const nextTarget = target
        .filter((n) => endTime < n.endTime)
        .map((n) => {
          const newNote = cloneNote(n);
          newNote.startTime = endTime;
          newNote.splitted = true;
          return newNote;
        });
      notes = notes.slice(j);
      notes.unshift(...nextTarget);
      i = 0;
    }
  }
  return result;
}

function splitChord(chord: Note[], endTimes: number[]): Note[][] {
  const result: Note[][] = [];
  endTimes.forEach((endTime, i) => {
    if (i === 0) {
      const newChord: Note[] = [];
      const startTime = chord[0].startTime;
      chord.forEach((n) => {
        if (n.startTime === startTime) {
          const newNote = cloneNote(n);
          newNote.endTime = endTime;
          newNote.splitted = true;
          if (endTime < n.endTime) {
            newNote.tie = true;
          }
          newChord.push(newNote);
        }
      });
      result.push(newChord);
    } else {
      const startTime = endTimes[i - 1];
      const newChord: Note[] = [];
      chord.forEach((n) => {
        if (n.startTime <= startTime && endTime <= n.endTime) {
          const newNote = cloneNote(n);
          newNote.startTime = startTime;
          newNote.endTime = endTime;
          newNote.splitted = true;
          if (endTime < n.endTime) {
            newNote.tie = true;
          }
          newChord.push(newNote);
        }
      });
      result.push(newChord);
    }
  });
  result.forEach((c) => {
    c.sort((a, b) => {
      if (a.tie === b.tie) return 0;
      if (a.tie) return -1;
      return 1;
    });
  });
  return result;
}

function cleanupTimeSignatures(timeSignatures: TimeSignature[]): TimeSignature[] {
  const map = new Map<number, TimeSignature>();
  timeSignatures.forEach((ts) => {
    map.set(ts.time, ts);
  });
  const result: TimeSignature[] = [];
  for (const [, ts] of map) {
    result.push(ts);
  }
  return result;
}

function cleanupTempos(tempos: Tempo[], totalTime: number): Tempo[] {
  const map = new Map<number, number>();
  tempos.forEach((tempo) => {
    map.set(tempo.time, tempo.qpm);
  });
  const result: Tempo[] = [];
  for (const [time, qpm] of map) {
    result.push({ time, qpm, timeTo: totalTime });
  }
  if (result.length !== 1) {
    result.slice(0, -1).forEach((tempo, i) => {
      tempo.timeTo = result[i + 1].time;
    });
    result[result.length - 1].timeTo = totalTime;
  }
  return result;
}

function splitTempos(notes: Note[], tempos: Tempo[], totalTime: number): [Note[], Tempo][] {
  const result: [Note[], Tempo][] = [];
  const cleanedTempos = cleanupTempos(tempos, totalTime);
  if (cleanedTempos.length === 1) {
    return [[notes, cleanedTempos[0]]];
  }
  cleanedTempos.forEach((tempo, i) => {
    const tFrom = tempo.time;
    const tTo = tempo.timeTo;
    const filtered = notes.filter((n) => n.startTime < tTo).filter((n) => tFrom <= n.startTime);
    result.push([filtered, cleanedTempos[i]]);
  });
  return result;
}

function splitByChannel(notes: Note[]): Note[][] {
  const channelMap = new Map<number, Note[]>();
  notes.forEach((n) => {
    const ch = n.instrument;
    if (!channelMap.has(ch)) {
      channelMap.set(ch, []);
    }
    channelMap.get(ch)!.push(n);
  });
  return [...channelMap.values()];
}

function guessClef(ins: Note[]): string {
  const total = ins.reduce((sum, n) => sum + n.pitch, 0);
  const pitch = total / ins.length;
  return pitch > 64 ? "G2" : "F4";
}

function setInstrumentHeader(ins: Note[], instrumentId: number, unitLength: number, timeSignature: TimeSignature): string {
  const numerator = timeSignature.numerator;
  const denominator = timeSignature.denominator;
  return `L:1/${4 * unitLength}
M:${numerator}/${denominator}
K:C clef=${guessClef(ins)}
V:${instrumentId + 1}
%%MIDI program ${ins[0].program}
`;
}

function segmentToString(ns: NoteSequence, ins: Note[], instrumentId: number, tempo: Tempo, ctx: ConversionContext): string {
  if (ins.length === 0) return "";
  const timeSignatures = cleanupTimeSignatures(ns.timeSignatures);
  const timeSignature = timeSignatures.shift()!;
  const beat = timeSignature.numerator / timeSignature.denominator;
  const unitLength = beat < 0.75 ? 2 : 4;
  const unitTime = tempo.qpm * unitLength;
  const sectionLength = (240 / tempo.qpm) * beat;
  let abcString = setInstrumentHeader(ins, instrumentId, unitLength, timeSignature);
  ctx.section = 1;
  ctx.sectionEnd = tempo.time + ctx.section * sectionLength;

  const chords = getChord(ins);
  chords.forEach((chord, i) => {
    // TODO: irregular meter (reproduced from original notes)
    // start point shifts with long notes
    // if (timeSignature && chord[0].startTime >= timeSignature.time) {
    //   abcString += `\\\nM:${timeSignature.numerator}/${timeSignature.denominator}\n`;
    //   beat = timeSignature.numerator / timeSignature.denominator;
    //   sectionLength = 240 / tempo.qpm * beat;
    //   timeSignature = timeSignatures.shift();
    // }
    const nextChord = chords[i + 1] || null;
    if (i === 0 && chord[0].startTime !== tempo.time) {
      abcString += durationToRestStrings(tempo.time, chord[0].startTime, tempo, unitTime, sectionLength, ctx);
    }
    if (round(ctx.sectionEnd, 1e13) < round(chord[0].endTime, 1e13)) {
      abcString += chordToTieString(chord, nextChord, unitTime, sectionLength, tempo, ctx);
    } else {
      abcString += chordToString(chord, nextChord, unitTime, ctx);
    }
    if (nextChord) {
      abcString += durationToRestStrings(chord[0].endTime, nextChord[0].startTime, tempo, unitTime, sectionLength, ctx);
    } else {
      abcString += durationToRestStrings(chord[0].endTime, tempo.timeTo, tempo, unitTime, sectionLength, ctx);
      if (!abcString.endsWith("\n")) {
        abcString += "\n";
      }
    }
  });
  return abcString;
}

const HEADER_LINE = /^(?:[A-Za-z]:|%%)/;
const NOTE_PATTERN = /\^?([A-Ga-g])([,']*)|(\|)/g;

/**
 * Because the generator writes a sharp on the notes that need one and nothing
 * on the others, while ABC keeps an accidental in force until the end of the
 * bar for the same pitch, a natural note that follows a sharp of the same
 * pitch in a bar would be read as sharp. Because readers differ on whether an
 * accidental reaches the other octaves of the same letter (the editor's own
 * transforms treat it as reaching them), the `=` is also written in front of
 * the same letter in another octave. This walks every music line and writes
 * it, so that the pitches of the MIDI file are the pitches of the score under
 * either reading. The key is C major, so the default is natural.
 */
export function restateNaturals(abc: string): string {
  return abc
    .split("\n")
    .map((line) => {
      if (HEADER_LINE.test(line)) return line;
      const sharpened = new Set<string>();
      return line.replace(NOTE_PATTERN, (match: string, letter?: string, _marks?: string, bar?: string) => {
        if (bar) {
          sharpened.clear();
          return match;
        }
        const key = letter!.toUpperCase();
        if (match.startsWith("^")) {
          sharpened.add(key);
          return match;
        }
        if (sharpened.has(key)) {
          sharpened.delete(key);
          return "=" + match;
        }
        return match;
      });
    })
    .join("\n");
}

export function tone2abc(ns: NoteSequence, options?: ConversionOptions): string {
  let abcString = "X:1\n";
  if (options) {
    if (options.title) abcString += `T:${options.title}\n`;
    if (options.composer) abcString += `C:${options.composer}\n`;
  }
  // The notes keep the positions they have in the file, so that a first note
  // that starts after the beginning of the bar is preceded by a rest.

  const ctx: ConversionContext = {
    tupletNum: 0,
    tupletCount: 0,
    section: 0,
    sectionEnd: 0,
  };

  splitTempos(ns.notes, ns.tempos, ns.totalTime).forEach(([tns, tempo]) => {
    abcString += `Q:1/4=${Math.round(tempo.qpm)}\n`;
    splitByChannel(tns).forEach((ins, instrumentId) => {
      ctx.section = 0;
      abcString += segmentToString(ns, ins, instrumentId, tempo, ctx);
    });
  });
  return restateNaturals(abcString);
}
