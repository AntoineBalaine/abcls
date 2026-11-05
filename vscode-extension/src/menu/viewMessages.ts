import { ViewModel } from "./menuViewModel";

/** What the extension sends to the webview. */
export type ToWebview = { type: "model"; model: ViewModel };

/** What the webview sends to the extension. */
export type ToExtension = { type: "press"; notation: string } | { type: "ready" };
