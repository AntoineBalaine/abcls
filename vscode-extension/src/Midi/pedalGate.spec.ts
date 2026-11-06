import * as assert from "assert";
import * as fc from "fast-check";
import { PedalGate, PedalMode, createPedalGate, isGateOpen, toggleGate, updatePedalGate } from "./pedalGate";

const PEDAL_DOWN = [0xb0, 64, 127];
const PEDAL_UP = [0xb0, 64, 0];

describe("the pedal gate", () => {
  it("is open when the pedal is off, and closed when a pedal mode is on", () => {
    assert.strictEqual(isGateOpen(createPedalGate("off"), "off"), true);
    assert.strictEqual(isGateOpen(createPedalGate("hold"), "hold"), false);
    assert.strictEqual(isGateOpen(createPedalGate("toggle"), "toggle"), false);
  });

  it("opens while the pedal is down and closes when it comes up, in hold mode", () => {
    const gate = createPedalGate("hold");
    assert.strictEqual(updatePedalGate(gate, PEDAL_DOWN, "hold", 64), "opened");
    assert.strictEqual(isGateOpen(gate, "hold"), true);
    assert.strictEqual(updatePedalGate(gate, PEDAL_UP, "hold", 64), "closed");
    assert.strictEqual(isGateOpen(gate, "hold"), false);
  });

  it("reads half pedal values with the threshold of 64", () => {
    const gate = createPedalGate("hold");
    assert.strictEqual(updatePedalGate(gate, [0xb0, 64, 63], "hold", 64), "unchanged");
    assert.strictEqual(updatePedalGate(gate, [0xb0, 64, 64], "hold", 64), "opened");
  });

  it("does not report a change for the many messages that a moving pedal sends", () => {
    const gate = createPedalGate("hold");
    updatePedalGate(gate, [0xb0, 64, 70], "hold", 64);
    assert.strictEqual(updatePedalGate(gate, [0xb0, 64, 100], "hold", 64), "unchanged");
    assert.strictEqual(updatePedalGate(gate, [0xb0, 64, 127], "hold", 64), "unchanged");
  });

  it("flips at each press, and not at the release, in toggle mode", () => {
    const gate = createPedalGate("toggle");
    assert.strictEqual(updatePedalGate(gate, PEDAL_DOWN, "toggle", 64), "opened");
    assert.strictEqual(updatePedalGate(gate, PEDAL_UP, "toggle", 64), "unchanged");
    assert.strictEqual(updatePedalGate(gate, PEDAL_DOWN, "toggle", 64), "closed");
    assert.strictEqual(updatePedalGate(gate, [0xb0, 64, 127], "toggle", 64), "unchanged");
  });

  it("ignores another controller, a note, another channel's other messages, and the pedal when it is off", () => {
    const gate = createPedalGate("hold");
    assert.strictEqual(updatePedalGate(gate, [0xb0, 66, 127], "hold", 64), "unchanged");
    assert.strictEqual(updatePedalGate(gate, [0x90, 64, 127], "hold", 64), "unchanged");
    assert.strictEqual(updatePedalGate(gate, PEDAL_DOWN, "off", 64), "unchanged");
    assert.strictEqual(gate.isOpen, false);
  });

  it("reads the pedal on every channel", () => {
    const gate = createPedalGate("hold");
    assert.strictEqual(updatePedalGate(gate, [0xb5, 64, 127], "hold", 64), "opened");
  });

  it("follows the controller number that was chosen", () => {
    const gate = createPedalGate("hold");
    assert.strictEqual(updatePedalGate(gate, [0xb0, 67, 127], "hold", 67), "opened");
    assert.strictEqual(updatePedalGate(gate, PEDAL_UP, "hold", 67), "unchanged");
  });

  it("flips with the toggle command, for a footswitch that sends a key", () => {
    const gate = createPedalGate("toggle");
    assert.strictEqual(toggleGate(gate), "opened");
    assert.strictEqual(toggleGate(gate), "closed");
  });

  it("in hold mode, is open exactly when the last message of the pedal was down", () => {
    const message = fc.record({ controller: fc.constantFrom(64, 66), value: fc.integer({ min: 0, max: 127 }) });
    fc.assert(
      fc.property(fc.array(message, { maxLength: 40 }), (messages) => {
        const gate: PedalGate = createPedalGate("hold");
        let lastPedal: number | undefined;
        for (const { controller, value } of messages) {
          updatePedalGate(gate, [0xb0, controller, value], "hold", 64);
          if (controller === 64) lastPedal = value;
        }
        const expected = lastPedal !== undefined && lastPedal >= 64;
        return isGateOpen(gate, "hold") === expected;
      })
    );
  });

  it("in toggle mode, is open exactly when the number of presses is odd", () => {
    const mode: PedalMode = "toggle";
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 127 }), { maxLength: 40 }), (values) => {
        const gate = createPedalGate(mode);
        let presses = 0;
        let wasDown = false;
        for (const value of values) {
          const isDown = value >= 64;
          if (isDown && !wasDown) presses++;
          wasDown = isDown;
          updatePedalGate(gate, [0xb0, 64, value], mode, 64);
        }
        return isGateOpen(gate, mode) === (presses % 2 === 1);
      })
    );
  });
});
