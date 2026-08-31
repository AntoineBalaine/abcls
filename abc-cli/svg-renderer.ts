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

/**
 * Result of SVG rendering
 */
export interface SvgRenderResult {
  /**
   * Array of SVG strings, one per tune
   */
  svgs: string[];

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
    return await import("abcjs");
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
 * Render ABC notation to SVG strings
 *
 * Because all formatting comes from ABC directives, we only set technical defaults
 * for padding and responsive SVG mode.
 *
 * @param abcContent The ABC notation content to render
 * @returns Result containing SVG strings and metadata
 */
export async function renderAbcToSvg(abcContent: string): Promise<SvgRenderResult> {
  // Lazy load dependencies to provide better error messages
  const { createHTMLWindow } = await loadSvgdom();
  // Because abcjs is a CommonJS module, an ESM import lands its API on `.default`,
  // so we unwrap that when present to reach renderAbc.
  const abcjsModule = await loadAbcjs();
  const abcjs = (abcjsModule as unknown as { default?: typeof abcjsModule }).default ?? abcjsModule;

  // Create a fake DOM environment for abcjs using svgdom
  const window = createHTMLWindow();
  const document = window.document;

  // Because svgdom exposes parentNode but not parentElement, and abcjs's
  // closeGroup calls parentElement.removeChild on empty groups, we add a
  // parentElement getter mirroring parentNode across the SVG element prototype
  // chain. Without it, headless rendering throws on the first invisible group.
  const svgProbe = document.createElementNS("http://www.w3.org/2000/svg", "g");
  for (let proto = Object.getPrototypeOf(svgProbe); proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    if (!Object.getOwnPropertyDescriptor(proto, "parentElement")) {
      Object.defineProperty(proto, "parentElement", {
        get(): unknown {
          return (this as { parentNode?: unknown }).parentNode ?? null;
        },
        configurable: true,
      });
    }
  }

  // Create container element for abcjs to render into
  const container = document.createElement("div");
  container.id = "abc-container";
  document.body.appendChild(container);

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

    // Render ABC to the container
    // abcjs.renderAbc returns an array of rendered tunes
    const visualObjs = abcjs.renderAbc(container, abcContent);

    // Extract SVG elements from the container
    // Each tune is rendered as a separate div with SVG inside
    const svgElements = container.querySelectorAll("svg");
    const svgs: string[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    svgElements.forEach((svgElement: any) => {
      // Because abcjs generates SVG for browser embedding (inline in HTML),
      // it doesn't include the xmlns attribute required for standalone SVG files.
      // We add it here so the SVG renders correctly in browsers when opened directly.
      if (!svgElement.getAttribute("xmlns")) {
        svgElement.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      }
      // Get the outer HTML of the SVG element
      svgs.push(svgElement.outerHTML);
    });

    // If no SVGs were generated, this might indicate an error
    if (svgs.length === 0 && abcContent.trim().length > 0) {
      warnings.push("No SVG output was generated. The ABC content may be invalid.");
    }

    return {
      svgs,
      metadata: {
        tuneCount: visualObjs.length,
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
