import { editorInfoField } from 'obsidian';
import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import type BlockReferenceEnhancer from '../main';
import { isDomNode, isHtmlElement } from '../utils/dom';

export interface EditorContextMenuTarget {
	filePath: string;
	line: number;
	capturedAt: number;
}

export function createEditorContextMenuTargetPlugin(plugin: BlockReferenceEnhancer): Extension {
	return ViewPlugin.fromClass(
		class {
			constructor(readonly view: EditorView) {}
		},
		{
			eventHandlers: {
				contextmenu(event, view) {
					const filePath = view.state.field(editorInfoField).file?.path;
					if (!filePath) {
						plugin.clearEditorContextMenuTarget();
						return false;
					}

					const line = resolveContextMenuLineFromView(view, event);
					if (line === null) {
						plugin.clearEditorContextMenuTarget();
						return false;
					}

					plugin.setEditorContextMenuTarget({
						filePath,
						line,
						capturedAt: Date.now(),
					});
					return false;
				},
			},
		},
	);
}

function resolveContextMenuLineFromView(view: EditorView, event: MouseEvent): number | null {
	const documentLineCount = view.state.doc.lines;

	try {
		const block = view.lineBlockAtHeight(event.clientY - view.documentTop);
		const line = view.state.doc.lineAt(block.from).number - 1;
		if (line >= 0 && line < documentLineCount) {
			return line;
		}
	} catch {
		// Fall through to the next strategy.
	}

	try {
		const position = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
		if (typeof position === 'number') {
			const line = view.state.doc.lineAt(position).number - 1;
			if (line >= 0 && line < documentLineCount) {
				return line;
			}
		}
	} catch {
		// Fall through to the final DOM-based strategy.
	}

	try {
		const target = event.target;
		if (!isDomNode(target) || !view.contentDOM.contains(target)) {
			return null;
		}

		const lineElement = isHtmlElement(target)
			? target.closest('.cm-line')
			: target.parentElement?.closest('.cm-line');
		if (!isHtmlElement(lineElement)) {
			return null;
		}

		const position = view.posAtDOM(lineElement, 0);
		const line = view.state.doc.lineAt(position).number - 1;
		if (line >= 0 && line < documentLineCount) {
			return line;
		}
	} catch {
		// Ignore and return null below.
	}

	return null;
}
