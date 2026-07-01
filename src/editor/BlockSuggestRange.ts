export function resolveBlockSuggestEditEndCh(lineText: string, endCh: number): number {
	if (endCh < 0 || endCh > lineText.length) {
		return endCh;
	}

	return lineText.slice(endCh, endCh + 2) === '))' ? endCh + 2 : endCh;
}

export function matchesBlockSuggestContext(
	lineText: string,
	startCh: number,
	endCh: number,
	query: string,
): boolean {
	if (startCh < 0 || endCh < startCh || endCh > lineText.length) {
		return false;
	}

	return lineText.slice(startCh, endCh) === `((${query}`;
}
