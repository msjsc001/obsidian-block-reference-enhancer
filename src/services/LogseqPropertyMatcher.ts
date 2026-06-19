interface FenceState {
	char: '`' | '~';
	length: number;
}

export interface HiddenLogseqPropertyMatcher {
	exactKeys: ReadonlySet<string>;
	prefixKeys: readonly string[];
	rules: readonly string[];
}

export const DEFAULT_HIDDEN_LOGSEQ_PROPERTY_KEYS = '.lsp-*\\\\.v-*\\\\alias\\\\aliases\\\\background-color\\\\card-*\\\\col-*\\\\collapsed\\\\created-at\\\\deck\\\\direction\\\\doing\\\\done\\\\excalidraw-*\\\\file\\\\file-name\\\\file-path\\\\filters\\\\heading\\\\hl-*\\\\icon\\\\id\\\\later\\\\logseq.order-list-type\\\\ls-type\\\\now\\\\public\\\\query-*\\\\Registry\\\\template\\\\template-including-parent\\\\title\\\\todo\\\\type\\\\updated-at\\\\wait';

const RULE_SEPARATOR = '\\\\';
const PROPERTY_LINE_REGEX = /^\s*([^:\s][^:]*)::(?:\s*(.*))?$/;
const UNORDERED_LIST_LINE_REGEX = /^\s*-\s+/;
const FENCE_REGEX = /^\s{0,3}(`{3,}|~{3,})/;

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
	let columns = 0;
	for (const char of value) {
		columns += char === '\t' ? 4 : 1;
	}

	return columns;
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
	let fenceState: FenceState | null = null;

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];

		if (fenceState) {
			if (isClosingFence(line, fenceState)) {
				fenceState = null;
			}
			continue;
		}

		const nextFenceState = getFenceState(line);
		if (nextFenceState) {
			fenceState = nextFenceState;
			continue;
		}

		if (line.trim().length === 0) {
			continue;
		}

		const indentation = line.match(/^(\s*)/)?.[1] ?? '';
		const indentColumns = measureIndentColumns(indentation);
		while (structureStack.length > 0 && structureStack[structureStack.length - 1].indentColumns >= indentColumns) {
			structureStack.pop();
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

function getFenceState(line: string): FenceState | null {
	const match = line.match(FENCE_REGEX);
	if (!match) {
		return null;
	}

	const marker = match[1];
	return {
		char: marker[0] as FenceState['char'],
		length: marker.length,
	};
}

function isClosingFence(line: string, fenceState: FenceState): boolean {
	const closingRegex = new RegExp(`^\\s{0,3}${fenceState.char}{${fenceState.length},}\\s*$`);
	return closingRegex.test(line);
}
