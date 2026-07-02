import type { OutlineNode } from './OutlinePasteParser';
import { getOpeningMarkdownFenceState, isClosingMarkdownFence } from '../utils/markdownFence';

export function renderOutlineNodes(
	nodes: OutlineNode[],
	rootInsertionPrefix: string,
): string {
	const lines: string[] = [];
	const rootLeadingWhitespace = resolveRootLeadingWhitespace(rootInsertionPrefix);
	for (const node of nodes) {
		renderOutlineNode(node, rootLeadingWhitespace, 0, lines);
	}

	return lines.join('\n');
}

function renderOutlineNode(
	node: OutlineNode,
	rootLeadingWhitespace: string,
	depth: number,
	lines: string[],
) {
	const leadingWhitespace = `${rootLeadingWhitespace}${'\t'.repeat(depth)}`;
	const insertionPrefix = `${leadingWhitespace}- `;
	lines.push(`${insertionPrefix}${node.text}`.trimEnd());

	const continuationPrefix = `${leadingWhitespace}  `;
	let fenceState = getOpeningMarkdownFenceState(node.text, 4);
	for (const continuationLine of node.continuation) {
		if (continuationLine.trim().length === 0) {
			if (fenceState) {
				lines.push(continuationPrefix);
			}
			continue;
		}

		const normalizedContinuation = fenceState ? continuationLine : continuationLine.trim();
		lines.push(`${continuationPrefix}${normalizedContinuation}`.trimEnd());
		if (fenceState) {
			if (isClosingMarkdownFence(continuationLine, fenceState, 4)) {
				fenceState = null;
			}
			continue;
		}

		fenceState = getOpeningMarkdownFenceState(continuationLine, 4);
	}

	if (node.children.length === 0) {
		return;
	}

	for (const childNode of node.children) {
		renderOutlineNode(childNode, rootLeadingWhitespace, depth + 1, lines);
	}
}

function resolveRootLeadingWhitespace(rootInsertionPrefix: string): string {
	const match = rootInsertionPrefix.match(/^(\s*)-\s*$/);
	return match?.[1] ?? '';
}
