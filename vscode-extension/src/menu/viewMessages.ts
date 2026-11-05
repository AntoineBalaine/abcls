import { KeyboardModel } from "../keyboard/keyboardModel";
import { ViewModel } from "./menuViewModel";

/** What the extension sends to the webview. The keyboard model comes with it when the view can draw it. */
export type ToWebview = { type: "model"; model: ViewModel; keyboard?: KeyboardModel };

/** What the webview sends to the extension. */
export type ToExtension = { type: "press"; notation: string } | { type: "ready" };
