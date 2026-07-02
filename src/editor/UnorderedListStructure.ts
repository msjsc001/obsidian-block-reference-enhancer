import {
	getOpeningMarkdownFenceState,
	isClosingMarkdownFence,
	type MarkdownFenceState,
} from '../utils/markdownFence';

const ANY_LIST_LINE_REGEX = /^\s*(?:[-*+•◦▪]|\d+[.)])\s+/;
const ORDERED_LIST_LINE_REGEX = /^(\s*)(\d+[.)])(?:\s+(.*)|\s*)$/;
const HORIZONTAL_RULE_REGEX = /^\s*-{3,}\s*$/;

export interface UnorderedListLineInfo {
	indentColumns: number;
	contentIndentColumns: number;
	insertionPrefix: string;
	leadingWhitespace: string;
	hasContent: boolean;
}

interface ListLineInfo {
	indentColumns: number;
	leadingWhitespace: string;
}

interface TextLineInfo {
	from: number;
	text: string;
	to: number;
}

interface UnorderedListStructureScanResult {
	firstDirectChildFrom: number | null;
	parentTailEnd: number;
	subtreeEnd: number;
}

export interface OutlinePasteInsertionContext {
	insertOffset: number;
	rootInsertionPrefix: string;
	lineInfo: UnorderedListLineInfo;
}

export interface UnorderedListSubtree {
	startOffset: number;
	endOffset: number;
	rawMarkdown: string;
	normalizedMarkdown: string;
	lineInfo: UnorderedListLineInfo;
}

export function parseUnorderedListLineInfo(lineText: string, tabSize = 4): UnorderedListLineInfo | null {
	if (HORIZONTAL_RULE_REGEX.test(lineText)) {
		return null;
	}

	const match = lineText.match(/^(\s*)-(?:\s+(.*)|\s*)$/);
	if (!match) {
		return null;
	}

	const indentation = match[1] ?? '';
	const content = match[2] ?? '';
	const insertionPrefix = `${indentation}- `;
	return {
		indentColumns: countIndentColumns(indentation, tabSize),
		contentIndentColumns: countIndentColumns(insertionPrefix, tabSize),
		insertionPrefix,
		leadingWhitespace: indentation,
		hasContent: content.trim().length > 0,
	};
}

export function isLineInsideMarkdownFence(text: string, targetLineIndex: number, tabSize = 4): boolean {
	const lines = splitTextIntoLines(text);
	if (targetLineIndex < 0 || targetLineIndex >= lines.length) {
		return false;
	}

	let fenceState: MarkdownFenceState | null = null;
	for (let index = 0; index <= targetLineIndex; index++) {
		const lineText = lines[index].text;
		if (fenceState) {
			if (isClosingMarkdownFence(lineText, fenceState, tabSize)) {
				fenceState = null;
				continue;
			}

			return true;
		}

		const openingFenceState = getOpeningMarkdownFenceState(lineText, tabSize);
		if (!openingFenceState) {
			continue;
		}

		if (index === targetLineIndex) {
			return true;
		}

		fenceState = openingFenceState;
	}

	return false;
}

export function resolveOutlinePasteInsertionContext(
	text: string,
	targetLineIndex: number,
	tabSize = 4,
): OutlinePasteInsertionContext | null {
	const lines = splitTextIntoLines(text);
	if (targetLineIndex < 0 || targetLineIndex >= lines.length) {
		return null;
	}

	if (isLineInsideMarkdownFence(text, targetLineIndex, tabSize)) {
		return null;
	}

	const currentLine = lines[targetLineIndex];
	const lineInfo = parseUnorderedListLineInfo(currentLine.text, tabSize);
	if (!lineInfo) {
		return null;
	}

	const structure = scanUnorderedListStructure(lines, targetLineIndex, lineInfo, tabSize);
	return {
		insertOffset: structure.firstDirectChildFrom ?? structure.parentTailEnd,
		rootInsertionPrefix: buildChildInsertionPrefix(lineInfo.leadingWhitespace, '\t'),
		lineInfo,
	};
}

export function resolveUnorderedListSubtree(
	text: string,
	targetLineIndex: number,
	tabSize = 4,
): UnorderedListSubtree | null {
	const lines = splitTextIntoLines(text);
	if (targetLineIndex < 0 || targetLineIndex >= lines.length) {
		return null;
	}

	if (isLineInsideMarkdownFence(text, targetLineIndex, tabSize)) {
		return null;
	}

	const currentLine = lines[targetLineIndex];
	const lineInfo = parseUnorderedListLineInfo(currentLine.text, tabSize);
	if (!lineInfo) {
		return null;
	}

	const structure = scanUnorderedListStructure(lines, targetLineIndex, lineInfo, tabSize);
	const rawMarkdown = text.slice(currentLine.from, structure.subtreeEnd).replace(/\n$/, '');
	return {
		startOffset: currentLine.from,
		endOffset: structure.subtreeEnd,
		rawMarkdown,
		normalizedMarkdown: normalizeSubtreeMarkdown(rawMarkdown, lineInfo.leadingWhitespace),
		lineInfo,
	};
}

