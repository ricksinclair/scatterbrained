#!/usr/bin/env node
// gen-plantuml-themes.mjs — regenerate the PlantUML theme pack from themes.js.
// Writes 12 standalone theme files + _sentinel.puml into public/plantuml/.
// All logic lives in the pure module public/lib/puml-theme.js (unit-tested).
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generatePack } from '../public/lib/puml-theme.js';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'plantuml');
mkdirSync(outDir, { recursive: true });
for (const { file, text } of generatePack()) {
  writeFileSync(join(outDir, file), text);
  console.log('wrote', join('public/plantuml', file));
}
