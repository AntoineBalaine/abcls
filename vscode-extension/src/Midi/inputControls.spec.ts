import * as assert from "assert";
import * as fc from "fast-check";
import { InputControls, actionForMessage, createControlState, parseControllerActions, parseRestNote } from "./inputControls";

const controls: InputControls = { restNote: 21, controllerActions: { 20: "rest", 21: "barLine", 22: "undo", 23: "toggleGate" } };

describe("the controls of the step input", () => {
  it("acts when a controller goes down, and not for the messages of a held pedal", () => {
    const state = createControlState();
    assert.strictEqual(actionForMessage([0xb0, 20, 127], controls, state), "rest");
    assert.strictEqual(actionForMessage([0xb0, 20, 127], controls, state), undefined);
    assert.strictEqual(actionForMessage([0xb0, 20, 0], controls, state), undefined);
    assert.strictEqual(actionForMessage([0xb0, 20, 127], controls, state), "rest");
  });

  it("maps each controller to its own action", () => {
    const state = createControlState();
    assert.strictEqual(actionForMessage([0xb0, 21, 100], controls, state), "barLine");
    assert.strictEqual(actionForMessage([0xb0, 22, 100], controls, state), "undo");
    assert.strictEqual(actionForMessage([0xb0, 23, 100], controls, state), "toggleGate");
  });

  it("ignores a controller that has no action, and every channel is read", () => {
    const state = createControlState();
    assert.strictEqual(actionForMessage([0xb0, 64, 127], controls, state), undefined);
    assert.strictEqual(actionForMessage([0xb7, 20, 127], controls, state), "rest");
  });

  it("writes a rest for the keyswitch note when it is pressed, and not when it is released", () => {
    const state = createControlState();
    assert.strictEqual(actionForMessage([0x90, 21, 90], controls, state), "rest");
    assert.strictEqual(actionForMessage([0x90, 21, 0], controls, state), undefined);
    assert.strictEqual(actionForMessage([0x80, 21, 0], controls, state), undefined);
    assert.strictEqual(actionForMessage([0x90, 22, 90], controls, state), undefined);
  });

  it("has no keyswitch when the note is off", () => {
    assert.strictEqual(actionForMessage([0x90, 21, 90], { ...controls, restNote: undefined }, createControlState()), undefined);
  });

  it("reads the settings, and ignores entries that are wrong", () => {
    assert.deepStrictEqual(parseControllerActions({ "20": "rest", "21": "nope", x: "undo", "200": "rest", "22": "undo" }), { 20: "rest", 22: "undo" });
    assert.deepStrictEqual(parseControllerActions(null), {});
    assert.deepStrictEqual(parseControllerActions("rest"), {});
    assert.strictEqual(parseRestNote(21), 21);
    assert.strictEqual(parseRestNote(0), 0);
    assert.strictEqual(parseRestNote(200), undefined);
    assert.strictEqual(parseRestNote("21"), undefined);
    assert.strictEqual(parseRestNote(1.5), undefined);
  });

  it("never throws, whatever the setting or the message", () => {
    fc.assert(
      fc.property(fc.anything(), fc.anything(), fc.array(fc.integer({ min: 0, max: 255 }), { maxLength: 3 }), (rawActions, rawNote, message) => {
        const parsed: InputControls = { restNote: parseRestNote(rawNote), controllerActions: parseControllerActions(rawActions) };
        actionForMessage(message, parsed, createControlState());
        return true;
      })
    );
  });

  it("acts once per press, whatever the sequence of values of a controller", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 127 }), { maxLength: 40 }), (values) => {
        const state = createControlState();
        let presses = 0;
        let wasDown = false;
        let acted = 0;
        for (const value of values) {
          const isDown = value >= 64;
          if (isDown && !wasDown) presses++;
          wasDown = isDown;
          if (actionForMessage([0xb0, 20, value], controls, state) !== undefined) acted++;
        }
        return acted === presses;
      })
    );
  });
});
