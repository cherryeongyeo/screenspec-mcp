// Usage: node scripts/render-template.mjs ko|en > out.js
// Produces a self-contained Figma Plugin API script (for use_figma or a plugin console).
import { readFileSync } from "node:fs";
const lang = process.argv[2] ?? "ko";
const i18n = JSON.parse(readFileSync(new URL("../figma-template/i18n.json", import.meta.url), "utf8"));
if (!i18n[lang]) throw new Error(`unknown language ${lang}`);
const src = readFileSync(new URL("../figma-template/build-template.js", import.meta.url), "utf8");
process.stdout.write(src.replace("__LANG__", JSON.stringify(i18n[lang])));
