/**
 * svg-renderer.ts
 *
 * Module for rendering ABC notation to SVG strings using abcjs.
 * Because abcjs requires a DOM environment, we use svgdom to provide one in Node.js.
 * svgdom is a lightweight DOM implementation with SVG support including getBBox().
 *
 * Note: svgdom's getBBox() has ~15% deviation from browser values, which may cause
 * minor positioning issues with text and path elements.
 *
 * Because all formatting should come from ABC directives (%%staffwidth, %%scale, etc.),
 * we don't expose rendering options. The renderer only controls technical defaults
 * like padding and responsive SVG mode.
 */

import { styleChordSymbols } from "./svg-chords";

/**
 * Result of SVG rendering
 */
export interface SvgRenderResult {
  /**
   * Array of SVG strings, one per tune
   */
  svgs: string[];

  /**
   * The same SVG strings grouped by tune, so that a caller can tell where each tune starts.
   * With the oneSvgPerLine option, a tune holds one SVG per line of music.
   */
  tunes: string[][];

  /**
   * Metadata about the rendering
   */
  metadata: {
    tuneCount: number;
    warnings?: string[];
  };
}

/**
 * Custom error class for SVG rendering failures
 */
export class SvgRenderError extends Error {
  constructor(
    message: string,
    public readonly details: string,
    public readonly helpText: string
  ) {
    super(message);
    this.name = "SvgRenderError";
  }

  toString(): string {
    return `${this.message}\n\nDetails: ${this.details}\n\n${this.helpText}`;
  }
}

/**
 * Load svgdom lazily and provide helpful error messages if it fails
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadSvgdom(): Promise<{ createHTMLWindow: () => any }> {
  try {
    return await import("svgdom");
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new SvgRenderError(
      "Failed to load SVG rendering library.",
      msg,
      `This usually means the 'svgdom' package is not installed or failed to build.
If you installed abcls globally, try reinstalling:
  npm uninstall -g abcls && npm install -g abcls

If you're running from source:
  cd <path-to-abcls>/abc-cli && npm install`
    );
  }
}

/**
 * Load abcjs lazily
 */
async function loadAbcjs(): Promise<typeof import("abcjs")> {
  try {
    const loaded = await import("abcjs");
    // Because abcjs is a CommonJS package, its API sits under "default" when it is loaded with import(),
    // and a namespace without "renderAbc" made every render fail. Therefore we use "default" when it exists.
    return ((loaded as { default?: typeof import("abcjs") }).default ?? loaded) as typeof import("abcjs");
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new SvgRenderError(
      "Failed to load ABC rendering library.",
      msg,
      `This usually means the 'abcjs' package is not installed.
If you installed abcls globally, try reinstalling:
  npm uninstall -g abcls && npm install -g abcls

If you're running from source:
  cd <path-to-abcls>/abc-cli && npm install`
    );
  }
}

/**
 * Gives the nodes of the fake DOM a parentElement property.
 *
 * Because svgdom only implements parentNode, and abcjs removes an empty group with
 * "group.parentElement.removeChild(group)", any score that produced an empty group (a staff
 * with slash notation or an annotation, for example) failed with "Cannot read properties of
 * undefined (reading 'removeChild')". Therefore we define parentElement on the Node prototype,
 * as a browser does, so it returns the parent when that parent is an element.
 *
 * @param sample Any node created by the fake DOM, used to find the Node prototype
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function installParentElement(sample: any): void {
  let proto = Object.getPrototypeOf(sample);
  while (proto !== null && proto.constructor?.name !== "Node") {
    proto = Object.getPrototypeOf(proto);
  }
  if (proto === null || "parentElement" in proto) return;
  Object.defineProperty(proto, "parentElement", {
    configurable: true,
    get(this: { parentNode?: { nodeType?: number } | null }) {
      const parent = this.parentNode ?? null;
      return parent !== null && parent.nodeType === 1 ? parent : null;
    },
  });
}

/**
 * Render ABC notation to SVG strings
 *
 * Because all formatting comes from ABC directives, we only set technical defaults
 * for padding and responsive SVG mode.
 *
 * @param abcContent The ABC notation content to render
 * @returns Result containing SVG strings and metadata
 */
