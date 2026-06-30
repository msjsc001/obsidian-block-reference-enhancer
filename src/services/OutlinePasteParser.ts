import { measureIndentColumns } from '../utils/markdownFence';
import { isHtmlElement } from '../utils/dom';

const LIST_ITEM_REGEX = /^(\s*)(?:[-*+•◦▪](?:\s+(.*)|\s*)|\d+[.)]\s+(.*))$/;
const HEADING_REGEX = /^(\s*)(#{1,6})\s+(.*)$/;
const FENCED_CODE_OPENING_REGEX = /^[ \t]*(`{3,}|~{3,})(.*)$/;
const FENCED_CODE_CLOSING_REGEX = /^[ \t]*(`{3,}|~{3,})[ \t]*$/;
const SUPPORTED_HTML_TAG_REGEX = /<(\/?)(ul|ol|li|p|div|section|article|main|header|footer|aside|h[1-6]|blockquote|pre|code|table|strong|em|a|span)\b/gi;

const DEFAULT_HTML_MAX_BYTES = 128 * 1024;
const DEFAULT_TEXT_MAX_BYTES = 512 * 1024;
const DEFAULT_MAX_INPUT_LINES = 5000;
const DEFAULT_MAX_OUTPUT_BLOCKS = 3000;
const DEFAULT_MAX_DEPTH = 32;
const DEFAULT_MAX_OUTPUT_MARKDOWN_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_YIELD_BUDGET_MS = 4;

export interface OutlineNode {
	text: string;
	continuation: string[];
	children: OutlineNode[];
}

export interface OutlineClipboardPayload {
	html: string | null;
	text: string | null;
}

export interface OutlinePasteParserOptions {
	htmlToMarkdown?: (html: string) => string;
	htmlMaxBytes?: number;
	textMaxBytes?: number;
	maxInputLines?: number;
	maxOutputBlocks?: number;
	maxDepth?: number;
	maxOutputMarkdownBytes?: number;
	timeoutMs?: number;
	yieldBudgetMs?: number;
	now?: () => number;
	yieldToMainThread?: () => Promise<void>;
}

export interface OutlineParseResult {
	nodes: OutlineNode[];
	nodeCount: number;
	maxDepth: number;
	simplified: boolean;
	source: 'html' | 'text';
	markdownSource: string;
	maxOutputMarkdownBytes: number;
}

interface OutlineParseCandidate {
	nodes: OutlineNode[];
	nodeCount: number;
	maxDepth: number;
	mode: 'structured' | 'flat';
	source: 'html' | 'text';
	markdownSource: string;
	sourceHadStructure: boolean;
}

interface HtmlStructureInfo {
	structuralTagCount: number;
	totalSupportedTagCount: number;
}

interface RuntimeLimits {
	htmlMaxBytes: number;
	textMaxBytes: number;
	maxInputLines: number;
	maxOutputBlocks: number;
	maxDepth: number;
	maxOutputMarkdownBytes: number;
	timeoutMs: number;
	yieldBudgetMs: number;
	now: () => number;
	yieldToMainThread: () => Promise<void>;
	startedAt: number;
	lastYieldAt: number;
}

interface OutlineBlock {
	kind: 'list-item' | 'paragraph' | 'heading';
	indentColumns: number;
	node: OutlineNode;
	opensFollowingListCluster: boolean;
}

interface StackEntry {
	indentColumns: number;
	node: OutlineNode;
}

interface ActiveParagraphCluster {
	indentColumns: number;
	parentDepth: number;
}

export class OutlinePasteError extends Error {
	constructor(
		readonly code: 'empty' | 'unsupported' | 'too-large' | 'timeout',
		message: string,
	) {
		super(message);
	}
}

export async function parseOutlinePasteInput(
	payload: OutlineClipboardPayload,
	options: OutlinePasteParserOptions = {},
): Promise<OutlineParseResult> {
	const runtime = createRuntimeLimits(options);
	const html = normalizeClipboardText(payload.html);
	const text = normalizeClipboardText(payload.text);
	const candidates: OutlineParseCandidate[] = [];
	let lastError: OutlinePasteError | null = null;

	if (html) {
		if (getUtf8ByteLength(html) > runtime.htmlMaxBytes) {
			if (!text) {
				throw new OutlinePasteError('too-large', 'Clipboard HTML content is too large for outline paste.');
			}
		} else {
			const htmlStructureInfo = inspectHtmlStructure(html, runtime);
			if (htmlStructureInfo.structuralTagCount > 0 && options.htmlToMarkdown) {
				try {
					candidates.push(await parseHtmlCandidate(html, options.htmlToMarkdown, runtime));
				} catch (error) {
					if (error instanceof OutlinePasteError) {
						lastError = error;
					} else {
						lastError = new OutlinePasteError('unsupported', 'Clipboard HTML content is not supported for outline paste.');
					}
				}
			}
		}
	}

	if (text) {
		if (getUtf8ByteLength(text) > runtime.textMaxBytes) {
			if (candidates.length === 0) {
				throw new OutlinePasteError('too-large', 'Clipboard text content is too large for outline paste.');
			}
		} else {
			try {
				candidates.push(await parseCandidate(text, 'text', hasStructuredMarkdownHints(text), runtime));
			} catch (error) {
				if (error instanceof OutlinePasteError) {
					lastError = error;
				} else {
					lastError = new OutlinePasteError('unsupported', 'Clipboard text content is not supported for outline paste.');
				}
			}
		}
	}

	if (candidates.length === 0) {
		if (lastError) {
			throw lastError;
		}

		if (html) {
			throw new OutlinePasteError('unsupported', 'Clipboard content is not supported for outline paste.');
		}

		throw new OutlinePasteError('empty', 'Clipboard is empty.');
	}

	const bestCandidate = chooseBestCandidate(candidates);
	const simplified = bestCandidate.sourceHadStructure && bestCandidate.mode === 'flat';
	return {
		nodes: bestCandidate.nodes,
		nodeCount: bestCandidate.nodeCount,
		maxDepth: bestCandidate.maxDepth,
		simplified,
		source: bestCandidate.source,
		markdownSource: bestCandidate.markdownSource,
		maxOutputMarkdownBytes: runtime.maxOutputMarkdownBytes,
	};
}

function createRuntimeLimits(options: OutlinePasteParserOptions): RuntimeLimits {
	const now = options.now ?? (() => Date.now());
	return {
		htmlMaxBytes: options.htmlMaxBytes ?? DEFAULT_HTML_MAX_BYTES,
		textMaxBytes: options.textMaxBytes ?? DEFAULT_TEXT_MAX_BYTES,
		maxInputLines: options.maxInputLines ?? DEFAULT_MAX_INPUT_LINES,
		maxOutputBlocks: options.maxOutputBlocks ?? DEFAULT_MAX_OUTPUT_BLOCKS,
		maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
		maxOutputMarkdownBytes: options.maxOutputMarkdownBytes ?? DEFAULT_MAX_OUTPUT_MARKDOWN_BYTES,
		timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		yieldBudgetMs: options.yieldBudgetMs ?? DEFAULT_YIELD_BUDGET_MS,
		now,
		yieldToMainThread: options.yieldToMainThread ?? (() => new Promise((resolve) => window.setTimeout(resolve, 0))),
		startedAt: now(),
		lastYieldAt: now(),
	};
}

async function parseHtmlCandidate(
	html: string,
	htmlToMarkdown: (html: string) => string,
	runtime: RuntimeLimits,
): Promise<OutlineParseCandidate> {
	checkRuntimeLimits(runtime);
	const markdownSource = normalizeClipboardText(htmlToMarkdown(html)) ?? '';

	if (typeof DOMParser === 'undefined') {
		if (!markdownSource) {
			throw new OutlinePasteError('unsupported', 'Clipboard HTML content is not supported for outline paste.');
		}

		return parseCandidate(markdownSource, 'html', true, runtime);
	}

	const doc = new DOMParser().parseFromString(html, 'text/html');
	const blocks = await parseHtmlBlocks(Array.from(doc.body.childNodes), htmlToMarkdown, runtime, 0, 0);
	const nodes = materializeOutlineBlocks(blocks);
	if (nodes.length === 0) {
		if (!markdownSource) {
			throw new OutlinePasteError('empty', 'Clipboard is empty.');
		}

		return parseCandidate(markdownSource, 'html', true, runtime);
	}

	const stats = summarizeOutlineNodes(nodes);
	if (stats.nodeCount > runtime.maxOutputBlocks) {
		throw new OutlinePasteError('too-large', 'Converted outline contains too many blocks.');
	}

	if (stats.maxDepth > runtime.maxDepth) {
		throw new OutlinePasteError('too-large', 'Converted outline is too deeply nested.');
	}

	return {
		nodes,
		nodeCount: stats.nodeCount,
		maxDepth: stats.maxDepth,
		mode: 'structured',
		source: 'html',
		markdownSource,
		sourceHadStructure: true,
	};
}

async function parseCandidate(
	sourceText: string,
	source: 'html' | 'text',
	sourceHadStructure: boolean,
	runtime: RuntimeLimits,
): Promise<OutlineParseCandidate> {
	checkRuntimeLimits(runtime);
	const normalizedText = sourceText.replace(/\r\n?/g, '\n').trim();
	if (!normalizedText) {
		throw new OutlinePasteError('empty', 'Clipboard is empty.');
	}

	const lines = normalizedText.split('\n');
	if (lines.length > runtime.maxInputLines) {
		throw new OutlinePasteError('too-large', 'Clipboard content has too many lines for outline paste.');
	}

	const mode = hasStructuredMarkdownHints(normalizedText) ? 'structured' : 'flat';
	const nodes = mode === 'structured'
		? materializeOutlineBlocks(await parseStructuredBlocks(lines, runtime))
		: await parseFlatOutline(lines, runtime);

	const stats = summarizeOutlineNodes(nodes);
	if (stats.nodeCount === 0) {
		throw new OutlinePasteError('empty', 'Clipboard is empty.');
	}

	if (stats.nodeCount > runtime.maxOutputBlocks) {
		throw new OutlinePasteError('too-large', 'Converted outline contains too many blocks.');
	}

	if (stats.maxDepth > runtime.maxDepth) {
		throw new OutlinePasteError('too-large', 'Converted outline is too deeply nested.');
	}

	return {
		nodes,
		nodeCount: stats.nodeCount,
		maxDepth: stats.maxDepth,
		mode,
		source,
		markdownSource: normalizedText,
		sourceHadStructure,
	};
}

async function parseStructuredBlocks(lines: string[], runtime: RuntimeLimits): Promise<OutlineBlock[]> {
	const blocks: OutlineBlock[] = [];
	let fencedCodeMarker: string | null = null;
	let previousLineWasBlank = false;

	for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
		await maybeYield(runtime);
		const rawLine = lines[lineIndex];
		const trimmedLine = rawLine.trim();
		const leadingWhitespace = rawLine.match(/^(\s*)/)?.[1] ?? '';
		const indentColumns = measureIndentColumns(leadingWhitespace, 4);

		if (fencedCodeMarker) {
			appendContinuationToLastBlockOrCreateParagraph(blocks, rawLine.trimEnd(), indentColumns);
			if (isFencedCodeClosingLine(rawLine, fencedCodeMarker)) {
				fencedCodeMarker = null;
			}
			previousLineWasBlank = false;
			continue;
		}

		if (trimmedLine.length === 0) {
			previousLineWasBlank = true;
			continue;
		}

		const listMatch = rawLine.match(LIST_ITEM_REGEX);
		if (listMatch) {
			const listContent = listMatch[2] ?? listMatch[3] ?? '';
			blocks.push(createOutlineBlock('list-item', indentColumns, createOutlineNode(listContent.trimEnd())));
			previousLineWasBlank = false;
			continue;
		}

		const headingMatch = rawLine.match(HEADING_REGEX);
		if (headingMatch) {
			blocks.push(createOutlineBlock('heading', indentColumns, createOutlineNode(`${headingMatch[2]} ${headingMatch[3].trimEnd()}`.trim())));
			previousLineWasBlank = false;
			continue;
		}

		if (shouldStartStandaloneParagraphBlock(lines, lineIndex, blocks, indentColumns, previousLineWasBlank)) {
			blocks.push(createOutlineBlock('paragraph', indentColumns, createOutlineNode(rawLine.trimEnd().trim())));
			if (FENCED_CODE_OPENING_REGEX.test(rawLine)) {
				fencedCodeMarker = rawLine.match(FENCED_CODE_OPENING_REGEX)?.[1]?.[0] ?? null;
			}
			previousLineWasBlank = false;
			continue;
		}

		if (FENCED_CODE_OPENING_REGEX.test(rawLine)) {
			fencedCodeMarker = rawLine.match(FENCED_CODE_OPENING_REGEX)?.[1]?.[0] ?? null;
		}

		appendContinuationToLastBlockOrCreateParagraph(blocks, rawLine.trimEnd(), indentColumns);
		previousLineWasBlank = false;
	}

	markFollowingListClusters(blocks);
	return blocks;
}

