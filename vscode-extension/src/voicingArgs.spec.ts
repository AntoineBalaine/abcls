import * as assert from "assert";
import * as fc from "fast-check";
import { ALLOWED_VOICES, resolveVoices } from "./voicingArgs";

describe("resolveVoices", () => {
  it("gives the default of 4 voices when there is no argument or no voices field", () => {
    assert.strictEqual(resolveVoices(undefined), 4);
    assert.strictEqual(resolveVoices({}), 4);
  });

  it("gives the default for an object that has no voices field, such as the Uri that a menu passes", () => {
    assert.strictEqual(resolveVoices(new Date()), 4);
    assert.strictEqual(resolveVoices(Object.create({ voices: 5 })), 5);
  });

  it("gives the default when the voices field is present but undefined, as the menu passes it without a count", () => {
    assert.strictEqual(resolveVoices({ voices: undefined }), 4);
  });

  it("accepts 4, 5 and 6 voices", () => {
    assert.strictEqual(resolveVoices({ voices: 4 }), 4);
    assert.strictEqual(resolveVoices({ voices: 5 }), 5);
    assert.strictEqual(resolveVoices({ voices: 6 }), 6);
  });

  it("rejects every other value", () => {
    for (const args of [{ voices: 3 }, { voices: 7 }, { voices: "5" }, { voices: 4.5 }, { voices: null }, null, "x", 5, [5], true]) {
      assert.strictEqual(resolveVoices(args), undefined, JSON.stringify(args));
    }
  });

  it("returns a number only for 4, 5 or 6, and 4 when the field is undefined", () => {
    fc.assert(
      fc.property(fc.oneof(fc.integer({ min: 0, max: 10 }), fc.anything()), (voices) => {
        const result = resolveVoices({ voices });
        if (voices === undefined) return result === 4;
        return result === undefined || (voices === result && ALLOWED_VOICES.includes(result));
      })
    );
  });

  it("never returns a number outside 4 to 6, whatever the argument", () => {
    fc.assert(
      fc.property(fc.anything(), (args) => {
        const result = resolveVoices(args);
        return result === undefined || ALLOWED_VOICES.includes(result);
      })
    );
  });
});
