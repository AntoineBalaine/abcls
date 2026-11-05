import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { DEFAULT_KEYMAP } from "./defaultKeymap";
import { TABLES_END, TABLES_START, buildKeymapTables, withTables } from "./docTables";
import { Group } from "./types";

const PAGE = path.join(__dirname, "..", "..", "..", "docs-site", "src", "content", "docs", "user-guide", "modal-keymap.mdx");

function countKeys(group: Group): number {
  let total = 0;
  for (const node of Object.values(group.children)) total += 1 + (node.type === "group" ? countKeys(node) : 0);
  return total;
}

/** The cells of every row of a table, without the padding, so that the tests do not depend on the width of a column. */
function cellsOf(tables: string, heading: string): string[][] {
  return rowsIn(tables, heading).map((row) =>
    row
      .split(/(?<!\\)\|/)
      .slice(1, -1)
      .map((text) => text.trim())
  );
}

function rowsIn(tables: string, heading: string): string[] {
  const start = tables.indexOf(heading);
  const next = tables.indexOf("### ", start + heading.length);
  const section = tables.slice(start, next === -1 ? undefined : next);
  return section.split("\n").filter((line) => line.startsWith("| `"));
}

describe("buildKeymapTables", () => {
  const tables = buildKeymapTables(DEFAULT_KEYMAP);

  it("has one row for every key of each menu, including the keys inside a group", () => {
    assert.strictEqual(rowsIn(tables, "### Keys of the select menu").length, countKeys(DEFAULT_KEYMAP.select));
    assert.strictEqual(rowsIn(tables, "### Keys of the transform menu").length, countKeys(DEFAULT_KEYMAP.transform));
  });

  it("writes the keys of a group with the key of the group in front", () => {
    assert.ok(cellsOf(tables, "### Keys of the transform menu").some((cells) => cells[0] === "`g c`"));
    assert.ok(cellsOf(tables, "### Keys of the select menu").some((cells) => cells[0] === "`i c`"));
  });

  it("marks the keys that Kakoune does not have", () => {
    const select = cellsOf(tables, "### Keys of the select menu");
    assert.strictEqual(select.find((cells) => cells[0] === "`A`")?.[1], "annotations (new, not in Kakoune)");
    assert.strictEqual(select.find((cells) => cells[0] === "`c`")?.[1], "chords");
  });

  it("marks a group as a menu, without the ellipsis of its label", () => {
    assert.ok(tables.includes("voicing menu (count = voices) ›"));
    assert.ok(!tables.includes("…"));
  });

  it("groups the rows by category in the order of the table", () => {
    const rows = cellsOf(tables, "### Keys of the transform menu");
    const firstPitch = rows.findIndex((cells) => cells[2] === "pitch");
    const firstHarmony = rows.findIndex((cells) => cells[2] === "harmonize");
    assert.ok(firstPitch >= 0 && firstPitch < firstHarmony);
  });

  it("escapes what MDX would read as a tag or an expression in a label, and leaves a key in code as it is", () => {
    const tables = buildKeymapTables(DEFAULT_KEYMAP);
    const transform = cellsOf(tables, "### Keys of the transform menu");
    assert.strictEqual(transform.find((cells) => cells[0] === "`y`")?.[1], "parallel diatonic //&lt;-prev");
    assert.ok(
      transform.some((cells) => cells[0] === "`<c-up>`"),
      "the key in backticks stays as it is"
    );
    assert.ok(transform.some((cells) => cells[0] === "`{`"));
    const keymap = {
      select: {
        ...DEFAULT_KEYMAP.select,
        children: { q: { type: "leaf" as const, label: "{x} <y>", category: "pitch", action: { kind: "command" as const, name: "x", args: [] } } },
      },
      transform: DEFAULT_KEYMAP.transform,
    };
    assert.strictEqual(cellsOf(buildKeymapTables(keymap), "### Keys of the select menu")[0][1], "\\{x\\} &lt;y>");
  });

  it("escapes the pipe, which would break a table", () => {
    const keymap = {
      select: {
        ...DEFAULT_KEYMAP.select,
        children: { "|": { type: "leaf" as const, label: "a|b", category: "pitch", action: { kind: "command" as const, name: "x", args: [] } } },
      },
      transform: DEFAULT_KEYMAP.transform,
    };
    const row = cellsOf(buildKeymapTables(keymap), "### Keys of the select menu")[0];
    assert.deepStrictEqual(row.slice(0, 2), ["`\\|`", "a\\|b"]);
  });
});

describe("withTables", () => {
  it("replaces what is between the markers, and nothing else", () => {
    const page = `before\n${TABLES_START}\n\nold\n\n${TABLES_END}\nafter`;
    const updated = withTables(page, "new");
    assert.strictEqual(updated, `before\n${TABLES_START}\n\nnew\n\n${TABLES_END}\nafter`);
  });

  it("is idempotent, so a second run changes nothing", () => {
    const page = `a\n${TABLES_START}\n\n${TABLES_END}\nb`;
    const once = withTables(page, buildKeymapTables(DEFAULT_KEYMAP)) ?? "";
    assert.ok(once.length > page.length);
    assert.strictEqual(withTables(once, buildKeymapTables(DEFAULT_KEYMAP)), once);
  });

  it("reports a page that lost a marker, or has them in the wrong order, instead of taking it for up to date", () => {
    assert.strictEqual(withTables("no markers", "x"), undefined);
    assert.strictEqual(withTables(`a\n${TABLES_START}\nb`, "x"), undefined);
    assert.strictEqual(withTables(`a\n${TABLES_END}\n${TABLES_START}\nb`, "x"), undefined);
  });
});

describe("the documentation page", () => {
  it("has the tables of the default keymap, so that the page cannot drift from the data", () => {
    const page = fs.readFileSync(PAGE, "utf8");
    assert.ok(page.includes(TABLES_START) && page.includes(TABLES_END), "the page has lost a marker of the tables");
    assert.strictEqual(withTables(page, buildKeymapTables(DEFAULT_KEYMAP)), page, "run npm run generate in docs-site");
  });

  it("documents every setting of the keymap and the view", () => {
    const page = fs.readFileSync(PAGE, "utf8");
    for (const setting of [
      "abc.keymap",
      "abc.keyboardLayout",
      "abc.keyboardGeometry",
      "abc.keyboardIsoKeys",
      "abc.menuView.autoOpen",
      "abc.menuView.location",
    ]) {
      assert.ok(page.includes(setting), setting);
    }
  });

  it("has no bold, no italic and no numbered heading, as the project's style asks", () => {
    const page = fs.readFileSync(PAGE, "utf8");
    assert.ok(!/\*\*[^*]+\*\*/.test(page));
    assert.ok(!/^#{1,6} \d/m.test(page));
  });
});
