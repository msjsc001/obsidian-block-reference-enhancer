import type { BlockCache } from '../types';
import { normalizeEmbedChildrenMarkdown, measureIndentColumns, removeLeadingIndentColumns } from '../utils/blockMarkdown';
import { getOpeningMarkdownFenceState, isClosingMarkdownFence, type MarkdownFenceState } from '../utils/markdownFence';

const UUID_PATTERN = '[A-Za-z0-9_-]{36,}';
const STANDALONE_EMBED_LINE_REGEX = new RegExp(
	`^([ \\t]*)(-\\s+)?\\{\\{embed\\s+\\(\\((${UUID_PATTERN})\\)\\)\\s*\\}\\}([ \\t]*)$`,
);
const DEFAULT_MAX_DEPTH = 16;
const DEFAULT_MAX_OUTPUT_CHARS = 1024 * 1024;

export interface UuidSelectionCopyResolver {
	resolveBlock(uuid: string): BlockCache | null;
	resolveInlineSummary(uuid: string): string | null;
}

export interface UuidSelectionCopyOptions {
	maxDepth?: number;
	maxOutputChars?: number;
}

export interface UuidSelectionCopyResult {
	text: string;
	replacementCount: number;
}

export class UuidSelectionCopyError extends Error {
	constructor(readonly code: 'output-too-large', message: string) {
		super(message);
		this.name = 'UuidSelectionCopyError';
	}
}

interface ConversionContext {
	resolver: UuidSelectionCopyResolver;
	maxDepth: number;
	maxOutputChars: number;
	replacementCount: number;
}

interface ConversionState {
	depth: number;
	visitedEmbeds: Set<string>;
}

interface LinePart {
	text: string;
	ending: string;
}

export function containsUuidBlockSyntaxOutsideCode(text: string): boolean {
	let fenceState: MarkdownFenceState | null = null;
	for (const line of splitLinesPreservingEndings(text)) {
		if (fenceState) {
			if (isClosingMarkdownFence(line.text, fenceState)) {
				fenceState = null;
			}
			continue;
		}

		const openingFence = getOpeningMarkdownFenceState(line.text);
		if (openingFence) {
			fenceState = openingFence;
			continue;
		}

		if (containsSyntaxOutsideInlineCode(line.text)) {
			return true;
		}
	}

	return false;
}

export function convertUuidSelectionToText(
	selectedMarkdown: string,
	resolver: UuidSelectionCopyResolver,
	options: UuidSelectionCopyOptions = {},
): UuidSelectionCopyResult {
	const context: ConversionContext = {
		resolver,
		maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
		maxOutputChars: options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS,
		replacementCount: 0,
	};
	assertWithinOutputLimit(selectedMarkdown, context.maxOutputChars);

	const text = convertMarkdownText(selectedMarkdown, context, {
		depth: 0,
		visitedEmbeds: new Set<string>(),
	});
	assertWithinOutputLimit(text, context.maxOutputChars);
	return { text, replacementCount: context.replacementCount };
}

function convertMarkdownText(text: string, context: ConversionContext, state: ConversionState): string {
	let fenceState: MarkdownFenceState | null = null;
	let result = '';

	for (const line of splitLinesPreservingEndings(text)) {
		let convertedLine = line.text;
		if (fenceState) {
			if (isClosingMarkdownFence(line.text, fenceState)) {
				fenceState = null;
			}
		} else {
			const openingFence = getOpeningMarkdownFenceState(line.text);
			if (openingFence) {
				fenceState = openingFence;
			} else {
				convertedLine = convertMarkdownLine(line.text, context, state);
			}
		}

		result += convertedLine + line.ending;
		assertWithinOutputLimit(result, context.maxOutputChars);
	}

	return result;
}

function convertMarkdownLine(line: string, context: ConversionContext, state: ConversionState): string {
	const standaloneEmbed = line.match(STANDALONE_EMBED_LINE_REGEX);
	if (standaloneEmbed) {
		context.replacementCount += 1;
		return renderEmbedAsOutline(standaloneEmbed[3], standaloneEmbed[1] ?? '', context, state);
	}

	return transformOutsideInlineCode(line, (segment) => replaceInlineUuidSyntax(segment, context));
}

function renderEmbedAsOutline(
	uuid: string,
	hostIndent: string,
	context: ConversionContext,
	state: ConversionState,
): string {
	if (state.visitedEmbeds.has(uuid)) {
		return `${hostIndent}- [Cyclic block]`;
	}

	if (state.depth >= context.maxDepth) {
		return `${hostIndent}- [Embed depth limit reached]`;
	}

	const block = context.resolver.resolveBlock(uuid);
	if (!block) {
		return `${hostIndent}- [Missing block]`;
	}

	const nextVisited = new Set(state.visitedEmbeds);
	nextVisited.add(uuid);
	const blockMarkdown = buildBlockOutlineMarkdown(block);
	const converted = convertMarkdownText(blockMarkdown, context, {
		depth: state.depth + 1,
		visitedEmbeds: nextVisited,
	});
	return prefixNonEmptyLines(converted, hostIndent);
}

