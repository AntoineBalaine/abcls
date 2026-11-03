import { JSDOM } from "jsdom";
import { IXmlElement, MusicSheetReader } from "opensheetmusicdisplay";

/**
 * Parses MusicXML text into an OSMD MusicSheet, for the xml2abc command and
 * for the tests. OSMD's internal reading code does `instanceof
 * Node`/`instanceof Element` checks against the bare global `Node`/`Element`
 * identifiers (not `window.Node`), so a jsdom window's own constructors are
 * not enough on their own outside a browser; they must be installed onto
 * Node.js's global object first. This mirrors what packages like
 * jsdom-global automate, done here directly to avoid an extra dependency.
 *
 * Because OSMD fails with a TypeError on a <part> that the <part-list> does
 * not declare, the parts are checked first, and such a document throws an
 * Error that names the part.
 */
export function parseMusicXmlToSheet(xml: string) {
  const dom = new JSDOM();
  const g = globalThis as unknown as Record<string, unknown>;
  const previous: Record<string, unknown> = {};
  const globalNames = ["Node", "Element", "Document", "DOMParser", "XMLDocument", "Attr"];
  for (const name of globalNames) {
    previous[name] = g[name];
    g[name] = (dom.window as unknown as Record<string, unknown>)[name];
  }
  try {
    const doc = new dom.window.DOMParser().parseFromString(xml, "text/xml");
    const mismatch = findUndeclaredPart(doc);
    if (mismatch !== null) throw new Error(mismatch);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const root = new IXmlElement(doc.documentElement as any);
    const reader = new MusicSheetReader();
    return reader.createMusicSheet(root, "test.xml");
  } finally {
    for (const name of globalNames) {
      g[name] = previous[name];
    }
  }
}

/**
 * Returns a message for the first <part> that has no id, or whose id no <score-part> of the <part-list> declares,
 * or null when every part is declared. MusicXML links each part to its declaration through that id.
 */
export function findUndeclaredPart(doc: Document): string | null {
  const declared = new Set<string>();
  for (const scorePart of Array.from(doc.getElementsByTagName("score-part"))) {
    const id = scorePart.getAttribute("id");
    if (id !== null) declared.add(id);
  }
  const parts = Array.from(doc.getElementsByTagName("part"));
  for (let index = 0; index < parts.length; index++) {
    const id = parts[index].getAttribute("id");
    if (id === null) return `MusicXML <part> number ${index + 1} has no id attribute, so it cannot be matched to a <score-part> of the <part-list>.`;
    if (!declared.has(id)) return `MusicXML <part id="${id}"> has no <score-part id="${id}"> in the <part-list>.`;
  }
  return null;
}
