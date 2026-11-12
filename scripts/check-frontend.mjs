// Quick checks for the frontend sources (run by the tests and before deploys):
//   • every file in frontend/ is listed in manifest.json once, and every listed file exists
//   • each JavaScript file is valid on its own (syntax), so an error points at the right file
//   • the same top-level name is not declared in two files (they share one scope, so that would break the page)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const FE = join(dirname(fileURLToPath(import.meta.url)), '..', 'frontend');
const m = JSON.parse(readFileSync(join(FE, 'manifest.json'), 'utf8'));
const problems = [];
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const listed = [...m.styles.map((f) => 'styles/' + f), ...m.app.map((f) => 'src/' + f), ...m.api.map((f) => 'src/' + f)];
const onDisk = walk(FE).map((f) => relative(FE, f)).filter((f) => /\.(js|css)$/.test(f));
for (const f of onDisk) if (!listed.includes(f)) problems.push(`${f} is not in manifest.json`);
for (const f of listed) if (!onDisk.includes(f)) problems.push(`manifest.json lists ${f}, which does not exist`);
for (const f of new Set(listed)) if (listed.filter((x) => x === f).length > 1) problems.push(`${f} is listed twice`);

const declared = new Map();
for (const [group, files] of [['app', m.app], ['api', m.api]]) {
  for (const f of files) {
    const code = readFileSync(join(FE, 'src', f), 'utf8');
    try { esbuild.transformSync(group === 'api' ? `(function(){${code}\n})` : code, { loader: 'js', logLevel: 'silent' }); }
    catch (e) { problems.push(`src/${f}: ${e.errors?.[0]?.text || e.message} (line ${e.errors?.[0]?.location?.line ?? '?'})`); continue; }
    // top-level declarations (statements starting at column 0)
    for (const mm of code.matchAll(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
      const key = group + ':' + mm[1];
      if (declared.has(key)) problems.push(`"${mm[1]}" is declared in both src/${declared.get(key)} and src/${f}`);
      else declared.set(key, f);
    }
  }
}
if (problems.length) { console.error('Frontend check failed:\n  ' + problems.join('\n  ')); process.exit(1); }
console.log(`frontend ok: ${listed.length} files, ${declared.size} top-level names`);
