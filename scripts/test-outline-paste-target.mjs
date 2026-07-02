import { build } from 'esbuild';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const rootDir = process.cwd();
const tempDir = path.join(rootDir, 'scripts', '.tmp-outline-paste-target-test');
const entryPath = path.join(tempDir, 'entry.ts');
const bundlePath = path.join(tempDir, 'bundle.mjs');
const projectImport = (relativePath) => JSON.stringify(path.resolve(rootDir, relativePath).replace(/\\/g, '/'));

const lines = [
	"import assert from 'node:assert/strict';",
	`import { createOutlinePasteTextAnchor, resolveOutlinePasteTextAnchor } from ${projectImport('src/services/OutlinePasteTarget.ts')};`,
	'',
	'{',
	"  const doc = ['- Parent', '  id:: one', '\\t- Child', '- Next'].join('\\n');",
	"  const anchor = createOutlinePasteTextAnchor(doc, 0);",
	"  assert.ok(anchor);",
	"  const target = resolveOutlinePasteTextAnchor(doc, anchor);",
	"  assert.ok(target);",
	"  assert.equal(doc.slice(target.insertOffset), '\\t- Child\\n- Next', 'unchanged documents should keep the original insertion point');",
	'}',
	'',
	'{',
	"  const original = ['# Heading', '- Parent', '  id:: one', '- Next'].join('\\n');",
	"  const anchor = createOutlinePasteTextAnchor(original, 1);",
	"  assert.ok(anchor);",
	"  const changed = ['Intro', '# Heading', '- Parent', '  id:: one', '- Next'].join('\\n');",
	"  const target = resolveOutlinePasteTextAnchor(changed, anchor);",
	"  assert.ok(target);",
	"  assert.equal(target.targetLine, 2, 'unrelated edits before the target should relocate the anchor');",
	'}',
	'',
	'{',
	"  const original = ['- A', '\\t- ', '- B', '\\t- '].join('\\n');",
	"  const anchor = createOutlinePasteTextAnchor(original, 1);",
	"  assert.ok(anchor);",
	"  const changed = ['Intro', '- A', '\\t- ', '- B', '\\t- '].join('\\n');",
	"  const target = resolveOutlinePasteTextAnchor(changed, anchor);",
	"  assert.ok(target);",
	"  assert.equal(target.targetLine, 2, 'ancestor context should disambiguate identical empty list items');",
	'}',
	'',
	'{',
	"  const group = ['- Group', '\\t- Same', '\\t- End'];",
	"  const original = [...group, ...group, ...group, ...group].join('\\n');",
	"  const anchor = createOutlinePasteTextAnchor(original, 4);",
	"  assert.ok(anchor);",
	"  const ambiguous = ['- Intro', ...group, ...group, ...group, ...group].join('\\n');",
	"  assert.equal(resolveOutlinePasteTextAnchor(ambiguous, anchor), null, 'ambiguous targets must abort instead of writing to an arbitrary location');",
	'}',
	'',
	'{',
	"  const original = ['- Parent', '- Next'].join('\\n');",
	"  const anchor = createOutlinePasteTextAnchor(original, 0);",
	"  assert.ok(anchor);",
	"  assert.equal(resolveOutlinePasteTextAnchor('- Next', anchor), null, 'deleted targets must not receive an insertion');",
	'}',
	'',
	"console.log('Outline paste target tests passed.');",
];

try {
	await mkdir(tempDir, { recursive: true });
	await writeFile(entryPath, lines.join('\n'), 'utf8');
	await build({
		entryPoints: [entryPath],
		outfile: bundlePath,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node18'],
	});
	await import(pathToFileURL(bundlePath).href);
} finally {
	await rm(tempDir, { recursive: true, force: true });
}
