/**
 * The pedal gate of the MIDI input: a pedal decides whether the notes that are played get written into the editor.
 * Nothing here imports vscode or JZZ, so that the rules can be tested alone.
 */

export type PedalMode = "off" | "hold" | "toggle";

export interface PedalGate {
  /** Whether new notes are written. */
  isOpen: boolean;
  /** Whether the pedal is down now, so that a toggle reacts to a press and not to every message of a held pedal. */
  isDown: boolean;
}

export type GateChange = "opened" | "closed" | "unchanged";

/** The status byte of a control change message, without its channel. */
const CONTROL_CHANGE = 0xb0;
/** By the MIDI convention, a switch pedal is down from the value 64 and up below it. */
const DOWN_THRESHOLD = 64;

/**
 * A new gate. Because the pedal is assumed to be up when the input starts, the gate starts closed
 * whenever a pedal mode is on, and open when the pedal is off.
 */
export function createPedalGate(mode: PedalMode): PedalGate {
  return { isOpen: mode === "off", isDown: false };
}

/**
 * Tells whether new notes are written. With the pedal off, they always are.
 */
export function isGateOpen(gate: PedalGate, mode: PedalMode): boolean {
  return mode === "off" || gate.isOpen;
}

/**
 * Updates the gate with a MIDI message, and tells what happened to it.
 * Because a message of another controller, or a note, is not about the pedal, the gate does not change for it.
 *
 * @param gate The gate to update
 * @param message The bytes of the MIDI message
 * @param mode How the pedal acts: hold opens the gate while the pedal is down, and toggle flips it at each press
 * @param controller The number of the controller that the pedal sends, 64 for the sustain pedal
 */
export function updatePedalGate(gate: PedalGate, message: ArrayLike<number>, mode: PedalMode, controller: number): GateChange {
  if (mode === "off" || (message[0] & 0xf0) !== CONTROL_CHANGE || message[1] !== controller) {
    return "unchanged";
  }
  const isDown = message[2] >= DOWN_THRESHOLD;
  const wasDown = gate.isDown;
  gate.isDown = isDown;

  const wasOpen = gate.isOpen;
  if (mode === "hold") {
    gate.isOpen = isDown;
  } else if (isDown && !wasDown) {
    gate.isOpen = !gate.isOpen;
  }
  if (gate.isOpen === wasOpen) return "unchanged";
  return gate.isOpen ? "opened" : "closed";
}

/**
 * Flips the gate without a pedal message, for a footswitch that sends a key and not a MIDI message.
 */
export function toggleGate(gate: PedalGate): GateChange {
  gate.isOpen = !gate.isOpen;
  return gate.isOpen ? "opened" : "closed";
}
