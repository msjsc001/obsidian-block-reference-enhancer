import { Editor, Notice } from 'obsidian';
import { resolveUnorderedListSubtree } from '../editor/UnorderedListStructure';

const RESULT_NOTICE_DURATION_MS = 4000;

export function canCopyCurrentLevelAndChildren(editor: Editor, targetLine: number): boolean {
	return resolveUnorderedListSubtree(editor.getValue(), targetLine) !== null;
}

export async function copyCurrentLevelAndChildren(editor: Editor, targetLine: number): Promise<void> {
	const subtree = resolveUnorderedListSubtree(editor.getValue(), targetLine);
	if (!subtree) {
		new Notice('Copy current level and children is only available on unordered-list blocks.', RESULT_NOTICE_DURATION_MS);
		return;
	}

	try {
		await navigator.clipboard.writeText(subtree.normalizedMarkdown);
		new Notice('Copied current level and children.', RESULT_NOTICE_DURATION_MS);
	} catch {
		new Notice('Failed to copy current level and children.', RESULT_NOTICE_DURATION_MS);
	}
}
