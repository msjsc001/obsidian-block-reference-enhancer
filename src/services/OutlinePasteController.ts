import {
	App,
	Editor,
	MarkdownFileInfo,
	MarkdownView,
	Notice,
	TFile,
	htmlToMarkdown,
} from 'obsidian';
import { readOutlineClipboard } from './OutlineClipboardReader';
import {
	OutlinePasteError,
	createOutlinePasteParserOptions,
	inspectOutlinePasteInput,
	parseOutlinePasteInput,
} from './OutlinePasteParser';
import { renderOutlineNodes } from './OutlinePasteRenderer';
import {
	createOutlinePasteTextAnchor,
	resolveOutlinePasteTextAnchor,
	type OutlinePasteTextAnchor,
} from './OutlinePasteTarget';
import { resolveOutlinePasteInsertionContext } from '../editor/UnorderedListStructure';
import { confirmLargeOutlinePaste } from '../ui/LargeOutlinePasteConfirmModal';

const STATUS_NOTICE_DURATION_MS = 0;
const RESULT_NOTICE_DURATION_MS = 5000;
const PROGRESS_UPDATE_INTERVAL_MS = 200;

interface ActiveOutlinePasteJob {
	abortController: AbortController;
	statusNotice: Notice;
}

export class OutlinePasteController {
	private activeJob: ActiveOutlinePasteJob | null = null;

	constructor(private readonly app: App) {}

	canPaste(editor: Editor, targetLine: number): boolean {
		return resolveOutlinePasteInsertionContext(editor.getValue(), targetLine) !== null;
	}

	dispose() {
		this.activeJob?.abortController.abort();
		this.activeJob?.statusNotice.hide();
		this.activeJob = null;
	}

	async paste(
		editor: Editor,
		info: MarkdownView | MarkdownFileInfo,
		targetLine: number,
	): Promise<void> {
		if (this.activeJob) {
			new Notice('Another outline paste is already running.', RESULT_NOTICE_DURATION_MS);
			return;
		}

		const file = info.file;
		const anchor = createOutlinePasteTextAnchor(editor.getValue(), targetLine);
		if (!(file instanceof TFile) || !anchor) {
			new Notice('Paste as outline is only available on unordered-list blocks.', RESULT_NOTICE_DURATION_MS);
			return;
		}

		const abortController = new AbortController();
		const statusNotice = new Notice('Reading clipboard...', STATUS_NOTICE_DURATION_MS);
		this.activeJob = { abortController, statusNotice };

		try {
			const payload = await readOutlineClipboard();
			this.throwIfCancelled(abortController.signal);
			const preflight = inspectOutlinePasteInput(payload);
			if (!preflight.processable) {
				throw new OutlinePasteError('too-large', preflight.message ?? 'Clipboard content exceeds the safe outline-paste limit.');
			}

			if (preflight.requiresConfirmation) {
				statusNotice.setMessage('Large clipboard content is waiting for confirmation...');
				const shouldProcess = await confirmLargeOutlinePaste(this.app, preflight, abortController.signal);
				if (!shouldProcess) {
					return;
				}
			}

			statusNotice.setMessage('Converting clipboard to outline...');
			let lastProgressUpdate = 0;
			let lastProgressPercent = -1;
			const parseResult = await parseOutlinePasteInput(payload, createOutlinePasteParserOptions(preflight, {
				htmlToMarkdown,
				isCancelled: () => abortController.signal.aborted,
				onProgress: (progress) => {
					const now = Date.now();
					const percent = Math.max(1, Math.min(95, Math.floor(progress * 100)));
					if (percent === lastProgressPercent || now - lastProgressUpdate < PROGRESS_UPDATE_INTERVAL_MS) {
						return;
					}

					lastProgressPercent = percent;
					lastProgressUpdate = now;
					statusNotice.setMessage(`Converting clipboard to outline: ${percent}%...`);
				},
			}));
			this.throwIfCancelled(abortController.signal);

			statusNotice.setMessage('Resolving original paste location...');
			const insertResult = await this.insertIntoOriginalFile(
				file,
				anchor,
				parseResult.nodes,
				parseResult.maxOutputMarkdownBytes,
				abortController.signal,
			);

			new Notice(
				parseResult.simplified
					? `Outline pasted with simplified structure: ${parseResult.nodeCount} blocks in ${file.path}.`
					: `Outline pasted: ${parseResult.nodeCount} blocks in ${file.path}.`,
				RESULT_NOTICE_DURATION_MS,
			);

			if (insertResult.editor && this.isEditorActiveForFile(insertResult.editor, file)) {
				insertResult.editor.setCursor(insertResult.editor.offsetToPos(insertResult.cursorOffset));
			}
		} catch (error) {
			if (!isOutlinePasteCancelled(error)) {
				new Notice(resolveOutlinePasteFailureMessage(error), RESULT_NOTICE_DURATION_MS);
			}
		} finally {
			statusNotice.hide();
			if (this.activeJob?.abortController === abortController) {
				this.activeJob = null;
			}
		}
	}

