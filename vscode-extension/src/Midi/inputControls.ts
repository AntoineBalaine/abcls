/**
 * The controls of the step input: a controller of a pedal, or a note of the keyboard, that writes a rest or a bar line,
 * undoes the last input, or switches the writing of notes on and off.
 * Nothing here imports vscode or JZZ, so that the rules can be tested alone.
 */

export type InputAction = "rest" | "barLine" | "undo" | "toggleGate";

export const INPUT_ACTIONS: readonly InputAction[] = ["rest", "barLine", "undo", "toggleGate"];

export interface InputControls {
  /** The MIDI note that writes a rest, a keyswitch of the keyboard, or undefined when no note does. */
  restNote: number | undefined;
  /** What each control change number does. */
  controllerActions: Record<number, InputAction>;
}

/** Which controllers are down, so that a held pedal acts once and not at every message that it sends. */
export interface ControlState {
  downControllers: Set<number>;
}

const CONTROL_CHANGE = 0xb0;
const NOTE_ON = 0x90;
const DOWN_THRESHOLD = 64;

export function createControlState(): ControlState {
  return { downControllers: new Set() };
}

/**
 * Reads the setting that maps controller numbers to actions, such as { "21": "rest" }.
 * Because a setting is typed by hand, an entry that is not a controller number or not an action is ignored.
 */
export function parseControllerActions(raw: unknown): Record<number, InputAction> {
  const actions: Record<number, InputAction> = {};
  if (typeof raw !== "object" || raw === null) return actions;
  for (const [key, value] of Object.entries(raw)) {
    const controller = Number(key);
    if (Number.isInteger(controller) && controller >= 0 && controller <= 127 && INPUT_ACTIONS.includes(value as InputAction)) {
      actions[controller] = value as InputAction;
    }
  }
  return actions;
}

/**
 * Reads the setting of the keyswitch note: a number of a MIDI note, or nothing when it is off.
 */
export function parseRestNote(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= 127 ? raw : undefined;
}

/**
 * Tells which action a MIDI message asks for, if any.
 * A controller acts when it goes down, and a note acts when it is pressed.
 *
 * @param message The bytes of the MIDI message
 * @param controls What the controls do
 * @param state Which controllers are down, which this function updates
 */
export function actionForMessage(message: ArrayLike<number>, controls: InputControls, state: ControlState): InputAction | undefined {
  const status = message[0] & 0xf0;
  if (status === CONTROL_CHANGE) {
    const controller = message[1];
    const action = controls.controllerActions[controller];
    if (action === undefined) return undefined;
    const isDown = message[2] >= DOWN_THRESHOLD;
    const wasDown = state.downControllers.has(controller);
    if (isDown) state.downControllers.add(controller);
    else state.downControllers.delete(controller);
    return isDown && !wasDown ? action : undefined;
  }
  if (status === NOTE_ON && message[2] > 0 && message[1] === controls.restNote) return "rest";
  return undefined;
}
