import {
	getOpeningMarkdownFenceState,
	isClosingMarkdownFence,
	measureIndentColumns as measureMarkdownFenceIndentColumns,
	type MarkdownFenceState,
} from '../utils/markdownFence';

export interface HiddenLogseqPropertyMatcher {
	exactKeys: ReadonlySet<string>;
	prefixKeys: readonly string[];
	rules: readonly string[];
}

export const DEFAULT_HIDDEN_LOGSEQ_PROPERTY_KEYS = '.lsp-*\\\\.v-*\\\\alias\\\\aliases\\\\background-color\\\\card-*\\\\col-*\\\\collapsed\\\\created-at\\\\deck\\\\direction\\\\doing\\\\done\\\\excalidraw-*\\\\file\\\\file-name\\\\file-path\\\\filters\\\\heading\\\\hl-*\\\\icon\\\\id\\\\later\\\\logseq.order-list-type\\\\ls-type\\\\now\\\\public\\\\query-*\\\\Registry\\\\template\\\\template-including-parent\\\\title\\\\todo\\\\type\\\\updated-at\\\\wait';

const RULE_SEPARATOR = '\\\\';
const PROPERTY_LINE_REGEX = /^\s*([^:\s][^:]*)::(?:\s*(.*))?$/;
const UNORDERED_LIST_LINE_REGEX = /^\s*-\s+/;

interface StructureEntry {
	indentColumns: number;
	isUnorderedList: boolean;
}

export function buildHiddenLogseqPropertyMatcher(rawRules: string): HiddenLogseqPropertyMatcher {
	const exactKeys = new Set<string>();
	const prefixKeys: string[] = [];
	const rules: string[] = [];

	for (const token of rawRules.split(RULE_SEPARATOR)) {
		const rule = token.trim();
		if (!rule) {
			continue;
		}

		rules.push(rule);
		if (rule.endsWith('*')) {
			prefixKeys.push(rule.slice(0, -1));
			continue;
		}

		exactKeys.add(rule);
	}

	return {
		exactKeys,
		prefixKeys,
		rules,
	};
}

export function measureIndentColumns(value: string): number {
	return measureMarkdownFenceIndentColumns(value);
}

export function parseHiddenLogseqPropertyLine(line: string): { key: string; indentColumns: number } | null {
	if (UNORDERED_LIST_LINE_REGEX.test(line)) {
		return null;
	}

	const match = line.match(PROPERTY_LINE_REGEX);
	if (!match) {
		return null;
	}

	const indentation = line.match(/^(\s*)/)?.[1] ?? '';
	return {
		key: match[1].trim(),
		indentColumns: measureIndentColumns(indentation),
	};
}

export function isHiddenLogseqPropertyKey(key: string, matcher: HiddenLogseqPropertyMatcher): boolean {
	if (matcher.exactKeys.has(key)) {
		return true;
	}

	for (const prefix of matcher.prefixKeys) {
		if (key.startsWith(prefix)) {
			return true;
		}
	}

	return false;
}

export function isHiddenLogseqPropertyLineText(lineText: string, matcher: HiddenLogseqPropertyMatcher): boolean {
	const parsed = parseHiddenLogseqPropertyLine(lineText);
	return !!parsed && isHiddenLogseqPropertyKey(parsed.key, matcher);
}

export function collectHiddenLogseqPropertyLineNumbers(
	docText: string,
	matcher: HiddenLogseqPropertyMatcher,
): Set<number> {
	const hiddenLines = new Set<number>();
	const lines = docText.split(/\r?\n/);
	const structureStack: StructureEntry[] = [];
	let fenceState: MarkdownFenceState | null = null;

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];

		if (fenceState) {
			if (isClosingMarkdownFence(line, fenceState)) {
				fenceState = null;
			}
			continue;
		}

		const indentation = line.match(/^(\s*)/)?.[1] ?? '';
		const indentColumns = measureIndentColumns(indentation);
		while (structureStack.length > 0 && structureStack[structureStack.length - 1].indentColumns >= indentColumns) {
			structureStack.pop();
		}

		const nextFenceState = getOpeningMarkdownFenceState(line);
		if (nextFenceState) {
			if (UNORDERED_LIST_LINE_REGEX.test(line)) {
				structureStack.push({
					indentColumns,
					isUnorderedList: true,
				});
			}
			fenceState = nextFenceState;
			continue;
		}

		if (line.trim().length === 0) {
			continue;
		}

		const parsedPropertyLine = parseHiddenLogseqPropertyLine(line);
		if (
			parsedPropertyLine
			&& isHiddenLogseqPropertyKey(parsedPropertyLine.key, matcher)
			&& structureStack[structureStack.length - 1]?.isUnorderedList
		) {
			hiddenLines.add(index + 1);
		}

		structureStack.push({
			indentColumns,
			isUnorderedList: UNORDERED_LIST_LINE_REGEX.test(line),
		});
	}

	return hiddenLines;
}
