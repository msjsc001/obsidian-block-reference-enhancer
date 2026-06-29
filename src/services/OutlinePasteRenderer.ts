import type { OutlineNode } from './OutlinePasteParser';
import { buildChildInsertionPrefix } from '../editor/UnorderedListStructure';

export function renderOutlineNodes(
	nodes: OutlineNode[],
	rootInsertionPrefix: string,
	childIndentUnit: string,
): string {
	const lines: string[] = [];
	for (const node of nodes) {
		renderOutlineNode(node, rootInsertionPrefix, childIndentUnit, lines);
	}

	return lines.join('\n');
}

function renderOutlineNode(
	node: OutlineNode,
	insertionPrefix: string,
	childIndentUnit: string,
	lines: string[],
) {
	lines.push(`${insertionPrefix}${node.text}`.trimEnd());

	const leadingWhitespace = insertionPrefix.match(/^(\s*)/)?.[1] ?? '';
	const continuationPrefix = `${leadingWhitespace}  `;
	for (const continuationLine of node.continuation) {
		if (continuationLine.trim().length === 0) {
			continue;
		}

		lines.push(`${continuationPrefix}${continuationLine}`.trimEnd());
	}

	if (node.children.length === 0) {
		return;
	}

	const childPrefix = buildChildInsertionPrefix(leadingWhitespace, childIndentUnit);
	for (const childNode of node.children) {
		renderOutlineNode(childNode, childPrefix, childIndentUnit, lines);
	}
}
