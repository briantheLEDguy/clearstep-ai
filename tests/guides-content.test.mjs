import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("gives every guide a distinct editorial format with a matching renderer", async () => {
  const [guideSource, librarySource] = await Promise.all([
    readFile(new URL("../lib/guides.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/guides/GuidesLibrary.tsx", import.meta.url), "utf8"),
  ]);

  const formats = [...guideSource.matchAll(/\{ format: "([^"]+)", formatLabel:/g)].map((match) => match[1]);
  const renderers = [...librarySource.matchAll(/case "([^"]+)":/g)].map((match) => match[1]);

  assert.equal(formats.length, 9, "all nine guides declare an editorial format");
  assert.equal(new Set(formats).size, formats.length, "guide formats should not repeat");
  assert.deepEqual(new Set(renderers), new Set(formats), "every declared format has a renderer");
});

test("uses varied reading patterns instead of one repeated article template", async () => {
  const [source, styles] = await Promise.all([
    readFile(new URL("../components/guides/GuidesLibrary.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/guides/guides.module.css", import.meta.url), "utf8"),
  ]);

  for (const pattern of ["timeline", "cards", "gates", "cycle", "beforeAfter", "evidenceGrid", "ingredientGrid"]) {
    assert.match(styles, new RegExp(`\\.${pattern}(?:\\s|\\{|\\.)`), `${pattern} reading pattern`);
  }

  assert.match(source, /navigator\.clipboard\.writeText\(active\.prompt\)/, "copy-ready prompts");
  assert.match(source, /<details className=\{styles\.startDetails\}>/, "collapsible prerequisites");
});
