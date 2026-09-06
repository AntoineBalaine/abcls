import { ScorePartwiseIR, PartListEntryIR, PartIR, MeasureIR, NoteIR, AttributesIR } from "./ir";

interface XmlNode {
  tag: string;
  attrs?: Record<string, string | number>;
  children?: XmlNode[];
  text?: string;
}

function el(tag: string, attrs?: Record<string, string | number | boolean | undefined>, children?: Array<XmlNode | undefined>): XmlNode {
  const cleanAttrs: Record<string, string | number> = {};
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined) continue;
      cleanAttrs[k] = typeof v === "boolean" ? (v ? "yes" : "no") : v;
    }
  }
  const cleanChildren = children?.filter((c): c is XmlNode => c !== undefined);
  return {
    tag,
    attrs: Object.keys(cleanAttrs).length ? cleanAttrs : undefined,
    children: cleanChildren && cleanChildren.length ? cleanChildren : undefined,
  };
}

function textEl(tag: string, text: string | number, attrs?: Record<string, string | number | boolean | undefined>): XmlNode {
  return { ...el(tag, attrs), text: String(text) };
}

export function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}

function serializeNode(node: XmlNode, indent: string): string {
  const attrString = node.attrs
    ? Object.entries(node.attrs)
        .map(([k, v]) => ` ${k}="${escapeAttr(String(v))}"`)
        .join("")
    : "";
  if (node.text !== undefined) {
    return `${indent}<${node.tag}${attrString}>${escapeText(node.text)}</${node.tag}>`;
  }
  if (!node.children || node.children.length === 0) {
    return `${indent}<${node.tag}${attrString}/>`;
  }
  const childLines = node.children.map((c) => serializeNode(c, indent + "  ")).join("\n");
  return `${indent}<${node.tag}${attrString}>\n${childLines}\n${indent}</${node.tag}>`;
}

function buildPartListXml(entries: PartListEntryIR[]): XmlNode {
  const children = entries.map((entry) => {
    if (entry.kind === "score-part") {
      return el("score-part", { id: entry.part.id }, [textEl("part-name", entry.part.name || entry.part.id)]);
    }
    const b = entry.boundary;
    if (b.kind === "start") {
      return el("part-group", { number: b.number, type: "start" }, [
        b.symbol ? textEl("group-symbol", b.symbol) : undefined,
        b.barlineGroup !== undefined ? textEl("group-barline", b.barlineGroup ? "yes" : "no") : undefined,
      ]);
    }
    return el("part-group", { number: b.number, type: "stop" });
  });
  return el("part-list", undefined, children);
}

function buildAttributesXml(attrs: AttributesIR): XmlNode {
  const children: Array<XmlNode | undefined> = [];
  if (attrs.divisions !== undefined) children.push(textEl("divisions", attrs.divisions));
  if (attrs.keyFifths !== undefined) {
    children.push(el("key", undefined, [textEl("fifths", attrs.keyFifths), attrs.keyMode ? textEl("mode", attrs.keyMode) : undefined]));
  }
  if (attrs.timeBeats !== undefined && attrs.timeBeatType !== undefined) {
    children.push(el("time", { symbol: attrs.timeSymbol }, [textEl("beats", attrs.timeBeats), textEl("beat-type", attrs.timeBeatType)]));
  }
  if (attrs.clefSign !== undefined) {
    children.push(
      el("clef", undefined, [
        textEl("sign", attrs.clefSign),
        attrs.clefLine !== undefined ? textEl("line", attrs.clefLine) : undefined,
        attrs.clefOctaveChange !== undefined ? textEl("clef-octave-change", attrs.clefOctaveChange) : undefined,
      ])
    );
  }
  return el("attributes", undefined, children);
}

function buildNotationsXml(note: NoteIR): XmlNode | undefined {
  const n = note.notations;
  const children: Array<XmlNode | undefined> = [];
  if (note.tieStop) children.push(el("tied", { type: "stop" }));
  if (note.tieStart) children.push(el("tied", { type: "start" }));
  if (n?.slurStarts) for (const num of n.slurStarts) children.push(el("slur", { type: "start", number: num }));
  if (n?.slurStops) for (const num of n.slurStops) children.push(el("slur", { type: "stop", number: num }));
  if (n?.ornaments && n.ornaments.length) children.push(el("ornaments", undefined, n.ornaments.map((o) => el(o))));
  if (n?.technical && n.technical.length) children.push(el("technical", undefined, n.technical.map((t) => el(t))));
  if (n?.articulations && n.articulations.length) children.push(el("articulations", undefined, n.articulations.map((a) => el(a))));
  if (n?.fermata) children.push(el("fermata", n.fermata === "inverted" ? { type: "inverted" } : undefined));
  const present = children.filter((c): c is XmlNode => c !== undefined);
  return present.length ? el("notations", undefined, present) : undefined;
}

function buildNoteXml(note: NoteIR): XmlNode {
  if (note.kind === "backup" || note.kind === "forward") {
    return el(note.kind, undefined, [textEl("duration", note.duration!)]);
  }
  const children: Array<XmlNode | undefined> = [];
  if (note.grace) children.push(el("grace", { slash: note.grace.slash ? "yes" : undefined }));
  if (note.chord) children.push(el("chord"));
  if (note.pitch) {
    children.push(
      el("pitch", undefined, [
        textEl("step", note.pitch.step),
        note.pitch.alter !== undefined ? textEl("alter", note.pitch.alter) : undefined,
        textEl("octave", note.pitch.octave),
      ])
    );
  } else if (note.rest) {
    children.push(el("rest"));
  }
  if (note.duration !== undefined) children.push(textEl("duration", note.duration));
  if (note.tieStop) children.push(el("tie", { type: "stop" }));
  if (note.tieStart) children.push(el("tie", { type: "start" }));
  if (note.voice !== undefined) children.push(textEl("voice", note.voice));
  const notations = buildNotationsXml(note);
  if (notations) children.push(notations);
  return el("note", undefined, children);
}

function buildMeasureXml(measure: MeasureIR): XmlNode {
  const children: Array<XmlNode | undefined> = [];
  if (measure.attributes) children.push(buildAttributesXml(measure.attributes));
  for (const note of measure.content) children.push(buildNoteXml(note));
  return el("measure", { number: measure.number }, children);
}

function buildPartXml(part: PartIR): XmlNode {
  return el(
    "part",
    { id: part.id },
    part.measures.map(buildMeasureXml)
  );
}

export function serializeScorePartwise(ir: ScorePartwiseIR): string {
  const root = el("score-partwise", { version: "4.0" }, [buildPartListXml(ir.partList), ...ir.parts.map(buildPartXml)]);
  const doctype =
    '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">';
  return doctype + "\n" + serializeNode(root, "");
}