export async function renderAbcToSvg(abcContent: string, options: { oneSvgPerLine?: boolean } = {}): Promise<SvgRenderResult> {
  // Lazy load dependencies to provide better error messages
  const { createHTMLWindow } = await loadSvgdom();
  const abcjs = await loadAbcjs();

  // Create a fake DOM environment for abcjs using svgdom
  const window = createHTMLWindow();
  const document = window.document;

  // Create container element for abcjs to render into
  const container = document.createElement("div");
  container.id = "abc-container";
  document.body.appendChild(container);
  installParentElement(container);

  const warnings: string[] = [];

  // Because abcjs expects browser globals (window, document, etc.), we need to temporarily patch them
  // Store original descriptors so we can restore them later
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(global, "window");
  const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(global, "document");
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(global, "navigator");

  try {
    // Patch global with svgdom window using defineProperty to override read-only properties
    Object.defineProperty(global, "window", {
      value: window,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(global, "document", {
      value: document,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(global, "navigator", {
      value: { userAgent: "node.js" },
      writable: true,
      configurable: true,
    });

    // Because abcjs renders only one tune when it is given several, we render the tunes one by one,
    // each into a container of its own, and collect their SVG in the order of the file.
    // The count that abcjs gives includes the file header, which renders nothing, so we skip the empty results.
    const tuneTotal = abcjs.numberOfTunes(abcContent);
    const svgs: string[] = [];
    const tunes: string[][] = [];
    let renderedTunes = 0;

    for (let index = 0; index < tuneTotal; index++) {
      const tuneContainer = document.createElement("div");
      document.body.appendChild(tuneContainer);
      // Because the declared type of the result has exactly one element, we widen it to read the real length.
      const visualObjs: unknown[] = abcjs.renderAbc(tuneContainer, abcContent, { startingTune: index, oneSvgPerLine: options.oneSvgPerLine === true });
      if (visualObjs.length === 0) continue;
      renderedTunes += visualObjs.length;

      const tuneSvgs: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tuneContainer.querySelectorAll("svg").forEach((svgElement: any) => {
        // Because abcjs generates SVG for browser embedding (inline in HTML),
        // it doesn't include the xmlns attribute required for standalone SVG files.
        // We add it here so the SVG renders correctly in browsers when opened directly.
        if (!svgElement.getAttribute("xmlns")) {
          svgElement.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        }
        const styled = styleChordSymbols(svgElement.outerHTML);
        svgs.push(styled);
        tuneSvgs.push(styled);
      });
      tunes.push(tuneSvgs);
    }

    // If no SVGs were generated, this might indicate an error
    if (svgs.length === 0 && abcContent.trim().length > 0) {
      warnings.push("No SVG output was generated. The ABC content may be invalid.");
    }

    return {
      svgs,
      tunes,
      metadata: {
        tuneCount: renderedTunes,
        warnings: warnings.length > 0 ? warnings : undefined,
      },
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new SvgRenderError(
      "SVG rendering failed.",
      msg,
      `The ABC content may be valid but contains elements that cannot be rendered
in a headless environment. Try rendering in a browser instead.`
    );
  } finally {
    // Restore original property descriptors
    if (originalWindowDescriptor) {
      Object.defineProperty(global, "window", originalWindowDescriptor);
    } else {
      delete (global as Record<string, unknown>).window;
    }
    if (originalDocumentDescriptor) {
      Object.defineProperty(global, "document", originalDocumentDescriptor);
    } else {
      delete (global as Record<string, unknown>).document;
    }
    if (originalNavigatorDescriptor) {
      Object.defineProperty(global, "navigator", originalNavigatorDescriptor);
    } else {
      delete (global as Record<string, unknown>).navigator;
    }
  }
}
