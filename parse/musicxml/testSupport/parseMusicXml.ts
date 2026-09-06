import { JSDOM } from "jsdom";
import { IXmlElement, MusicSheetReader } from "opensheetmusicdisplay";

/**
 * Parses MusicXML text into an OSMD MusicSheet, for tests and for a future
 * convenience entry point. OSMD's internal reading code does `instanceof
 * Node`/`instanceof Element` checks against the bare global `Node`/`Element`
 * identifiers (not `window.Node`), so a jsdom window's own constructors are
 * not enough on their own outside a browser; they must be installed onto
 * Node.js's global object first. This mirrors what packages like
 * jsdom-global automate, done here directly to avoid an extra dependency.
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