function buildBlockOutlineMarkdown(block: BlockCache): string {
	const rawLines = normalizeBlockRootLines(block.rawContent);
	const firstLine = rawLines[0]?.trimEnd() || '[Empty block]';
	const lines = [`- ${firstLine}`];

	for (const line of rawLines.slice(1)) {
		lines.push(line.length > 0 ? `  ${line}` : '');
	}

	const childrenMarkdown = normalizeEmbedChildrenMarkdown(block.childrenMarkdown ?? '');
	if (childrenMarkdown) {
		for (const line of childrenMarkdown.split('\n')) {
			lines.push(line.length > 0 ? `\t${line}` : '');
		}
	}

	return lines.join('\n');
}

function normalizeBlockRootLines(rawContent: string): string[] {
	const lines = rawContent.split(/\r?\n/);
	while (lines.length > 1 && lines[lines.length - 1].trim().length === 0) {
		lines.pop();
	}

	const continuationIndents = lines
		.slice(1)
		.filter((line) => line.trim().length > 0)
		.map((line) => measureIndentColumns(line.match(/^([ \t]*)/)?.[1] ?? ''));
	const sharedIndent = continuationIndents.length > 0 ? Math.min(...continuationIndents) : 0;
	if (sharedIndent <= 0) {
		return lines;
	}

	return [
		lines[0],
		...lines.slice(1).map((line) => removeLeadingIndentColumns(line, sharedIndent)),
	];
}

function replaceInlineUuidSyntax(segment: string, context: ConversionContext): string {
	const syntaxRegex = createUuidSyntaxRegex();
	return segment.replace(syntaxRegex, (_match, embedUuid: string | undefined, inlineUuid: string | undefined, fullwidthUuid: string | undefined) => {
		context.replacementCount += 1;
		const uuid = embedUuid ?? inlineUuid ?? fullwidthUuid;
		return uuid ? context.resolver.resolveInlineSummary(uuid) ?? '[Missing block]' : _match;
	});
}

function containsSyntaxOutsideInlineCode(line: string): boolean {
	let found = false;
	transformOutsideInlineCode(line, (segment) => {
		if (createUuidSyntaxRegex().test(segment)) {
			found = true;
		}
		return segment;
	});
	return found;
}

function transformOutsideInlineCode(line: string, transform: (segment: string) => string): string {
	let result = '';
	let plainStart = 0;
	let cursor = 0;

	while (cursor < line.length) {
		if (line[cursor] !== '`') {
			cursor += 1;
			continue;
		}

		result += transform(line.slice(plainStart, cursor));
		const delimiterLength = countRun(line, cursor, '`');
		const delimiter = '`'.repeat(delimiterLength);
		const closingIndex = line.indexOf(delimiter, cursor + delimiterLength);
		if (closingIndex === -1) {
			return result + line.slice(cursor);
		}

		const codeEnd = closingIndex + delimiterLength;
		result += line.slice(cursor, codeEnd);
		cursor = codeEnd;
		plainStart = codeEnd;
	}

	return result + transform(line.slice(plainStart));
}

function createUuidSyntaxRegex(): RegExp {
	return new RegExp(
		`\\{\\{embed\\s+\\(\\((${UUID_PATTERN})\\)\\)\\s*\\}\\}|\\(\\((${UUID_PATTERN})\\)\\)|（（(${UUID_PATTERN})））`,
		'g',
	);
}

function countRun(text: string, start: number, character: string): number {
	let length = 0;
	while (start + length < text.length && text[start + length] === character) {
		length += 1;
	}
	return length;
}

function prefixNonEmptyLines(text: string, prefix: string): string {
	if (!prefix) {
		return text;
	}

	return text
		.split('\n')
		.map((line) => line.length > 0 ? `${prefix}${line}` : line)
		.join('\n');
}

function splitLinesPreservingEndings(text: string): LinePart[] {
	if (text.length === 0) {
		return [];
	}

	const lines: LinePart[] = [];
	let start = 0;
	for (let index = 0; index < text.length; index++) {
		if (text[index] !== '\n') {
			continue;
		}

		const hasCarriageReturn = index > start && text[index - 1] === '\r';
		lines.push({
			text: text.slice(start, hasCarriageReturn ? index - 1 : index),
			ending: hasCarriageReturn ? '\r\n' : '\n',
		});
		start = index + 1;
	}

	if (start < text.length) {
		lines.push({ text: text.slice(start), ending: '' });
	}
	return lines;
}

function assertWithinOutputLimit(text: string, maxOutputChars: number): void {
	if (text.length > maxOutputChars) {
		throw new UuidSelectionCopyError(
			'output-too-large',
			`Converted selection exceeds the ${maxOutputChars}-character safety limit.`,
		);
	}
}