export function buildChildInsertionPrefix(parentLeadingWhitespace: string, indentUnit: string): string {
	return `${parentLeadingWhitespace}${indentUnit}- `;
}

function scanUnorderedListStructure(
	lines: TextLineInfo[],
	targetLineIndex: number,
	lineInfo: UnorderedListLineInfo,
	tabSize: number,
): UnorderedListStructureScanResult {
	const currentListIndentColumns = lineInfo.indentColumns;
	const continuationIndentColumns = lineInfo.contentIndentColumns;
	const documentLength = lines.length === 0 ? 0 : lines[lines.length - 1].to;

	let fenceState: MarkdownFenceState | null = null;
	let parentTailEnd = documentLength;
	let firstDirectChildFrom: number | null = null;
	let subtreeEnd = documentLength;

	for (let lineIndex = targetLineIndex + 1; lineIndex < lines.length; lineIndex++) {
		const line = lines[lineIndex];
		const lineText = line.text;

		if (fenceState) {
			if (isClosingMarkdownFence(lineText, fenceState, tabSize)) {
				fenceState = null;
			}
			continue;
		}

		if (lineText.trim().length === 0) {
			continue;
		}

		const listLineInfo = parseAnyListLineInfo(lineText, tabSize);
		if (listLineInfo) {
			if (listLineInfo.indentColumns > currentListIndentColumns) {
				if (firstDirectChildFrom === null) {
					firstDirectChildFrom = line.from;
					parentTailEnd = line.from;
				}
				continue;
			}

			parentTailEnd = line.from;
			subtreeEnd = line.from;
			break;
		}

		const lineIndentColumns = countIndentColumns(lineText.match(/^(\s*)/)?.[1] ?? '', tabSize);
		const nextFenceState = getOpeningMarkdownFenceState(lineText, tabSize);
		if (nextFenceState && lineIndentColumns > currentListIndentColumns) {
			fenceState = nextFenceState;
			continue;
		}

		if (lineIndentColumns >= continuationIndentColumns || lineIndentColumns > currentListIndentColumns) {
			continue;
		}

		parentTailEnd = line.from;
		subtreeEnd = line.from;
		break;
	}

	return {
		firstDirectChildFrom,
		parentTailEnd,
		subtreeEnd,
	};
}

function parseAnyListLineInfo(lineText: string, tabSize: number): ListLineInfo | null {
	const unorderedLineInfo = parseUnorderedListLineInfo(lineText, tabSize);
	if (unorderedLineInfo) {
		return {
			indentColumns: unorderedLineInfo.indentColumns,
			leadingWhitespace: unorderedLineInfo.leadingWhitespace,
		};
	}

	if (!ANY_LIST_LINE_REGEX.test(lineText)) {
		return null;
	}

	const orderedMatch = lineText.match(ORDERED_LIST_LINE_REGEX);
	if (!orderedMatch) {
		return null;
	}

	const indentation = orderedMatch[1] ?? '';
	return {
		indentColumns: countIndentColumns(indentation, tabSize),
		leadingWhitespace: indentation,
	};
}

function splitTextIntoLines(text: string): TextLineInfo[] {
	const normalizedText = text.replace(/\r\n?/g, '\n');
	const rawLines = normalizedText.split('\n');
	const lines: TextLineInfo[] = [];

	let offset = 0;
	for (let index = 0; index < rawLines.length; index++) {
		const lineText = rawLines[index];
		lines.push({
			from: offset,
			text: lineText,
			to: offset + lineText.length,
		});
		offset += lineText.length;
		if (index < rawLines.length - 1) {
			offset += 1;
		}
	}

	return lines;
}

function normalizeSubtreeMarkdown(markdown: string, rootLeadingWhitespace: string): string {
	if (!rootLeadingWhitespace) {
		return markdown;
	}

	return markdown
		.split('\n')
		.map((line) => line.startsWith(rootLeadingWhitespace) ? line.slice(rootLeadingWhitespace.length) : line)
		.join('\n');
}

function countIndentColumns(value: string, tabSize: number): number {
	let columns = 0;
	for (const char of value) {
		if (char === '\t') {
			const nextTabStop = tabSize - (columns % tabSize);
			columns += nextTabStop === 0 ? tabSize : nextTabStop;
			continue;
		}

		columns += 1;
	}

	return columns;
}
