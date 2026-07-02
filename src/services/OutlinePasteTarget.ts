import {
	parseUnorderedListLineInfo,
	resolveOutlinePasteInsertionContext,
} from '../editor/UnorderedListStructure';

const CONTEXT_LINE_COUNT = 2;

interface TextLine {
	text: string;
	from: number;
}

export interface OutlinePasteTextAnchor {
	initialDocumentHash: number;
	initialTargetLine: number;
	targetLineText: string;
	ancestorPath: string[];
	previousContext: string[];
	nextContext: string[];
}

export interface ResolvedOutlinePasteTarget {
	targetLine: number;
	insertOffset: number;
	rootInsertionPrefix: string;
}

export function createOutlinePasteTextAnchor(
	documentText: string,
	targetLine: number,
): OutlinePasteTextAnchor | null {
	const lines = splitTextLines(documentText);
	if (!resolveOutlinePasteInsertionContext(documentText, targetLine) || !lines[targetLine]) {
		return null;
	}

	return {
		initialDocumentHash: hashDocumentText(documentText),
		initialTargetLine: targetLine,
		targetLineText: lines[targetLine].text,
		ancestorPath: resolveAncestorPath(lines, targetLine),
		previousContext: collectNonBlankContext(lines, targetLine, -1),
		nextContext: collectNonBlankContext(lines, targetLine, 1),
	};
}

export function resolveOutlinePasteTextAnchor(
	documentText: string,
	anchor: OutlinePasteTextAnchor,
): ResolvedOutlinePasteTarget | null {
	const lines = splitTextLines(documentText);
	if (hashDocumentText(documentText) === anchor.initialDocumentHash) {
		const unchanged = resolveTargetAtLine(documentText, anchor.initialTargetLine);
		if (unchanged && lines[anchor.initialTargetLine]?.text === anchor.targetLineText) {
			return unchanged;
		}
	}

	const candidates = lines
		.map((line, lineIndex) => ({ line, lineIndex }))
		.filter(({ line }) => line.text === anchor.targetLineText)
		.map(({ lineIndex }) => {
			const target = resolveTargetAtLine(documentText, lineIndex);
			if (!target) {
				return null;
			}

			return {
				target,
				score: scoreCandidate(lines, lineIndex, anchor),
			};
		})
		.filter((candidate): candidate is { target: ResolvedOutlinePasteTarget; score: number } => candidate !== null)
		.sort((left, right) => right.score - left.score);

	if (candidates.length === 0) {
		return null;
	}

	if (candidates.length > 1 && candidates[0].score === candidates[1].score) {
		return null;
	}

	return candidates[0].target;
}

function resolveTargetAtLine(documentText: string, targetLine: number): ResolvedOutlinePasteTarget | null {
	const context = resolveOutlinePasteInsertionContext(documentText, targetLine);
	if (!context) {
		return null;
	}

	return {
		targetLine,
		insertOffset: context.insertOffset,
		rootInsertionPrefix: context.rootInsertionPrefix,
	};
}

function scoreCandidate(lines: TextLine[], lineIndex: number, anchor: OutlinePasteTextAnchor): number {
	let score = 0;
	const ancestorPath = resolveAncestorPath(lines, lineIndex);
	score += scoreOrderedContext(anchor.ancestorPath, ancestorPath, 20);
	score += scoreOrderedContext(anchor.previousContext, collectNonBlankContext(lines, lineIndex, -1), 8);
	score += scoreOrderedContext(anchor.nextContext, collectNonBlankContext(lines, lineIndex, 1), 8);
	return score;
}

function scoreOrderedContext(expected: string[], actual: string[], weight: number): number {
	let matches = 0;
	const length = Math.min(expected.length, actual.length);
	for (let index = 0; index < length; index++) {
		if (expected[index] !== actual[index]) {
			break;
		}

		matches += 1;
	}

	return matches * weight;
}

function resolveAncestorPath(lines: TextLine[], targetLine: number): string[] {
	const targetInfo = parseAnyListLine(lines[targetLine]?.text ?? '');
	if (!targetInfo) {
		return [];
	}

	const ancestors: string[] = [];
	let childIndent = targetInfo.indentColumns;
	for (let lineIndex = targetLine - 1; lineIndex >= 0; lineIndex--) {
		const candidate = parseAnyListLine(lines[lineIndex].text);
		if (!candidate || candidate.indentColumns >= childIndent) {
			continue;
		}

		ancestors.unshift(lines[lineIndex].text);
		childIndent = candidate.indentColumns;
		if (childIndent === 0) {
			break;
		}
	}

	return ancestors;
}

function collectNonBlankContext(lines: TextLine[], targetLine: number, direction: -1 | 1): string[] {
	const result: string[] = [];
	for (
		let lineIndex = targetLine + direction;
		lineIndex >= 0 && lineIndex < lines.length && result.length < CONTEXT_LINE_COUNT;
		lineIndex += direction
	) {
		const text = lines[lineIndex].text;
		if (text.trim()) {
			result.push(text);
		}
	}

	return result;
}

function parseAnyListLine(lineText: string): { indentColumns: number } | null {
	const unordered = parseUnorderedListLineInfo(lineText);
	if (unordered) {
		return { indentColumns: unordered.indentColumns };
	}

	const match = lineText.match(/^(\s*)\d+[.)](?:\s+.*|\s*)$/);
	if (!match) {
		return null;
	}

	return { indentColumns: countIndentColumns(match[1] ?? '') };
}

function splitTextLines(text: string): TextLine[] {
	const normalized = text.replace(/\r\n?/g, '\n');
	const rawLines = normalized.split('\n');
	let offset = 0;
	return rawLines.map((line) => {
		const result = { text: line, from: offset };
		offset += line.length + 1;
		return result;
	});
}

function countIndentColumns(value: string, tabSize = 4): number {
	let columns = 0;
	for (const char of value) {
		columns += char === '\t' ? tabSize - (columns % tabSize) : 1;
	}

	return columns;
}

function hashDocumentText(value: string): number {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index++) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}

	return hash >>> 0;
}
