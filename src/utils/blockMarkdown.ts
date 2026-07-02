const EMBED_CHILD_LIST_LINE_REGEX = /^([ \t]*)-\s+/;

export function normalizeEmbedChildrenMarkdown(childrenMarkdown: string): string {
	const lines = childrenMarkdown.split(/\r?\n/);

	while (lines.length > 0 && lines[0].trim().length === 0) {
		lines.shift();
	}

	while (lines.length > 0 && lines[lines.length - 1].trim().length === 0) {
		lines.pop();
	}

	if (lines.length === 0) {
		return '';
	}

	const childIndentColumns = lines
		.map((line) => {
			const match = line.match(EMBED_CHILD_LIST_LINE_REGEX);
			return match ? measureIndentColumns(match[1]) : null;
		})
		.filter((columns): columns is number => columns !== null);

	if (childIndentColumns.length === 0) {
		return lines.join('\n');
	}

	const sharedIndentColumns = Math.min(...childIndentColumns);
	if (sharedIndentColumns <= 0) {
		return lines.join('\n');
	}

	return lines
		.map((line) => removeLeadingIndentColumns(line, sharedIndentColumns))
		.join('\n');
}

export function measureIndentColumns(value: string): number {
	let columns = 0;
	for (const char of value) {
		if (char === ' ') {
			columns += 1;
			continue;
		}

		if (char === '\t') {
			columns += 4 - (columns % 4);
			continue;
		}

		break;
	}

	return columns;
}

export function removeLeadingIndentColumns(line: string, columnsToRemove: number): string {
	if (line.trim().length === 0 || columnsToRemove <= 0) {
		return line.trim().length === 0 ? '' : line;
	}

	let consumedColumns = 0;
	let index = 0;
	while (index < line.length && consumedColumns < columnsToRemove) {
		const char = line[index];
		if (char === ' ') {
			consumedColumns += 1;
			index += 1;
			continue;
		}

		if (char === '\t') {
			consumedColumns += 4 - (consumedColumns % 4);
			index += 1;
			continue;
		}

		break;
	}

	return consumedColumns >= columnsToRemove ? line.slice(index) : line;
}
