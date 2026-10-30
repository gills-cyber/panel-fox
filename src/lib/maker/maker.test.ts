import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { loadConfig, nameWords } from "./config.ts";
import { parseJsonLoose } from "./jsonfix.ts";
import { pyRound } from "./py.ts";
import { run } from "./pipeline.ts";

/** A plain one-colour PNG, so the test needs no image files. */
function png(w: number, h: number, rgb: [number, number, number]): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

test("names lose honorifics and titles", () => {
  assert.deepEqual(nameWords("Miss Hana-chan"), ["hana"]);
  assert.deepEqual(nameWords("Zoë"), ["zoe"]);
});

test("the cast finds people by partial or misspelt names", () => {
  const cfg = loadConfig({ characters: [{ name: "Aiko Tanaka" }, { name: "Ren" }] });
  assert.equal(cfg.byName("Aiko")?.name, "Aiko Tanaka");
  assert.equal(cfg.byName("Ren-kun")?.name, "Ren");
  assert.equal(cfg.byName("Old Man"), null);
});

test("under-18 characters are refused", () => {
  assert.throws(() => loadConfig({ characters: [{ name: "Kid", age: 15 }] }), /adult/);
});

test("model JSON with fences and trailing commas still parses", () => {
  assert.deepEqual(parseJsonLoose('```json\n{"a": [1, 2,],}\n```'), { a: [1, 2] });
});

test("rounding matches Python (half to even)", () => {
  assert.equal(pyRound(2.5), 2);
  assert.equal(pyRound(3.5), 4);
});

test("a test run turns images into a chapter with pages and bubbles", async () => {
  const images = [
    { name: "01.png", bytes: png(60, 90, [200, 80, 80]) },
    { name: "02.png", bytes: png(90, 60, [80, 200, 80]) },
    { name: "03.png", bytes: png(60, 90, [80, 80, 200]) },
  ];
  const lines: string[] = [];
  const { file } = await run(
    { images, config: { characters: [{ name: "Aiko" }, { name: "Ren" }] }, name: "Test", mock: true },
    (l) => lines.push(l),
  );
  assert.equal(file.kind, "koma-project");
  assert.equal(file.version, 1);
  const pages = file.doc.pages;
  assert.ok(pages.length >= 1);
  const panels = pages.flatMap((p) => p.panels);
  assert.equal(panels.length, 3);
  assert.ok(pages.some((p) => (p.overlays as unknown[]).length > 0), "some page has speech bubbles");
});

test("images are looked at in parallel and keep their order", async () => {
  const { analyseImages } = await import("./vision.ts");
  const cfg = loadConfig({ characters: [{ name: "Aiko" }] });
  const images = Array.from({ length: 6 }, (_, i) => ({ name: `${i + 1}.png`, bytes: new Uint8Array([i]) }));
  let live = 0;
  let most = 0;
  const client = {
    async checkModels() {
      return [];
    },
    async chatJson(_m: string, _s: string, _u: string, imgs: string[] | null) {
      live++;
      most = Math.max(most, live);
      const which = Number(imgs!.at(-1));
      // later images answer first, to shuffle the finishing order
      await new Promise((r) => setTimeout(r, 30 - which * 4));
      live--;
      return { scene_summary: `scene ${which}`, characters: [] };
    },
  };
  const got = await analyseImages(client, "m", cfg, images, async (img) => String(img.bytes[0]), false, () => {}, 4);
  assert.equal(most, 4);
  assert.deepEqual(Array.from(got.keys()), images.map((i) => i.name));
  assert.deepEqual(Array.from(got.values()).map((a) => a.scene_summary), images.map((_, i) => `scene ${i}`));
});

test("the earliest failing image is the one reported", async () => {
  const { analyseImages } = await import("./vision.ts");
  const cfg = loadConfig({ characters: [{ name: "Aiko" }] });
  const images = Array.from({ length: 4 }, (_, i) => ({ name: `${i + 1}.png`, bytes: new Uint8Array([i]) }));
  const client = {
    async checkModels() {
      return [];
    },
    async chatJson(_m: string, _s: string, _u: string, imgs: string[] | null) {
      const which = Number(imgs!.at(-1));
      await new Promise((r) => setTimeout(r, 20 - which * 5));
      if (which >= 1) throw new Error(`bad ${which}`);
      return { characters: [] };
    },
  };
  await assert.rejects(analyseImages(client, "m", cfg, images, async (img) => String(img.bytes[0]), false, () => {}, 4), /bad 1/);
});

test("every Ollama call asks to keep the model loaded", async () => {
  const { OllamaClient } = await import("./ollama.ts");
  const sent: Record<string, unknown>[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ message: { content: '{"ok": true}' }, done: true }) + "\n");
  }) as typeof fetch;
  try {
    await new OllamaClient("localhost:11434").chatJson("m", "s", "u");
    await new OllamaClient("http://localhost:11434", null, undefined, -1).chatJson("m", "s", "u");
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(sent[0]!.keep_alive, 3600);
  assert.equal(sent[1]!.keep_alive, -1);
});

test("a run reports how long each step took", async () => {
  const lines: string[] = [];
  await run(
    { images: [{ name: "01.png", bytes: png(40, 60, [1, 2, 3]) }], config: { characters: [{ name: "Aiko" }] }, mock: true },
    (l) => lines.push(l),
  );
  const times = lines.filter((l) => l.startsWith("[TIME]"));
  assert.ok(times.some((l) => /^\[TIME\] Vision analysis, 1 images: \d+\.\ds$/.test(l)));
  assert.ok(times.some((l) => l.startsWith("[TIME] Script generation")));
  assert.ok(times.at(-1)!.startsWith("[TIME] Total: "));
});
