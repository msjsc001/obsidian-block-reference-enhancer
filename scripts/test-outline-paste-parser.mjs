import { build } from 'esbuild';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const rootDir = process.cwd();
const tempDir = path.join(rootDir, 'scripts', '.tmp-outline-paste-parser-test');
const entryPath = path.join(tempDir, 'entry.ts');
const bundlePath = path.join(tempDir, 'bundle.mjs');

const projectImport = (relativePath) => JSON.stringify(path.resolve(rootDir, relativePath).replace(/\\/g, '/'));

const lines = [
	"import assert from 'node:assert/strict';",
	`import { resolveOutlinePasteInsertionContext } from ${projectImport('src/editor/UnorderedListStructure.ts')};`,
	`import { resolveUnorderedListSubtree } from ${projectImport('src/editor/UnorderedListStructure.ts')};`,
	`import { parseOutlinePasteInput } from ${projectImport('src/services/OutlinePasteParser.ts')};`,
	`import { renderOutlineNodes } from ${projectImport('src/services/OutlinePasteRenderer.ts')};`,
	'',
	'{',
	"  const result = await parseOutlinePasteInput({ html: null, text: 'Alpha\\nBeta' });",
	"  assert.equal(result.nodeCount, 2, 'plain multi-line text should become two outline blocks');",
	"  assert.equal(result.maxDepth, 1, 'plain multi-line text should stay flat');",
	"  assert.equal(result.simplified, false, 'plain multi-line text is a direct flat conversion, not a degradation');",
	"  assert.equal(renderOutlineNodes(result.nodes, '\\t- ', '\\t'), '\\t- Alpha\\n\\t- Beta', 'flat nodes should render as sibling child blocks');",
	'}',
	'',
	'{',
	"  const markdown = '- Parent\\n  - Child\\n    - Grandchild\\n# Heading';",
	'  const result = await parseOutlinePasteInput({ html: null, text: markdown });',
	"  assert.equal(result.nodeCount, 4, 'markdown list plus heading should produce four blocks');",
	"  assert.equal(result.maxDepth, 3, 'nested markdown should preserve child depth');",
	"  assert.equal(result.simplified, false, 'explicit markdown hierarchy should stay structured');",
	"  assert.equal(renderOutlineNodes(result.nodes, '- ', '\\t'), '- Parent\\n\\t- Child\\n\\t\\t- Grandchild\\n- # Heading', 'headings should be preserved as outline block text');",
	'}',
	'',
	'{',
	"  const payload = {",
	"    html: '<ul><li>Main<ul><li>Sub</li></ul></li></ul>',",
	"    text: 'Main\\nSub',",
	'  };',
	"  const result = await parseOutlinePasteInput(payload, { htmlToMarkdown: () => '- Main\\n  - Sub' });",
	"  assert.equal(result.source, 'html', 'structured HTML markdown should beat flattened plain text');",
	"  assert.equal(result.maxDepth, 2, 'HTML-derived markdown should preserve nested outline depth');",
	'}',
	'',
	'{',
	"  const result = await parseOutlinePasteInput({ html: null, text: '• Parent\\n  • Child\\n• Sibling' });",
	"  assert.equal(result.maxDepth, 2, 'plain text bullet characters should be recognized as nested outline items');",
	"  assert.equal(renderOutlineNodes(result.nodes, '- ', '\\t'), '- Parent\\n\\t- Child\\n- Sibling', 'bullet character lists should normalize to unordered markdown blocks');",
	'}',
	'',
	'{',
	"  const doc = ['- 1A', '  id:: uuid', '\\t- 2', '\\t\\t- 3', '- 2A'].join('\\n');",
	'  const context = resolveOutlinePasteInsertionContext(doc, 0);',
	"  assert.ok(context, 'top-level unordered list item should be a valid paste target');",
	"  assert.equal(context.rootInsertionPrefix, '\\t- ', 'inserted outline children should use tab indentation');",
	"  assert.equal(doc.slice(context.insertOffset), '\\t- 2\\n\\t\\t- 3\\n- 2A', 'insertion point should land before the first direct child');",
	'}',
	'',
	'{',
	"  const doc = ['- Parent', '  continuation', '- Next'].join('\\n');",
	'  const context = resolveOutlinePasteInsertionContext(doc, 0);',
	"  assert.ok(context, 'unordered list item with continuation should still be a valid paste target');",
	"  assert.equal(context.rootInsertionPrefix, '\\t- ', 'a new child prefix should default to tab indentation when no direct child exists yet');",
	"  assert.equal(doc.slice(context.insertOffset), '- Next', 'insertion point should land after the parent continuation tail');",
	'}',
	'',
	'{',
	"  const doc = ['- ', '- Next'].join('\\n');",
	'  const context = resolveOutlinePasteInsertionContext(doc, 0);',
	"  assert.ok(context, 'empty unordered list item should still be a valid paste target');",
	"  assert.equal(context.rootInsertionPrefix, '\\t- ', 'empty unordered list targets should also synthesize tab-indented child prefixes');",
	'}',
	'',
	'{',
	"  const doc = ['-', '- Next'].join('\\n');",
	'  const context = resolveOutlinePasteInsertionContext(doc, 0);',
	"  assert.ok(context, 'bare unordered list markers should still be valid paste targets');",
	"  assert.equal(context.rootInsertionPrefix, '\\t- ', 'bare unordered list markers should synthesize the same tab-indented child prefix');",
	'}',
	'',
	'{',
	"  const markdown = ['不需要吹，不需要推广腔。最有力的是：', '  - “Logseq MD 用户迁 Obsidian：块引用和块嵌入如何保留？”', '  - 讲清楚：', '    - 什么能保留；'].join('\\n');",
	'  const result = await parseOutlinePasteInput({ html: null, text: markdown });',
	"  assert.equal(result.nodeCount, 4, 'standalone text followed by a deeper list should become a parent node');",
	"  assert.equal(result.maxDepth, 3, 'standalone parent nodes should preserve their nested list depth');",
	"  assert.equal(renderOutlineNodes(result.nodes, '\\t- ', '\\t'), '\\t- 不需要吹，不需要推广腔。最有力的是：\\n\\t\\t- “Logseq MD 用户迁 Obsidian：块引用和块嵌入如何保留？”\\n\\t\\t- 讲清楚：\\n\\t\\t\\t- 什么能保留；', 'standalone intro text should become the parent of the following deeper list cluster');",
	'}',
	'',
	'{',
	"  const markdown = ['- **如果想让它被知道，最小动作其实不是营销，而是写一个“场景文章”。**', '不需要吹，不需要推广腔。最有力的是：', '  - **“Logseq MD 用户迁 Obsidian：块引用和块嵌入如何保留？”**', '  - 讲清楚：', '    - 什么能保留；', '这样它才会从“一个插件”变成“一个迁移方案”。'].join('\\n');",
	'  const result = await parseOutlinePasteInput({ html: null, text: markdown });',
	"  assert.equal(renderOutlineNodes(result.nodes, '- ', '\\t'), '- **如果想让它被知道，最小动作其实不是营销，而是写一个“场景文章”。**\\n\\t- 不需要吹，不需要推广腔。最有力的是：\\n\\t\\t- **“Logseq MD 用户迁 Obsidian：块引用和块嵌入如何保留？”**\\n\\t\\t- 讲清楚：\\n\\t\\t\\t- 什么能保留；\\n\\t- 这样它才会从“一个插件”变成“一个迁移方案”。', 'paragraph + list cluster + trailing paragraph should stay inside the same parent block');",
	'}',
	'',
	'{',
	"  const doc = ['\\t- Parent', '\\t  id:: uuid', '\\t  continuation', '\\t\\t- Child', '\\t\\t  child continuation', '- Sibling'].join('\\n');",
	'  const subtree = resolveUnorderedListSubtree(doc, 0);',
	"  assert.ok(subtree, 'copy current level should resolve the full subtree for unordered list blocks');",
	"  assert.equal(subtree.normalizedMarkdown, ['- Parent', '  id:: uuid', '  continuation', '\\t- Child', '\\t  child continuation'].join('\\n'), 'copied subtree markdown should remove only the root leading indentation and preserve relative structure');",
	'}',
	'',
	"console.log('Outline paste parser tests passed.');",
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
