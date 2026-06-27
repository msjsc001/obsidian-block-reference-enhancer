export interface MarkdownFenceState {
    char: '`' | '~';
    length: number;
    minClosingIndentColumns: number;
    maxClosingIndentColumns: number | null;
}

const ROOT_FENCE_REGEX = /^([ \t]*)(`{3,}|~{3,})(.*)$/;
const LIST_ITEM_FENCE_REGEX = /^(\s*-\s+(?:\[[ xX-]\]\s+)?)(`{3,}|~{3,})(.*)$/;
const CLOSING_FENCE_REMAINDER_REGEX = /^(`{3,}|~{3,})[ \t]*$/;

export function measureIndentColumns(value: string, tabSize = 4): number {
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

export function getOpeningMarkdownFenceState(line: string, tabSize = 4): MarkdownFenceState | null {
    const listItemMatch = line.match(LIST_ITEM_FENCE_REGEX);
    if (listItemMatch) {
        const marker = listItemMatch[2];
        return {
            char: marker[0] as MarkdownFenceState['char'],
            length: marker.length,
            minClosingIndentColumns: measureIndentColumns(listItemMatch[1], tabSize),
            maxClosingIndentColumns: null,
        };
    }

    const rootMatch = line.match(ROOT_FENCE_REGEX);
    if (!rootMatch) {
        return null;
    }

    const indentColumns = measureIndentColumns(rootMatch[1], tabSize);
    if (indentColumns > 3) {
        return null;
    }

    const marker = rootMatch[2];
    return {
        char: marker[0] as MarkdownFenceState['char'],
        length: marker.length,
        minClosingIndentColumns: 0,
        maxClosingIndentColumns: 3,
    };
}

export function isClosingMarkdownFence(line: string, fenceState: MarkdownFenceState, tabSize = 4): boolean {
    const indentation = line.match(/^(\s*)/)?.[1] ?? '';
    const indentColumns = measureIndentColumns(indentation, tabSize);
    if (indentColumns < fenceState.minClosingIndentColumns) {
        return false;
    }

    if (fenceState.maxClosingIndentColumns !== null && indentColumns > fenceState.maxClosingIndentColumns) {
        return false;
    }

    const remainder = line.slice(indentation.length);
    const markerMatch = remainder.match(CLOSING_FENCE_REMAINDER_REGEX);
    if (!markerMatch) {
        return false;
    }

    const marker = markerMatch[1];
    return marker[0] === fenceState.char && marker.length >= fenceState.length;
}