	private async insertIntoOriginalFile(
		file: TFile,
		anchor: OutlinePasteTextAnchor,
		nodes: Parameters<typeof renderOutlineNodes>[0],
		maxOutputMarkdownBytes: number,
		signal: AbortSignal,
	): Promise<{ editor: Editor | null; cursorOffset: number }> {
		this.throwIfCancelled(signal);
		if (this.app.vault.getAbstractFileByPath(file.path) !== file) {
			throw new OutlinePasteError('target-changed', 'The original paste file is no longer available.');
		}

		const openView = this.findOpenMarkdownView(file);
		if (openView) {
			const documentText = openView.editor.getValue();
			const target = resolveOutlinePasteTextAnchor(documentText, anchor);
			if (!target) {
				throw new OutlinePasteError('target-changed', 'The original paste location changed and could not be resolved safely.');
			}

			const renderedMarkdown = renderOutlineNodes(nodes, target.rootInsertionPrefix);
			validateRenderedMarkdownSize(renderedMarkdown, maxOutputMarkdownBytes);
			this.throwIfCancelled(signal);
			const insertion = composeInsertion(documentText, target.insertOffset, renderedMarkdown);
			openView.editor.replaceRange(
				insertion.text,
				openView.editor.offsetToPos(target.insertOffset),
				openView.editor.offsetToPos(target.insertOffset),
				'block-reference-outline-paste',
			);
			return { editor: openView.editor, cursorOffset: insertion.cursorOffset };
		}

		let cursorOffset = 0;
		await this.app.vault.process(file, (documentText) => {
			this.throwIfCancelled(signal);
			const target = resolveOutlinePasteTextAnchor(documentText, anchor);
			if (!target) {
				throw new OutlinePasteError('target-changed', 'The original paste location changed and could not be resolved safely.');
			}

			const renderedMarkdown = renderOutlineNodes(nodes, target.rootInsertionPrefix);
			validateRenderedMarkdownSize(renderedMarkdown, maxOutputMarkdownBytes);
			const insertion = composeInsertion(documentText, target.insertOffset, renderedMarkdown);
			cursorOffset = insertion.cursorOffset;
			return `${documentText.slice(0, target.insertOffset)}${insertion.text}${documentText.slice(target.insertOffset)}`;
		});
		return { editor: null, cursorOffset };
	}

	private findOpenMarkdownView(file: TFile): MarkdownView | null {
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			if (leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path) {
				return leaf.view;
			}
		}

		return null;
	}

	private isEditorActiveForFile(editor: Editor, file: TFile): boolean {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		return activeView?.file?.path === file.path && activeView.editor === editor;
	}

	private throwIfCancelled(signal: AbortSignal) {
		if (signal.aborted) {
			throw new OutlinePasteError('cancelled', 'Outline paste was cancelled.');
		}
	}
}

function validateRenderedMarkdownSize(renderedMarkdown: string, maxOutputMarkdownBytes: number) {
	if (new TextEncoder().encode(renderedMarkdown).length > maxOutputMarkdownBytes) {
		throw new OutlinePasteError('too-large', 'Converted outline Markdown is too large to insert.');
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
		cursorOffset: insertOffset + leadingNewline.length + (renderedMarkdown.match(/^([^\n]*)/)?.[1].length ?? 0),
	};
}

function isOutlinePasteCancelled(error: unknown): boolean {
	return error instanceof OutlinePasteError && error.code === 'cancelled';
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
			case 'target-changed':
				return error.message;
			default:
				return error.message;
		}
	}

	return 'Failed to paste clipboard as outline.';
}
