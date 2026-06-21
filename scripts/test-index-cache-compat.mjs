import { build } from 'esbuild';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const rootDir = process.cwd();
const tempDir = path.join(rootDir, 'scripts', '.tmp-index-cache-compat-test');
const entryPath = path.join(tempDir, 'entry.ts');
const bundlePath = path.join(tempDir, 'bundle.mjs');

const projectImport = (relativePath) => JSON.stringify(path.resolve(rootDir, relativePath).replace(/\\/g, '/'));

const lines = [
  "import assert from 'node:assert/strict';",
  'import {',
  '  INDEX_CACHE_PARSER_REVISION,',
  '  INDEX_CACHE_SCHEMA_VERSION,',
  '  resolveIndexCacheCompatibility,',
  `} from ${projectImport('src/services/IndexCacheCompatibility.ts')};`,
  '',
  '{',
  "  assert.deepEqual(resolveIndexCacheCompatibility(null), { state: 'missing' }, 'missing cache should be reported as missing');",
  '}',
  '',
  '{',
  "  assert.deepEqual(resolveIndexCacheCompatibility([]), { state: 'invalidated' }, 'legacy array cache should be invalidated');",
  '}',
  '',
  '{',
  '  const v3Cache = {',
  '    schemaVersion: 3,',
  '    builtAt: 1,',
  '    files: {},',
  '    blocks: {},',
  '    refsById: {},',
  '    sourceBlocksByFile: {},',
  '  };',
  "  assert.deepEqual(resolveIndexCacheCompatibility(v3Cache), { state: 'invalidated' }, 'schema v3 cache should be invalidated');",
  '}',
  '',
  '{',
  '  const outdatedParserCache = {',
  '    schemaVersion: INDEX_CACHE_SCHEMA_VERSION,',
  '    parserRevision: INDEX_CACHE_PARSER_REVISION + 1,',
  '    builtAt: 1,',
  '    files: {},',
  '    blocks: {},',
  '    refsById: {},',
  '    sourceBlocksByFile: {},',
  '  };',
  "  assert.deepEqual(resolveIndexCacheCompatibility(outdatedParserCache), { state: 'invalidated' }, 'parser revision mismatch should invalidate cache');",
  '}',
  '',
  '{',
  '  const incompleteCache = {',
  '    schemaVersion: INDEX_CACHE_SCHEMA_VERSION,',
  '    parserRevision: INDEX_CACHE_PARSER_REVISION,',
  '    builtAt: 1,',
  '    files: {},',
  '    blocks: {},',
  '    refsById: {},',
  '  };',
  "  assert.deepEqual(resolveIndexCacheCompatibility(incompleteCache), { state: 'invalidated' }, 'incomplete cache payload should be invalidated');",
  '}',
  '',
  '{',
  '  const currentCache = {',
  '    schemaVersion: INDEX_CACHE_SCHEMA_VERSION,',
  '    parserRevision: INDEX_CACHE_PARSER_REVISION,',
  '    builtAt: 1,',
  '    files: {},',
  '    blocks: {},',
  '    refsById: {},',
  '    sourceBlocksByFile: {},',
  '  };',
  '  const result = resolveIndexCacheCompatibility(currentCache);',
  "  assert.equal(result.state, 'current', 'current cache should stay loadable');",
  "  assert.equal(result.cache, currentCache, 'current cache should be returned for loading');",
  '}',
  '',
  "console.log('Index cache compatibility tests passed.');",
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
