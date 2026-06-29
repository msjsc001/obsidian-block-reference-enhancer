import { Editor, MarkdownFileInfo, MarkdownView, Notice, htmlToMarkdown } from 'obsidian';
import { readOutlineClipboard } from './OutlineClipboardReader';
import { OutlinePasteError, parseOutlinePasteInput } from './OutlinePasteParser';
import { renderOutlineNodes } from './OutlinePasteRenderer';
import { resolveOutlinePasteInsertionContext } from '../editor/UnorderedListStructure';

const STATUS_NOTICE_DURATION_MS = 0;
const RESULT_NOTICE_DURATION_MS = 4000;

export function canPasteClipboardAsOutline(editor: Editor, targetLine: number): boolean {
	return resolveOutlinePasteInsertionContext(editor.getValue(), targetLine) !== null;
}

export async function pasteClipboardAsOutline(
	editor: Editor,
	_info: MarkdownView | MarkdownFileInfo,
	targetLine: number,
): Promise<void> {
	const insertionContext = resolveOutlinePasteInsertionContext(editor.getValue(), targetLine);
	if (!insertionContext) {
		new Notice('Paste as outline is only available on unordered-list blocks.', RESULT_NOTICE_DURATION_MS);
		return;
	}

	const statusNotice = new Notice('Reading clipboard...', STATUS_NOTICE_DURATION_MS);
	try {
		const payload = await readOutlineClipboard();
		statusNotice.setMessage('Converting clipboard to outline...');
		const parseResult = await parseOutlinePasteInput(payload, {
			htmlToMarkdown,
		});
		const renderedMarkdown = renderOutlineNodes(
			parseResult.nodes,
			insertionContext.rootInsertionPrefix,
			insertionContext.childIndentUnit,
		);
		const renderedMarkdownBytes = new TextEncoder().encode(renderedMarkdown).length;
		if (renderedMarkdownBytes > parseResult.maxOutputMarkdownBytes) {
			throw new OutlinePasteError('too-large', 'Converted outline Markdown is too large to insert.');
		}

		statusNotice.setMessage('Inserting outline...');
		const insertion = composeInsertion(editor.getValue(), insertionContext.insertOffset, renderedMarkdown);
		editor.replaceRange(
			insertion.text,
			editor.offsetToPos(insertionContext.insertOffset),
			editor.offsetToPos(insertionContext.insertOffset),
			'block-reference-outline-paste',
		);
		editor.setCursor(editor.offsetToPos(insertion.cursorOffset));
		editor.focus();

		statusNotice.hide();
		new Notice(
			parseResult.simplified
				? `Outline pasted with simplified structure: ${parseResult.nodeCount} blocks.`
				: `Outline pasted: ${parseResult.nodeCount} blocks.`,
			RESULT_NOTICE_DURATION_MS,
		);
	} catch (error) {
		statusNotice.hide();
		new Notice(resolveOutlinePasteFailureMessage(error), RESULT_NOTICE_DURATION_MS);
	}
}

function composeInsertion(documentText: string, insertOffset: number, renderedMarkdown: string): { text: string; cursorOffset: number } {
	const needsLeadingNewline = insertOffset >= documentText.length
		? documentText.length > 0 && documentText[documentText.length - 1] !== '\n'
		: insertOffset > 0 && documentText[insertOffset - 1] !== '\n';
	const leadingNewline = needsLeadingNewline ? '\n' : '';
	const trailingNewline = insertOffset < documentText.length && !renderedMarkdown.endsWith('\n') ? '\n' : '';
	return {
		text: `${leadingNewline}${renderedMarkdown}${trailingNewline}`,
		cursorOffset: insertOffset + leadingNewline.length + renderedMarkdown.match(/^([^\n]*)/)![1].length,
	};
}

function resolveOutlinePasteFailureMessage(error: unknown): string {
	if (error instanceof OutlinePasteError) {
		switch (error.code) {
			case 'empty':
				return 'Clipboard is empty.';
			case 'unsupported':
				return 'Clipboard content is not supported for outline paste.';
			case 'too-large':
				return error.message;
			case 'timeout':
				return 'Outline paste timed out. Try a smaller selection.';
			default:
				return error.message;
		}
	}

	return 'Failed to paste clipboard as outline.';
}
