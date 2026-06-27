import { editorInfoField } from 'obsidian';
import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import type BlockReferenceEnhancer from '../main';

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

					const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
					if (position === null) {
						plugin.clearEditorContextMenuTarget();
						return false;
					}

					const line = view.state.doc.lineAt(position).number - 1;
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