async function parseFlatOutline(lines: string[], runtime: RuntimeLimits): Promise<OutlineNode[]> {
	const nodes: OutlineNode[] = [];
	for (const rawLine of lines) {
		await maybeYield(runtime);
		const trimmedLine = rawLine.trim();
		if (trimmedLine.length === 0) {
			continue;
		}

		const headingMatch = trimmedLine.match(/^(#{1,6})\s+(.*)$/);
		nodes.push(createOutlineNode(headingMatch ? `${headingMatch[1]} ${headingMatch[2]}` : trimmedLine));
	}

	return nodes;
}

async function parseHtmlBlocks(
	nodes: ChildNode[],
	htmlToMarkdown: (html: string) => string,
	runtime: RuntimeLimits,
	paragraphIndentColumns: number,
	listIndentColumns: number,
): Promise<OutlineBlock[]> {
	const blocks: OutlineBlock[] = [];
	const inlineBuffer = createHtmlInlineBuffer(nodes);

	const flushInlineBuffer = () => {
		const block = createOutlineBlockFromMarkdown(
			convertHtmlContainerToMarkdown(inlineBuffer, htmlToMarkdown),
			paragraphIndentColumns,
		);
		if (block) {
			blocks.push(block);
		}
		inlineBuffer.replaceChildren();
	};

	for (const node of nodes) {
		await maybeYield(runtime);

		if (node.nodeType === Node.TEXT_NODE) {
			if (node.textContent?.trim().length) {
				inlineBuffer.appendChild(node.cloneNode(true));
			}
			continue;
		}

		if (!isHtmlElement(node)) {
			continue;
		}

		const tagName = node.tagName.toLowerCase();
		if (tagName === 'ul' || tagName === 'ol') {
			flushInlineBuffer();
			blocks.push(...await parseHtmlListBlocks(node, htmlToMarkdown, runtime, listIndentColumns));
			continue;
		}

		if (isTransparentHtmlContainerTag(tagName)) {
			flushInlineBuffer();
			const nestedBlocks = await parseHtmlBlocks(
				Array.from(node.childNodes),
				htmlToMarkdown,
				runtime,
				paragraphIndentColumns,
				listIndentColumns,
			);
			if (nestedBlocks.length > 0) {
				blocks.push(...nestedBlocks);
				continue;
			}
		}

		if (isBlockHtmlTag(tagName)) {
			flushInlineBuffer();
			const block = createOutlineBlockFromMarkdown(
				convertHtmlElementToMarkdown(node, htmlToMarkdown),
				paragraphIndentColumns,
			);
			if (block) {
				blocks.push(block);
			}
			continue;
		}

		inlineBuffer.appendChild(node.cloneNode(true));
	}

	flushInlineBuffer();
	markFollowingListClusters(blocks);
	return blocks;
}

async function parseHtmlListBlocks(
	listElement: Element,
	htmlToMarkdown: (html: string) => string,
	runtime: RuntimeLimits,
	itemIndentColumns: number,
): Promise<OutlineBlock[]> {
	const blocks: OutlineBlock[] = [];
	for (const child of Array.from(listElement.children)) {
		await maybeYield(runtime);
		if (child.tagName.toLowerCase() !== 'li') {
			continue;
		}

		blocks.push(...await parseHtmlListItemBlocks(child, htmlToMarkdown, runtime, itemIndentColumns));
	}

	return blocks;
}

async function parseHtmlListItemBlocks(
	listItem: Element,
	htmlToMarkdown: (html: string) => string,
	runtime: RuntimeLimits,
	itemIndentColumns: number,
): Promise<OutlineBlock[]> {
	const blocks = await parseHtmlBlocks(
		Array.from(listItem.childNodes),
		htmlToMarkdown,
		runtime,
		itemIndentColumns,
		itemIndentColumns + 1,
	);

	if (blocks.length === 0) {
		return [];
	}

	const [firstBlock, ...restBlocks] = blocks;
	const listItemBlock = createOutlineBlock(
		'list-item',
		itemIndentColumns,
		firstBlock.kind === 'list-item' && firstBlock.indentColumns > itemIndentColumns
			? createOutlineNode('')
			: firstBlock.node,
	);

	if (firstBlock.kind === 'list-item' && firstBlock.indentColumns > itemIndentColumns) {
		return [listItemBlock, firstBlock, ...restBlocks];
	}

	return [listItemBlock, ...restBlocks];
}

function materializeOutlineBlocks(blocks: OutlineBlock[]): OutlineNode[] {
	const roots: OutlineNode[] = [];
	const stack: StackEntry[] = [];
	let activeParagraphCluster: ActiveParagraphCluster | null = null;

	for (const block of blocks) {
		if (activeParagraphCluster && block.indentColumns <= activeParagraphCluster.indentColumns) {
			while (stack.length > activeParagraphCluster.parentDepth) {
				stack.pop();
			}
			activeParagraphCluster = null;
		}

		if (block.kind === 'list-item' || block.kind === 'heading') {
			while (stack.length > 0 && block.indentColumns <= stack[stack.length - 1].indentColumns) {
				stack.pop();
			}

			const parentNode = stack.length > 0 ? stack[stack.length - 1].node : null;
			if (parentNode) {
				parentNode.children.push(block.node);
			} else {
				roots.push(block.node);
			}

			stack.push({ indentColumns: block.indentColumns, node: block.node });
			continue;
		}

		const parentNode = stack.length > 0 ? stack[stack.length - 1].node : null;
		if (parentNode) {
			parentNode.children.push(block.node);
		} else {
			roots.push(block.node);
		}

		if (block.opensFollowingListCluster) {
			const parentDepth = stack.length;
			stack.push({ indentColumns: block.indentColumns, node: block.node });
			activeParagraphCluster = {
				indentColumns: block.indentColumns,
				parentDepth,
			};
		}
	}

	return roots;
}

function createOutlineBlock(kind: OutlineBlock['kind'], indentColumns: number, node: OutlineNode): OutlineBlock {
	return {
		kind,
		indentColumns,
		node,
		opensFollowingListCluster: false,
	};
}

function createOutlineBlockFromMarkdown(markdown: string | null, indentColumns: number): OutlineBlock | null {
	const normalized = normalizeClipboardText(markdown);
	if (!normalized) {
		return null;
	}

	const node = createOutlineNodeFromMarkdown(normalized);
	if (!node) {
		return null;
	}

	const firstLine = normalized.replace(/\r\n?/g, '\n').split('\n')[0]?.trim() ?? '';
	return createOutlineBlock(HEADING_REGEX.test(firstLine) ? 'heading' : 'paragraph', indentColumns, node);
}

function appendContinuationToLastBlockOrCreateParagraph(blocks: OutlineBlock[], line: string, indentColumns: number) {
	if (blocks.length === 0) {
		blocks.push(createOutlineBlock('paragraph', indentColumns, createOutlineNode(line.trim())));
		return;
	}

	blocks[blocks.length - 1].node.continuation.push(line);
}

function markFollowingListClusters(blocks: OutlineBlock[]) {
	for (let index = 0; index < blocks.length; index++) {
		const block = blocks[index];
		if (block.kind !== 'paragraph') {
			block.opensFollowingListCluster = false;
			continue;
		}

		const nextBlock = blocks[index + 1];
		block.opensFollowingListCluster = !!nextBlock
			&& nextBlock.kind === 'list-item'
			&& nextBlock.indentColumns > block.indentColumns;
	}
}

function shouldStartStandaloneParagraphBlock(
	lines: string[],
	lineIndex: number,
	blocks: OutlineBlock[],
	indentColumns: number,
	previousLineWasBlank: boolean,
): boolean {
	if (blocks.length === 0 || previousLineWasBlank) {
		return true;
	}

	if (hasFollowingDeeperListCluster(lines, lineIndex, indentColumns)) {
		return true;
	}

	const previousBlock = blocks[blocks.length - 1];
	return previousBlock.kind === 'list-item' && indentColumns <= previousBlock.indentColumns;
}

function hasFollowingDeeperListCluster(lines: string[], lineIndex: number, indentColumns: number): boolean {
	for (let nextIndex = lineIndex + 1; nextIndex < lines.length; nextIndex++) {
		const nextLine = lines[nextIndex];
		if (!nextLine.trim()) {
			continue;
		}

		const listMatch = nextLine.match(LIST_ITEM_REGEX);
		if (!listMatch) {
			return false;
		}

		const listIndent = measureIndentColumns(listMatch[1], 4);
		return listIndent > indentColumns;
	}

	return false;
}

function createHtmlInlineBuffer(nodes: ChildNode[]): HTMLElement {
	const ownerDocument = nodes.find((node) => node.ownerDocument)?.ownerDocument
		?? new DOMParser().parseFromString('', 'text/html');
	return ownerDocument.createElement('div');
}

function isTransparentHtmlContainerTag(tagName: string): boolean {
	return tagName === 'div'
		|| tagName === 'section'
		|| tagName === 'article'
		|| tagName === 'main'
		|| tagName === 'header'
		|| tagName === 'footer'
		|| tagName === 'aside';
}

function isBlockHtmlTag(tagName: string): boolean {
	return tagName === 'p'
		|| /^h[1-6]$/.test(tagName)
		|| tagName === 'blockquote'
		|| tagName === 'pre'
		|| tagName === 'table';
}

function chooseBestCandidate(candidates: OutlineParseCandidate[]): OutlineParseCandidate {
	return [...candidates].sort((left, right) => scoreCandidate(right) - scoreCandidate(left))[0];
}

function scoreCandidate(candidate: OutlineParseCandidate): number {
	let score = candidate.nodeCount * 2;
	score += candidate.maxDepth * 20;
	if (candidate.mode === 'structured') {
		score += 100;
	}

	if (candidate.source === 'html') {
		score += 10;
	}

	return score;
}

function hasStructuredMarkdownHints(text: string): boolean {
	if (LIST_ITEM_REGEX.test(text) || HEADING_REGEX.test(text)) {
		return true;
	}

	return text.split('\n').some((line) => {
		return LIST_ITEM_REGEX.test(line)
			|| HEADING_REGEX.test(line);
	});
}

function inspectHtmlStructure(html: string, runtime: RuntimeLimits): HtmlStructureInfo {
	checkRuntimeLimits(runtime);
	let structuralTagCount = 0;
	let totalSupportedTagCount = 0;
	let match: RegExpExecArray | null;

	SUPPORTED_HTML_TAG_REGEX.lastIndex = 0;
	while ((match = SUPPORTED_HTML_TAG_REGEX.exec(html)) !== null) {
		totalSupportedTagCount += 1;
		if (match[1] === '') {
			structuralTagCount += 1;
		}

		if (totalSupportedTagCount > runtime.maxInputLines) {
			throw new OutlinePasteError('too-large', 'Clipboard HTML structure is too large for outline paste.');
		}
	}

	return { structuralTagCount, totalSupportedTagCount };
}

function summarizeOutlineNodes(nodes: OutlineNode[]): { nodeCount: number; maxDepth: number } {
	let nodeCount = 0;
	let maxDepth = 0;

	const visit = (node: OutlineNode, depth: number) => {
		nodeCount += 1;
		maxDepth = Math.max(maxDepth, depth);
		node.children.forEach((child) => visit(child, depth + 1));
	};

	nodes.forEach((node) => visit(node, 1));
	return { nodeCount, maxDepth };
}

function createOutlineNode(text: string): OutlineNode {
	return {
		text,
		continuation: [],
		children: [],
	};
}

function createOutlineNodeFromMarkdown(markdown: string | null): OutlineNode | null {
	const normalized = normalizeClipboardText(markdown);
	if (!normalized) {
		return null;
	}

	const lines = normalized
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map((line) => line.trimEnd())
		.filter((line) => line.trim().length > 0);
	if (lines.length === 0) {
		return null;
	}

	const firstLine = lines[0].trim();
	const headingMatch = firstLine.match(/^(#{1,6})\s+(.*)$/);
	const node = createOutlineNode(headingMatch ? `${headingMatch[1]} ${headingMatch[2]}` : firstLine);
	for (const line of lines.slice(1)) {
		node.continuation.push(line);
	}

	return node;
}

function convertHtmlElementToMarkdown(element: Element, htmlToMarkdown: (html: string) => string): string | null {
	return normalizeClipboardText(htmlToMarkdown(element.outerHTML));
}

function convertHtmlContainerToMarkdown(container: HTMLElement, htmlToMarkdown: (html: string) => string): string | null {
	if (!container.innerHTML.trim()) {
		return normalizeClipboardText(container.textContent ?? '');
	}

	return normalizeClipboardText(htmlToMarkdown(container.innerHTML));
}

function normalizeClipboardText(value: string | null | undefined): string | null {
	if (typeof value !== 'string') {
		return null;
	}

	const normalized = value.replace(/\r\n?/g, '\n').trim();
	return normalized.length > 0 ? normalized : null;
}

function isFencedCodeClosingLine(line: string, openingMarkerChar: string): boolean {
	const match = line.match(FENCED_CODE_CLOSING_REGEX);
	return !!match && match[1][0] === openingMarkerChar;
}

function getUtf8ByteLength(value: string): number {
	return new TextEncoder().encode(value).length;
}

function checkRuntimeLimits(runtime: RuntimeLimits) {
	if (runtime.now() - runtime.startedAt > runtime.timeoutMs) {
		throw new OutlinePasteError('timeout', 'Outline paste conversion timed out.');
	}
}

async function maybeYield(runtime: RuntimeLimits) {
	checkRuntimeLimits(runtime);
	const now = runtime.now();
	if (now - runtime.lastYieldAt < runtime.yieldBudgetMs) {
		return;
	}

	runtime.lastYieldAt = now;
	await runtime.yieldToMainThread();
	checkRuntimeLimits(runtime);
}
