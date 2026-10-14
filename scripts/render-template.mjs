// Usage: node scripts/render-template.mjs ko|en ['{"x":0,"y":0,"sampleMockupId":"21:30"}'] > out.js
// Produces a self-contained Figma Plugin API script (for use_figma or a plugin console).
import { readFileSync } from "node:fs";
const lang = process.argv[2] ?? "ko";
const opts = process.argv[3] ?? "{}";
JSON.parse(opts);
const i18n = JSON.parse(readFileSync(new URL("../figma-template/i18n.json", import.meta.url), "utf8"));
if (!i18n[lang]) throw new Error(`unknown language ${lang}`);
const src = readFileSync(new URL("../figma-template/build-template.js", import.meta.url), "utf8");
const { legacyPlaceholders, ...L } = i18n[lang];
process.stdout.write(src.replace("__LANG__", JSON.stringify(L)).replace("__OPTS__", opts));
