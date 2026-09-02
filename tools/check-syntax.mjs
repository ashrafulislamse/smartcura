#!/usr/bin/env node
/**
 * Reports raw structural facts about a source file: line count, byte length,
 * and whether template literals and braces are balanced.
 *
 * Exists because a TypeScript error reported at a line beyond the visible end of
 * a file usually means an unterminated literal earlier in the file, not a
 * problem at the reported line.
 *
 * Usage: node tools/check-syntax.mjs <file> [...moreFiles]
 */

import { readFileSync } from 'node:fs';

const BACKTICK = '`';

for (const file of process.argv.slice(2)) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split(/\r\n|\n/);
  let backticks = 0;
  let openBraces = 0;
  let closeBraces = 0;
  for (const character of text) {
    if (character === BACKTICK) backticks += 1;
    else if (character === '{') openBraces += 1;
    else if (character === '}') closeBraces += 1;
  }
  console.log(file);
  console.log(`  lines=${lines.length}  bytes=${text.length}`);
  console.log(
    `  backticks=${backticks}${backticks % 2 === 1 ? '  <-- ODD: unterminated template literal' : ''}`,
  );
  console.log(
    `  braces: open=${openBraces} close=${closeBraces}` +
    (openBraces !== closeBraces ? `  <-- UNBALANCED by ${openBraces - closeBraces}` : ''),
  );
  console.log(`  last non-empty line: ${lines.filter((l) => l.trim().length > 0).at(-1)}`);
}
