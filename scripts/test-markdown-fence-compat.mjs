import { build } from 'esbuild';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const rootDir = process.cwd();
const tempDir = path.join(rootDir, 'scripts', '.tmp-markdown-fence-test');
const entryPath = path.join(tempDir, 'entry.ts');
const bundlePath = path.join(tempDir, 'bundle.mjs');

const projectImport = (relativePath) => JSON.stringify(path.resolve(rootDir, relativePath).replace(/\\/g, '/'));

const lines = [
  "import assert from 'node:assert/strict';",
  `import { BlockParser } from ${projectImport('src/services/BlockParser.ts')};`,
  'import {',
  '  DEFAULT_HIDDEN_LOGSEQ_PROPERTY_KEYS,',
  '  buildHiddenLogseqPropertyMatcher,',
  '  collectHiddenLogseqPropertyLineNumbers,',
  `} from ${projectImport('src/services/LogseqPropertyMatcher.ts')};`,
  'import {',
  '  getOpeningMarkdownFenceState,',
  '  isClosingMarkdownFence,',
  `} from ${projectImport('src/utils/markdownFence.ts')};`,
  '',
  "const ignoredUuid = '11111111-1111-1111-1111-111111111111';",
  "const sourceUuid = '22222222-2222-2222-2222-222222222222';",
  "const fencedBlockUuid = '33333333-3333-3333-3333-333333333333';",
  '',
  '{',
  "  const fenceState = getOpeningMarkdownFenceState('\\t- \`\`\`calc', 4);",
  "  assert.ok(fenceState, 'list-item fenced block opening should be detected');",
  "  assert.equal(getOpeningMarkdownFenceState('\\t  \`\`\`\`', 4), null, 'closing fence line must not be mistaken for a new opening fence');",
  "  assert.ok(isClosingMarkdownFence('\\t  \`\`\`\`', fenceState, 4), 'list-item fenced block closing line should be detected');",
  '}',
  '',
  '{',
  '  const doc = [',
  "    '\\t- \`\`\`calc',",
  "    '\\t  ((' + ignoredUuid + '))',",
  "    '\\t  id:: ' + ignoredUuid,",
  "    '\\t  \`\`\`\`',",
  "    '- later block',",
  "    '  id:: ' + sourceUuid,",
  "    '- ((' + sourceUuid + '))',",
  "    '- {{embed ((' + sourceUuid + '))}}',",
  "  ].join('\\n');",
  "  const parsed = new BlockParser().parse('fixture.md', doc);",
  "  assert.equal(parsed.blocks.has(sourceUuid), true, 'source block after list fenced block should still be indexed');",
  "  assert.equal(parsed.referencesById.get(ignoredUuid)?.length ?? 0, 0, 'references inside fenced code must be ignored');",
  "  assert.equal(parsed.referencesById.get(sourceUuid)?.length ?? 0, 2, 'references after fenced code must still be found');",
  '}',
  '',
  '{',
  '  const doc = [',
  "    '- \`\`\`calc',",
  "    '  1 + 1',",
  "    '  \`\`\`\`',",
  "    '  id:: ' + fencedBlockUuid,",
  "    '- ((' + fencedBlockUuid + '))',",
  "  ].join('\\n');",
  "  const parsed = new BlockParser().parse('fenced-source.md', doc);",
  "  assert.equal(parsed.blocks.has(fencedBlockUuid), true, 'property line after fenced block closing should still attach to the list item source block');",
  "  assert.equal(parsed.referencesById.get(fencedBlockUuid)?.length ?? 0, 1, 'reference after fenced source block should be found');",
  '}',
  '',
  '{',
  '  const matcher = buildHiddenLogseqPropertyMatcher(DEFAULT_HIDDEN_LOGSEQ_PROPERTY_KEYS);',
  '  const doc = [',
  "    '- \`\`\`calc',",
  "    '  id:: ' + ignoredUuid,",
  "    '  \`\`\`\`',",
  "    '  hl-page:: 3',",
  "    '- later block',",
  "    '  id:: ' + sourceUuid,",
  "  ].join('\\n');",
  "  const hidden = Array.from(collectHiddenLogseqPropertyLineNumbers(doc, matcher)).sort((left, right) => left - right);",
  "  assert.deepEqual(hidden, [4, 6], 'hidden-property scan should ignore code fence internals but still hide properties after the fenced block closes');",
  '}',
  '',
  "console.log('Markdown fence compatibility tests passed.');",
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
