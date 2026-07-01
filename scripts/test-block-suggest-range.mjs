import { build } from 'esbuild';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const rootDir = process.cwd();
const tempDir = path.join(rootDir, 'scripts', '.tmp-block-suggest-range-test');
const entryPath = path.join(tempDir, 'entry.ts');
const bundlePath = path.join(tempDir, 'bundle.mjs');
const projectImport = JSON.stringify(path.resolve(rootDir, 'src/editor/BlockSuggestRange.ts').replace(/\\/g, '/'));

const lines = [
	"import assert from 'node:assert/strict';",
	`import { matchesBlockSuggestContext, resolveBlockSuggestEditEndCh } from ${projectImport};`,
	'',
	"assert.equal(resolveBlockSuggestEditEndCh('((query', 7), 7, 'missing close pair should keep the original end');",
	"assert.equal(resolveBlockSuggestEditEndCh('((query))', 7), 9, 'adjacent close pair should be consumed');",
	"assert.equal(resolveBlockSuggestEditEndCh('((query))))', 7), 9, 'only one adjacent close pair should be consumed');",
	"assert.equal(resolveBlockSuggestEditEndCh('((query)', 7), 7, 'a single close parenthesis should not be consumed');",
	"assert.equal(resolveBlockSuggestEditEndCh('((query ))', 7), 7, 'a close pair after whitespace should not be consumed');",
	'',
	"assert.equal(matchesBlockSuggestContext('- before ((query)) after', 9, 16, 'query'), true, 'the current trigger range should match');",
	"assert.equal(matchesBlockSuggestContext('- before changed', 9, 16, 'query'), false, 'stale editor context should be rejected');",
	"assert.equal(matchesBlockSuggestContext('((query', -1, 7, 'query'), false, 'invalid ranges should be rejected');",
	'',
	"console.log('Block suggest range tests passed.');",
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
