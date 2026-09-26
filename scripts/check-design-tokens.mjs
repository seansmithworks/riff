#!/usr/bin/env node
// Fails with file:line if a raw hex color literal shows up in a scanned
// source file. Colors belong to the token layer in src/app/globals.css;
// components should reference it (bg-accent, var(--color-accent), etc.),
// never paste a hex value directly. See DESIGN.md "Tokens".
//
// Exclusions:
// - src/app/globals.css: the token source of truth — hex values live here,
//   once, and nowhere else.
// - src/app/dev/**: dev-only tuning pages. InkOptions.tsx does runtime hex
//   interpolation (mixHex(PENCIL, INK, t)) for the ink-draw animation, which
//   needs literal hex strings to do color math — a CSS custom property
//   can't be blended in JS without extra resolution machinery. Not worth it
//   for a dev harness.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["src/components", "src/app"];
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".css"]);
const EXCLUDE_PATHS = ["src/app/globals.css", "src/app/dev"];
const HEX_PATTERN = /#[0-9a-fA-F]{3,8}\b/g;

function isExcluded(path) {
  return EXCLUDE_PATHS.some(
    (excluded) => path === excluded || path.startsWith(`${excluded}/`),
  );
}

function walk(dir, files) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const relPath = relative(process.cwd(), fullPath);
    if (isExcluded(relPath)) continue;
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      walk(fullPath, files);
    } else if (SCAN_EXTENSIONS.has(fullPath.slice(fullPath.lastIndexOf(".")))) {
      files.push(fullPath);
    }
  }
  return files;
}

const files = ROOTS.flatMap((root) => walk(root, []));
const violations = [];

for (const file of files) {
  const contents = readFileSync(file, "utf8");
  const lines = contents.split("\n");
  lines.forEach((line, i) => {
    const matches = line.match(HEX_PATTERN);
    if (matches) {
      violations.push(
        `${relative(process.cwd(), file)}:${i + 1}: raw hex literal ${matches.join(", ")}`,
      );
    }
  });
}

if (violations.length > 0) {
  console.error("Raw hex color literals found outside the token layer:\n");
  for (const violation of violations) console.error(`  ${violation}`);
  console.error(
    "\nDefine the value once in src/app/globals.css and reference it by token name instead.",
  );
  process.exit(1);
}

console.log("check:design passed — no raw hex literals outside the token layer.");
