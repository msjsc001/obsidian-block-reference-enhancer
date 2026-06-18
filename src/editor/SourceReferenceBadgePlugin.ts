import { Component, EventRef, editorInfoField } from 'obsidian';
import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import type BlockReferenceEnhancer from '../main';
import { SourceReferenceBadgeWidget } from './SourceReferenceBadgeWidget';

const SOURCE_BADGE_DOC_SCAN_DEBOUNCE_MS = 220;
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

export function createSourceReferenceBadgePlugin(plugin: BlockReferenceEnhancer) {
    return ViewPlugin.fromClass(
        class {
            decorations: DecorationSet = Decoration.none;

            private readonly component: Component;
            private readonly indexUpdatedRef: EventRef;
            private refreshTimer: ReturnType<typeof setTimeout> | null = null;
            private lastFingerprint = '';

            constructor(private readonly view: EditorView) {
                this.component = new Component();
                plugin.addChild(this.component);
                this.indexUpdatedRef = plugin.indexService.on('index-updated', () => {
                    this.lastFingerprint = '';
                    this.scheduleRefresh(SOURCE_BADGE_VIEWPORT_SCAN_DEBOUNCE_MS);
                });

                this.scheduleRefresh(SOURCE_BADGE_VIEWPORT_SCAN_DEBOUNCE_MS);
            }

            update(update: ViewUpdate) {
                if (update.docChanged) {
                    this.scheduleRefresh(SOURCE_BADGE_DOC_SCAN_DEBOUNCE_MS);
                    return;
                }

                if (update.viewportChanged || update.focusChanged) {
                    this.scheduleRefresh(SOURCE_BADGE_VIEWPORT_SCAN_DEBOUNCE_MS);
                }
            }

            destroy() {
                if (this.refreshTimer) {
                    clearTimeout(this.refreshTimer);
                }

                plugin.indexService.offref(this.indexUpdatedRef);
                this.component.unload();
            }

            private scheduleRefresh(delayMs: number) {
                if (this.refreshTimer) {
                    clearTimeout(this.refreshTimer);
                }

                this.refreshTimer = setTimeout(() => {
                    this.refreshTimer = null;
                    this.refreshDecorations();
                }, delayMs);
            }

            private refreshDecorations() {
                const file = this.view.state.field(editorInfoField).file;
                if (!file) {
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
