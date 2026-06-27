import { Component, EventRef, editorInfoField } from 'obsidian';
import { EditorState, RangeSetBuilder } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import type BlockReferenceEnhancer from '../main';
import { SourceReferenceBadgeWidget } from './SourceReferenceBadgeWidget';

const SOURCE_BADGE_VIEWPORT_SCAN_DEBOUNCE_MS = 100;
const SOURCE_BADGE_VISIBLE_MARGIN_LINES = 10;

interface VisibleLineRange {
    fromLine: number;
    toLine: number;
}

function getVisibleLineRanges(view: EditorView): VisibleLineRange[] {
    const doc = view.state.doc;
    const sourceRanges = view.visibleRanges.length > 0 ? view.visibleRanges : [view.viewport];

    return sourceRanges.map((range) => {
        const fromLine = Math.max(1, doc.lineAt(range.from).number - SOURCE_BADGE_VISIBLE_MARGIN_LINES);
        const toLine = Math.min(doc.lines, doc.lineAt(Math.max(range.from, range.to - 1)).number + SOURCE_BADGE_VISIBLE_MARGIN_LINES);
        return { fromLine, toLine };
    });
}

function isLineVisible(lineNumber: number, visibleRanges: VisibleLineRange[]): boolean {
    for (const range of visibleRanges) {
        if (lineNumber >= range.fromLine && lineNumber <= range.toLine) {
            return true;
        }
    }

    return false;
}

function getEditorFilePath(state: EditorState): string | null {
    return state.field(editorInfoField).file?.path ?? null;
}

export function createSourceReferenceBadgePlugin(plugin: BlockReferenceEnhancer) {
    return ViewPlugin.fromClass(
        class {
            decorations: DecorationSet = Decoration.none;

            private readonly component: Component;
            private readonly indexUpdatedRef: EventRef;
            private readonly indexFileUpdatedRef: EventRef;
            private refreshTimer: number | null = null;
            private lastFingerprint = '';
            private dirtyFilePath: string | null = null;

            constructor(private readonly view: EditorView) {
                this.component = new Component();
                plugin.addChild(this.component);
                this.indexUpdatedRef = plugin.indexService.on('index-updated', () => {
                    if (this.isCurrentFileDirty()) {
                        return;
                    }

                    this.lastFingerprint = '';
                    this.scheduleRefresh(SOURCE_BADGE_VIEWPORT_SCAN_DEBOUNCE_MS);
                });
                this.indexFileUpdatedRef = plugin.indexService.on('index-file-updated', (payload: { filePath?: string } | undefined) => {
                    if (!payload?.filePath || payload.filePath !== this.dirtyFilePath) {
                        return;
                    }

                    this.dirtyFilePath = null;
                    if (payload.filePath !== getEditorFilePath(this.view.state)) {
                        return;
                    }

                    this.lastFingerprint = '';
                    this.scheduleRefresh(SOURCE_BADGE_VIEWPORT_SCAN_DEBOUNCE_MS);
                });

                this.scheduleRefresh(SOURCE_BADGE_VIEWPORT_SCAN_DEBOUNCE_MS);
            }

            update(update: ViewUpdate) {
                if (update.docChanged) {
                    const previousFilePath = getEditorFilePath(update.startState);
                    const nextFilePath = getEditorFilePath(update.state);

                    this.lastFingerprint = '';
                    this.cancelRefresh();

                    if (previousFilePath !== nextFilePath) {
                        this.dirtyFilePath = null;
                        if (this.decorations !== Decoration.none) {
                            this.decorations = Decoration.none;
                        }
                        this.scheduleRefresh(SOURCE_BADGE_VIEWPORT_SCAN_DEBOUNCE_MS);
                        return;
                    }

                    this.decorations = this.decorations.map(update.changes);
                    this.dirtyFilePath = nextFilePath;
                    return;
                }

                if (this.isCurrentFileDirty()) {
                    return;
                }

                if (update.viewportChanged || update.focusChanged) {
                    this.scheduleRefresh(SOURCE_BADGE_VIEWPORT_SCAN_DEBOUNCE_MS);
                }
            }

            destroy() {
                this.cancelRefresh();
                plugin.indexService.offref(this.indexUpdatedRef);
                plugin.indexService.offref(this.indexFileUpdatedRef);
                this.component.unload();
            }

            private cancelRefresh() {
                if (this.refreshTimer !== null) {
                    this.getViewWindow().clearTimeout(this.refreshTimer);
                    this.refreshTimer = null;
                }
            }

            private scheduleRefresh(delayMs: number) {
                this.cancelRefresh();
                this.refreshTimer = this.getViewWindow().setTimeout(() => {
                    this.refreshTimer = null;
                    this.refreshDecorations();
                }, delayMs);
            }

            private getViewWindow(): Window {
                return this.view.scrollDOM.win;
            }

            private isCurrentFileDirty(): boolean {
                const currentFilePath = getEditorFilePath(this.view.state);
                return !!currentFilePath && currentFilePath === this.dirtyFilePath;
            }

            private refreshDecorations() {
                if (this.isCurrentFileDirty()) {
                    return;
                }

                const file = this.view.state.field(editorInfoField).file;
                if (!file) {
                    this.dirtyFilePath = null;
                    if (this.lastFingerprint !== 'no-file' || this.decorations !== Decoration.none) {
                        this.lastFingerprint = 'no-file';
                        this.decorations = Decoration.none;
                        this.view.dispatch({});
                    }
                    return;
                }

                const visibleRanges = getVisibleLineRanges(this.view);
                const blocks = plugin.indexService.getBlocksForFile(file.path);
                const fingerprintParts: string[] = [
                    file.path,
                    String(plugin.indexService.getIndexRevision()),
                    String(this.view.state.doc.length),
                    visibleRanges.map((range) => `${range.fromLine}-${range.toLine}`).join('|'),
                ];
                const seenLineNumbers = new Set<number>();

                const builder = new RangeSetBuilder<Decoration>();

                for (const { id, block } of blocks) {
                    const count = plugin.indexService.getReferenceCount(id);
                    if (count <= 0) {
                        continue;
                    }

                    const lineNumber = block.startLine + 1;
                    if (!isLineVisible(lineNumber, visibleRanges) || lineNumber > this.view.state.doc.lines) {
                        continue;
                    }

                    if (seenLineNumbers.has(lineNumber)) {
                        continue;
                    }
                    seenLineNumbers.add(lineNumber);

                    const line = this.view.state.doc.line(lineNumber);
                    fingerprintParts.push(`${id}:${lineNumber}:${count}`);
                    builder.add(
                        line.to,
                        line.to,
                        Decoration.widget({
                            widget: new SourceReferenceBadgeWidget(id, count, block.filePath, block.startLine),
                            side: 1,
                        }),
                    );
                }

                const fingerprint = fingerprintParts.join(':');
                if (fingerprint === this.lastFingerprint) {
                    return;
                }

                this.lastFingerprint = fingerprint;
                this.decorations = builder.finish();
                this.view.dispatch({});
            }

        },
        {
            decorations: (value) => value.decorations,
        },
    );
}
