import {readFile, writeFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Keep the Worker self-contained while maintaining its CSS as readable source files.
export async function syncStyles({check = false} = {}) {
  const target = resolve(root, 'worker/index.js');
  const [source, tokens, base, sheet] = await Promise.all([
    readFile(target, 'utf8'),
    ...['tokens.css', 'base.css', 'public.css'].map(name => readFile(resolve(root, name), 'utf8')),
  ]);
  const start = source.indexOf('const publicStyles = String.raw`');
  const end = source.indexOf('const siteHeader=', start);
  const fonts = source.slice(start, end).match(/\/\* Open font licences[\s\S]*?@font-face\{font-family:Overpass[^\n]*\}/)?.[0];
  if (start < 0 || end < 0 || !fonts) throw new Error('Could not locate the stylesheet and embedded licensed fonts.');
  const css = sheet.replace(/^@import[^\n]*\n/gm, '');
  const stamp = css.match(/^(?:\/\*[\s\S]*?\*\/\s*)+/)?.[0];
  if (!stamp) throw new Error('public.css must begin with its Hallmark stamp.');
  const embedded = stamp + fonts + '\n\n' + tokens + '\n' + base + '\n' + css.slice(stamp.length);
  const result = source.slice(0, start) + 'const publicStyles = String.raw`\n' + embedded + '\n`;\n\n' + source.slice(end);
  if (check && result !== source) throw new Error('CSS sources changed. Run npm run styles:sync before testing or building.');
  if (!check && result !== source) await writeFile(target, result);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await syncStyles({check: process.argv.includes('--check')});
  console.log(process.argv.includes('--check') ? 'Embedded CSS matches its source files' : 'Embedded CSS updated');
}
