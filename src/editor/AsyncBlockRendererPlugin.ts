import { Component, EventRef, editorInfoField } from "obsidian";
import { EditorSelection } from "@codemirror/state";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import {
    addLoadingWidgetEffect,
    removeWidgetEffect,
    setRenderedWidgetEffect,
} from "./BlockReferenceField";
import { BlockRenderMode } from "./BlockReferenceWidget";
import BlockReferenceEnhancer from "src/main";
import { isHtmlElement } from "src/utils/dom";
import { replaceChildrenFromHtml } from "src/utils/html";

interface BlockRenderTarget {
    from: number;
    to: number;
    uuid: string;
    mode: BlockRenderMode;
    stale?: boolean;
    blockWidget?: boolean;
    preserveListMarker?: boolean;
    availableInlineWidthPx?: number;
    renderAsListItem?: boolean;
    indentColumns?: number;
    listMarkerPos?: number;
    listContentPos?: number;
    listMarkerOffsetPx?: number;
    listContentOffsetPx?: number;
    revealPos?: number;
    revealFrom?: number;
    revealTo?: number;
    cardPos?: number;
    refId?: string;
    anchorLeftPx?: number;
    anchorTopPx?: number;
    anchorWidthPx?: number;
    lineHeightPx?: number;
    reservedHeightPx?: number;
}

interface FenceState {
    char: "`" | "~";
    length: number;
}

interface RunningRenderTask {
    controller: AbortController;
    signature: string;
}

interface ListEmbedLayout {
    markerOffsetPx: number;
    contentOffsetPx: number;
    lineHeight: number;
}

interface ListEmbedOverlayState {
    html: string;
    reservedHeightPx: number;
}

interface ListEmbedOverlayEntry {
    card: HTMLElement;
    state: ListEmbedOverlayState;
}

interface InlineEmbedWidthGeometry {
    availableWidthPx: number;
}

interface VisibleWidgetState {
    from: number;
    to: number;
    signature: string;
}

interface VisibleScanRange {
    from: number;
    to: number;
}

const EMBED_BLOCK_REF_REGEX = /\{\{embed\s+\(\(([A-Za-z0-9_-]{36,})\)\)\s*\}\}/y;
const INLINE_BLOCK_REF_REGEX = /\(\(([A-Za-z0-9_-]{36,})\)\)/y;
const FULLWIDTH_INLINE_BLOCK_REF_REGEX = /（（([A-Za-z0-9_-]{36,})））/y;
const FENCE_REGEX = /^\s{0,3}(`{3,}|~{3,})/;
const LIVE_PREVIEW_DOC_SCAN_DEBOUNCE_MS = 450;
const LIVE_PREVIEW_VIEWPORT_SCAN_DEBOUNCE_MS = 120;
const LIVE_PREVIEW_INTERNAL_LAYOUT_RESCAN_DEBOUNCE_MS = 320;
const EMBED_PLACEHOLDER_LINE_HEIGHT_PX = 22;
const EMBED_PLACEHOLDER_BASE_HEIGHT_PX = 24;
const EMBED_PLACEHOLDER_MIN_LINES = 2;
const EMBED_PLACEHOLDER_MAX_LINES = 10;
const VISIBLE_SCAN_MARGIN_LINES = 12;
const MAX_CONCURRENT_EMBED_RENDERS = 2;

function normalizeMeasuredPx(value?: number): number {
    if (value === undefined || !Number.isFinite(value)) {
        return -1;
    }

    return Math.round(value / 4) * 4;
}

function buildTargetSignature(target: BlockRenderTarget): string {
    return `${target.from}:${target.to}:${target.mode}:${target.uuid}:${target.stale ? 1 : 0}:${target.blockWidget ? 1 : 0}:${target.preserveListMarker ? 1 : 0}:${normalizeMeasuredPx(target.availableInlineWidthPx)}:${target.renderAsListItem ? 1 : 0}:${target.indentColumns ?? 0}:${normalizeMeasuredPx(target.listMarkerOffsetPx)}:${normalizeMeasuredPx(target.listContentOffsetPx)}:${target.revealPos ?? -1}:${target.revealFrom ?? -1}:${target.revealTo ?? -1}:${target.cardPos ?? -1}:${target.refId ?? ""}:${normalizeMeasuredPx(target.lineHeightPx)}`;
}

function buildRenderSignature(target: BlockRenderTarget): string {
    return `${target.from}:${target.to}:${target.mode}:${target.uuid}:${target.stale ? 1 : 0}:${target.preserveListMarker ? 1 : 0}:${normalizeMeasuredPx(target.availableInlineWidthPx)}:${target.renderAsListItem ? 1 : 0}:${target.refId ?? ""}:${normalizeMeasuredPx(target.listMarkerOffsetPx)}:${normalizeMeasuredPx(target.listContentOffsetPx)}:${normalizeMeasuredPx(target.lineHeightPx)}`;
}

function getTargetRefId(target: BlockRenderTarget): string {
    return target.refId ?? `${target.mode}:${target.from}:${target.to}`;
}

function getFenceState(line: string): FenceState | null {
    const match = line.match(FENCE_REGEX);
    if (!match) {
        return null;
    }

    const marker = match[1];
    return {
        char: marker[0] as FenceState["char"],
        length: marker.length,
    };
}

function isClosingFence(line: string, fenceState: FenceState): boolean {
    const closingRegex = new RegExp(`^\\s{0,3}${fenceState.char}{${fenceState.length},}\\s*$`);
    return closingRegex.test(line);
}

function findInlineCodeSpanEnd(line: string, start: number): number {
    let ticks = 0;
    while (start + ticks < line.length && line[start + ticks] === "`") {
        ticks++;
    }

    const delimiter = "`".repeat(ticks);
    const closingIndex = line.indexOf(delimiter, start + ticks);
    if (closingIndex === -1) {
        return start + ticks;
    }

    return closingIndex + ticks;
}

function scanLineForTargets(line: string, lineOffset: number, targets: BlockRenderTarget[]) {
    const standaloneEmbedListMatch = line.match(/^(\s*)-\s+(\{\{embed\s+\(\(([A-Za-z0-9_-]{36,})\)\)\s*\}\})\s*$/);
    if (standaloneEmbedListMatch) {
        const embedStart = line.indexOf("{{embed");
        const embedSyntax = standaloneEmbedListMatch[2];
        targets.push({
            from: lineOffset + embedStart,
            to: lineOffset + embedStart + embedSyntax.length,
            uuid: standaloneEmbedListMatch[3],
            mode: "embed",
            blockWidget: false,
            preserveListMarker: true,
            revealPos: lineOffset + embedStart,
            revealFrom: lineOffset + embedStart,
            revealTo: lineOffset + embedStart + embedSyntax.length,
            refId: `embed-list:${lineOffset}:${lineOffset + line.length}`,
        });
        return;
    }

    const standaloneEmbedMatch = line.match(/^\s*\{\{embed\s+\(\(([A-Za-z0-9_-]{36,})\)\)\s*\}\}\s*$/);
    if (standaloneEmbedMatch) {
        targets.push({
            from: lineOffset,
            to: lineOffset + line.length,
            uuid: standaloneEmbedMatch[1],
            mode: "embed",
            blockWidget: true,
            revealPos: lineOffset + line.indexOf("{{embed"),
            revealFrom: lineOffset,
            revealTo: lineOffset + line.length,
            refId: `embed-block:${lineOffset}:${lineOffset + line.length}`,
        });
        return;
    }

    let index = 0;

    while (index < line.length) {
        if (line[index] === "`") {
            index = findInlineCodeSpanEnd(line, index);
            continue;
        }

        EMBED_BLOCK_REF_REGEX.lastIndex = index;
        const embedMatch = EMBED_BLOCK_REF_REGEX.exec(line);
        if (embedMatch) {
            index = embedMatch.index + embedMatch[0].length;
            continue;
        }

        INLINE_BLOCK_REF_REGEX.lastIndex = index;
        const inlineMatch = INLINE_BLOCK_REF_REGEX.exec(line);
        if (inlineMatch) {
            targets.push({
                from: lineOffset + inlineMatch.index,
                to: lineOffset + inlineMatch.index + inlineMatch[0].length,
                uuid: inlineMatch[1],
                mode: "inline",
            });
            index = inlineMatch.index + inlineMatch[0].length;
            continue;
        }

        FULLWIDTH_INLINE_BLOCK_REF_REGEX.lastIndex = index;
        const fullwidthMatch = FULLWIDTH_INLINE_BLOCK_REF_REGEX.exec(line);
        if (fullwidthMatch) {
            targets.push({
                from: lineOffset + fullwidthMatch.index,
                to: lineOffset + fullwidthMatch.index + fullwidthMatch[0].length,
                uuid: fullwidthMatch[1],
                mode: "inline",
            });
            index = fullwidthMatch.index + fullwidthMatch[0].length;
            continue;
        }

        index++;
    }
}

function collectRenderTargets(text: string): BlockRenderTarget[] {
    const targets: BlockRenderTarget[] = [];
    const lines = text.split("\n");

    let offset = 0;
    let inFrontmatter = lines[0]?.trim() === "---";
    let fenceState: FenceState | null = null;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];

        if (inFrontmatter) {
            if (lineIndex > 0 && (line.trim() === "---" || line.trim() === "...")) {
                inFrontmatter = false;
            }
            offset += line.length + 1;
            continue;
        }

        if (fenceState) {
            if (isClosingFence(line, fenceState)) {
                fenceState = null;
            }
            offset += line.length + 1;
            continue;
        }

        const nextFenceState = getFenceState(line);
        if (nextFenceState) {
            fenceState = nextFenceState;
            offset += line.length + 1;
            continue;
        }

        scanLineForTargets(line, offset, targets);
        offset += line.length + 1;
    }

    return targets;
}

export function createAsyncBlockRendererPlugin(plugin: BlockReferenceEnhancer) {
    return ViewPlugin.fromClass(
        class {
            private component: Component;
            private runningRenders: Map<number, RunningRenderTask> = new Map();
            private revealedEmbedPos: number | null = null;
            private inlineEmbedWidthCache: Map<string, InlineEmbedWidthGeometry> = new Map();
            private listEmbedLayoutCache: Map<string, ListEmbedLayout> = new Map();
            private overlayRoot: HTMLElement | null = null;
            private listEmbedOverlayStates: Map<string, ListEmbedOverlayState> = new Map();
            private listEmbedOverlayEntries: Map<string, ListEmbedOverlayEntry> = new Map();
            private embedHeightCache: Map<string, number> = new Map();
            private scanDebounceTimer: number | null = null;
            private postRenderRescanTimer: number | null = null;
            private lastScanFingerprint = "";
            private cachedTargets: BlockRenderTarget[] = [];
            private cachedTargetsDirty = true;
            private documentScanVersion = 0;
            private pendingEmbedRenderQueue: BlockRenderTarget[] = [];
            private runningEmbedRenderCount = 0;
            private visibleWidgetStates: Map<string, VisibleWidgetState> = new Map();
            private indexUpdatedRef: EventRef;

            constructor(private view: EditorView) {
                this.component = new Component();
                plugin.addChild(this.component);
                this.indexUpdatedRef = plugin.indexService.on("index-updated", () => {
                    this.lastScanFingerprint = "";
                    this.scheduleScan(LIVE_PREVIEW_VIEWPORT_SCAN_DEBOUNCE_MS);
                });

                this.scheduleScan(LIVE_PREVIEW_VIEWPORT_SCAN_DEBOUNCE_MS);
            }

            update(update: ViewUpdate) {
                if (this.revealedEmbedPos !== null && update.docChanged) {
                    this.revealedEmbedPos = update.changes.mapPos(this.revealedEmbedPos, -1);
                }

                if (update.focusChanged && !this.view.hasFocus) {
                    this.revealedEmbedPos = null;
                }

                if (update.docChanged) {
                    this.cachedTargetsDirty = true;
                    this.documentScanVersion += 1;
                    this.scheduleScan(LIVE_PREVIEW_DOC_SCAN_DEBOUNCE_MS);
                    return;
                }

                const internalWidgetUpdate = this.classifyInternalWidgetUpdate(update);
                if (internalWidgetUpdate !== "none") {
                    if (internalWidgetUpdate === "layout") {
                        this.schedulePostRenderRescan();
                    }
                    return;
                }

                if (update.viewportChanged || update.focusChanged) {
                    this.scheduleScan(LIVE_PREVIEW_VIEWPORT_SCAN_DEBOUNCE_MS);
                    return;
                }

                if (update.selectionSet && (this.revealedEmbedPos !== null || this.selectionTouchesRenderedTarget())) {
                    this.scheduleScan(LIVE_PREVIEW_VIEWPORT_SCAN_DEBOUNCE_MS);
                }
            }

            destroy() {
                this.listEmbedOverlayEntries.forEach((entry) => entry.card.remove());
                this.listEmbedOverlayEntries.clear();
                this.inlineEmbedWidthCache.clear();
                this.listEmbedLayoutCache.clear();
                this.embedHeightCache.clear();
                if (this.overlayRoot) {
                    this.overlayRoot.remove();
                    this.overlayRoot = null;
                    this.view.scrollDOM.classList.remove("block-reference-overlay-host");
                }
                if (this.scanDebounceTimer !== null) {
                    this.getViewWindow().clearTimeout(this.scanDebounceTimer);
                }
                if (this.postRenderRescanTimer !== null) {
                    this.getViewWindow().clearTimeout(this.postRenderRescanTimer);
                }
                this.component.unload();
                this.runningRenders.forEach(({ controller }) => controller.abort());
                plugin.indexService.offref(this.indexUpdatedRef);
            }

            private getViewDocument(): Document {
                return this.view.contentDOM.doc;
            }

            private getViewWindow(): Window {
                return this.view.contentDOM.win;
            }

            private ensureOverlayRoot(): HTMLElement {
                if (this.overlayRoot) {
                    return this.overlayRoot;
                }

                this.view.scrollDOM.classList.add("block-reference-overlay-host");
                const root = this.getViewDocument().createElement("div");
                root.className = "block-reference-live-preview-overlay-root";
                this.view.scrollDOM.appendChild(root);
                this.overlayRoot = root;
                return root;
            }

            private scheduleScan(delayMs: number) {
                if (this.scanDebounceTimer !== null) {
                    this.getViewWindow().clearTimeout(this.scanDebounceTimer);
                }

                this.scanDebounceTimer = this.getViewWindow().setTimeout(() => {
                    this.scanDebounceTimer = null;
                    this.scanAndRender();
                }, delayMs);
            }

            private schedulePostRenderRescan() {
                if (this.postRenderRescanTimer !== null) {
                    this.getViewWindow().clearTimeout(this.postRenderRescanTimer);
                }

                this.postRenderRescanTimer = this.getViewWindow().setTimeout(() => {
                    this.postRenderRescanTimer = null;
                    this.scanAndRender();
                }, LIVE_PREVIEW_INTERNAL_LAYOUT_RESCAN_DEBOUNCE_MS);
            }

            private classifyInternalWidgetUpdate(update: ViewUpdate): "none" | "inline-only" | "layout" {
                let hasInlineOnlyEffect = false;

                for (const transaction of update.transactions) {
                    for (const effect of transaction.effects) {
                        if (effect.is(removeWidgetEffect)) {
                            const refId = effect.value.refId ?? "";
                            if (!refId.startsWith("inline:")) {
                                return "layout";
                            }

                            hasInlineOnlyEffect = true;
                            continue;
                        }

                        if (effect.is(addLoadingWidgetEffect) || effect.is(setRenderedWidgetEffect)) {
                            if (effect.value.mode === "embed") {
                                return "layout";
                            }

                            hasInlineOnlyEffect = true;
                        }
                    }
                }

                return hasInlineOnlyEffect ? "inline-only" : "none";
            }

            private selectionOverlapsRange(from: number, to: number): boolean {
                return this.view.state.selection.ranges.some((range) => range.from <= to && range.to >= from);
            }

            private selectionTouchesRenderedTarget(): boolean {
                return this.view.state.selection.ranges.some((range) => {
                    const queryFrom = Math.max(0, range.from - 1);
                    const queryTo = Math.min(this.view.state.doc.length, range.to + 1);

                    for (const widgetState of this.visibleWidgetStates.values()) {
                        if (widgetState.to >= queryFrom && widgetState.from <= queryTo) {
                            return true;
                        }
                    }

                    return false;
                });
            }

            private estimateEmbedPlaceholderHeight(uuid: string): number {
                const block = plugin.indexService.getBlock(uuid);
                if (!block) {
                    return EMBED_PLACEHOLDER_BASE_HEIGHT_PX + (EMBED_PLACEHOLDER_MIN_LINES * EMBED_PLACEHOLDER_LINE_HEIGHT_PX);
                }

                const combinedContent = [block.rawContent, block.childrenMarkdown]
                    .filter((value) => value && value.trim().length > 0)
                    .join("\n");

                if (!combinedContent) {
                    return EMBED_PLACEHOLDER_BASE_HEIGHT_PX + (EMBED_PLACEHOLDER_MIN_LINES * EMBED_PLACEHOLDER_LINE_HEIGHT_PX);
                }

                const lineCount = combinedContent.split(/\r?\n/).length;
                const estimatedLines = Math.max(
                    EMBED_PLACEHOLDER_MIN_LINES,
                    Math.min(lineCount + 1, EMBED_PLACEHOLDER_MAX_LINES),
                );

                return EMBED_PLACEHOLDER_BASE_HEIGHT_PX + (estimatedLines * EMBED_PLACEHOLDER_LINE_HEIGHT_PX);
            }

            private getReservedHeightPx(target: BlockRenderTarget): number {
                if (target.mode !== "embed") {
                    return 0;
                }

                const refId = getTargetRefId(target);
                const cachedHeight = this.embedHeightCache.get(refId);
                if (cachedHeight && cachedHeight > 0) {
                    return cachedHeight;
                }

                return this.estimateEmbedPlaceholderHeight(target.uuid);
            }

            private measureListEmbedLayout(target: BlockRenderTarget): ListEmbedLayout | null {
                const lineStartCoords = this.view.coordsAtPos(target.from);
                const markerCoords = target.listMarkerPos !== undefined ? this.view.coordsAtPos(target.listMarkerPos) : null;
                const contentPos = target.listContentPos ?? target.revealPos ?? target.from;
                const contentCoords = this.view.coordsAtPos(contentPos);
                const lineBlock = this.view.lineBlockAt(target.from);
                if (!lineStartCoords || !markerCoords || !contentCoords) {
                    return null;
                }

                const markerOffsetPx = Math.max(Math.round(markerCoords.left - lineStartCoords.left), 0);
                const contentOffsetPx = Math.max(Math.round(contentCoords.left - lineStartCoords.left), 0);
                if (contentOffsetPx <= markerOffsetPx + 4) {
                    return null;
                }

                return {
                    markerOffsetPx,
                    contentOffsetPx,
                    lineHeight: Math.max(Math.round(lineBlock.height), 0),
                };
            }

            private measureInlineEmbedWidth(target: BlockRenderTarget): InlineEmbedWidthGeometry | null {
                const anchorCoords = this.view.coordsAtPos(target.from);
                const contentRect = this.view.contentDOM.getBoundingClientRect();
                if (!anchorCoords || contentRect.width <= 0) {
                    return null;
                }

                const availableWidthPx = Math.max(
                    Math.round(contentRect.right - anchorCoords.left - 8),
                    0,
                );

                if (availableWidthPx <= 0) {
                    return null;
                }

                return { availableWidthPx };
            }

            private measureRenderTarget(target: BlockRenderTarget): BlockRenderTarget {
                const reservedHeightPx = this.getReservedHeightPx(target);
                const stale = plugin.indexService.getBlockStatus(target.uuid) === "stale";

                if (target.preserveListMarker) {
                    const refId = getTargetRefId(target);
                    const measuredWidth = this.measureInlineEmbedWidth(target);
                    if (measuredWidth) {
                        this.inlineEmbedWidthCache.set(refId, measuredWidth);
                    }

                    const inlineWidth = measuredWidth ?? this.inlineEmbedWidthCache.get(refId);
                    if (!inlineWidth) {
                        return {
                            ...target,
                            stale,
                            reservedHeightPx,
                        };
                    }

                    return {
                        ...target,
                        stale,
                        availableInlineWidthPx: inlineWidth.availableWidthPx,
                        reservedHeightPx,
                    };
                }

                if (!target.renderAsListItem) {
                    return {
                        ...target,
                        stale,
                        reservedHeightPx,
                    };
                }

                const refId = getTargetRefId(target);
                const measuredLayout = this.measureListEmbedLayout(target);
                if (measuredLayout) {
                    this.listEmbedLayoutCache.set(refId, measuredLayout);
                }

                const layout = measuredLayout ?? this.listEmbedLayoutCache.get(refId);
                if (!layout) {
                    return {
                        ...target,
                        stale,
                        reservedHeightPx,
                    };
                }

                return {
                    ...target,
                    stale,
                    listMarkerOffsetPx: layout.markerOffsetPx,
                    listContentOffsetPx: layout.contentOffsetPx,
                    lineHeightPx: layout.lineHeight,
                    reservedHeightPx,
                };
            }

            private createEmbedInteraction(target: BlockRenderTarget, widgetSignature: string) {
                return {
                    from: target.from,
                    to: target.to,
                    revealPos: target.revealPos ?? target.from,
                    stale: target.stale,
                    blockWidget: target.blockWidget,
                    preserveListMarker: target.preserveListMarker,
                    availableInlineWidthPx: target.availableInlineWidthPx,
                    listPrefixColumns: target.renderAsListItem ? target.indentColumns : undefined,
                    listMarkerOffsetPx: target.listMarkerOffsetPx,
                    listContentOffsetPx: target.listContentOffsetPx,
                    cardPos: target.cardPos,
                    refId: getTargetRefId(target),
                    sourceBlockId: target.uuid,
                    signature: widgetSignature,
                    lineHeightPx: target.lineHeightPx,
                    reservedHeightPx: target.reservedHeightPx,
                };
            }

            private captureRenderedEmbedHeight(refId: string) {
                this.view.requestMeasure({
                    read: () => {
                        const widget = this.view.scrollDOM.querySelector(`.block-reference-embed-widget[data-block-ref-id="${CSS.escape(refId)}"]`);
                        if (!isHtmlElement(widget)) {
                            return null;
                        }

                        const height = Math.ceil(widget.getBoundingClientRect().height);
                        return height > 0 ? height : null;
                    },
                    write: (height) => {
                        if (typeof height === "number" && height > 0) {
                            this.embedHeightCache.set(refId, height);
                        }
                    },
                });
            }

            private ensureTargetsUpToDate() {
                if (!this.cachedTargetsDirty) {
                    return;
                }

                const doc = this.view.state.doc;
                const docText = doc.sliceString(0, doc.length);
                this.cachedTargets = collectRenderTargets(docText);
                this.cachedTargetsDirty = false;
            }

            private expandRangeByLineMargin(from: number, to: number): VisibleScanRange {
                const doc = this.view.state.doc;
                const fromLine = Math.max(1, doc.lineAt(from).number - VISIBLE_SCAN_MARGIN_LINES);
                const toLine = Math.min(doc.lines, doc.lineAt(Math.max(from, to - 1)).number + VISIBLE_SCAN_MARGIN_LINES);

                return {
                    from: doc.line(fromLine).from,
                    to: doc.line(toLine).to,
                };
            }

            private getVisibleScanRanges(): VisibleScanRange[] {
                if (this.view.visibleRanges.length > 0) {
                    return this.view.visibleRanges.map((range) => this.expandRangeByLineMargin(range.from, range.to));
                }

                const viewport = this.view.viewport;
                return [this.expandRangeByLineMargin(viewport.from, viewport.to)];
            }

            private isTargetInVisibleScanRanges(target: BlockRenderTarget, ranges: VisibleScanRange[]) {
                for (const range of ranges) {
                    if (target.to >= range.from && target.from <= range.to) {
                        return true;
                    }
                }

                return false;
            }

            private pumpEmbedRenderQueue() {
                while (this.runningEmbedRenderCount < MAX_CONCURRENT_EMBED_RENDERS && this.pendingEmbedRenderQueue.length > 0) {
                    const target = this.pendingEmbedRenderQueue.shift();
                    if (!target) {
                        return;
                    }

                    this.runningEmbedRenderCount += 1;
                    void this.triggerRender(target).finally(() => {
                        this.runningEmbedRenderCount = Math.max(this.runningEmbedRenderCount - 1, 0);
                        this.pumpEmbedRenderQueue();
                    });
                }
            }

            private buildListEmbedCard(target: BlockRenderTarget, html: string): HTMLElement {
                const card = this.getViewDocument().createElement("div");
                card.className = "block-reference-enhancer-widget block-reference-embed-widget markdown-rendered is-list-embed-card block-reference-live-preview-overlay-card";
                card.dataset.blockRefFrom = String(target.from);
                card.dataset.blockRefTo = String(target.to);
                card.dataset.blockRefRevealPos = String(target.revealPos ?? target.from);
                card.dataset.blockRefId = getTargetRefId(target);
                const layout = this.getViewDocument().createElement("div");
                layout.className = "block-reference-live-preview-embed-layout is-list-card";

                const embed = this.getViewDocument().createElement("div");
                embed.className = "block-reference-embed block-reference-live-preview-embed-card";
                replaceChildrenFromHtml(embed, html);

                layout.appendChild(embed);
                card.appendChild(layout);
                this.ensureOverlayRoot().appendChild(card);
                return card;
            }

            private updateListEmbedCardPosition(card: HTMLElement, target: BlockRenderTarget) {
                card.style.left = `${target.anchorLeftPx ?? 0}px`;
                card.style.top = `${target.anchorTopPx ?? 0}px`;
                card.style.width = `${target.anchorWidthPx ?? 0}px`;
                card.style.maxWidth = `${target.anchorWidthPx ?? 0}px`;
            }

            private syncListEmbedOverlay(target: BlockRenderTarget) {
                const refId = getTargetRefId(target);
                const state = this.listEmbedOverlayStates.get(refId);
                if (!state) {
                    const existing = this.listEmbedOverlayEntries.get(refId);
                    if (existing) {
                        existing.card.remove();
                        this.listEmbedOverlayEntries.delete(refId);
                    }
                    return;
                }

                const existing = this.listEmbedOverlayEntries.get(refId);
                if (!existing) {
                    const card = this.buildListEmbedCard(target, state.html);
                    this.updateListEmbedCardPosition(card, target);
                    this.listEmbedOverlayEntries.set(refId, { card, state });
                    return;
                }

                if (existing.state.html !== state.html) {
                    existing.card.empty();
                    const layout = this.getViewDocument().createElement("div");
                    layout.className = "block-reference-live-preview-embed-layout is-list-card";

                    const embed = this.getViewDocument().createElement("div");
                    embed.className = "block-reference-embed block-reference-live-preview-embed-card";
                    replaceChildrenFromHtml(embed, state.html);

                    layout.appendChild(embed);
                    existing.card.appendChild(layout);
                    existing.state = state;
                }

                this.updateListEmbedCardPosition(existing.card, target);
            }

            private syncListEmbedOverlays(targets: BlockRenderTarget[]) {
                const activeRefIds = new Set<string>();
                for (const target of targets) {
                    if (!target.renderAsListItem) {
                        continue;
                    }

                    const refId = getTargetRefId(target);
                    activeRefIds.add(refId);
                    this.syncListEmbedOverlay(target);
                }

                for (const [refId, entry] of this.listEmbedOverlayEntries.entries()) {
                    if (activeRefIds.has(refId)) {
                        continue;
                    }

                    entry.card.remove();
                    this.listEmbedOverlayEntries.delete(refId);
                }
            }

            private syncRevealedEmbedTarget(targets: BlockRenderTarget[]) {
                if (this.revealedEmbedPos === null) {
                    return;
                }

                const activeTarget = targets.find((target) => {
                    if (target.mode !== "embed") {
                        return false;
                    }

                    const revealFrom = target.revealFrom ?? target.from;
                    const revealTo = target.revealTo ?? target.to;
                    return this.revealedEmbedPos !== null
                        && this.revealedEmbedPos >= revealFrom
                        && this.revealedEmbedPos <= revealTo;
                });

                if (!activeTarget) {
                    this.revealedEmbedPos = null;
                    return;
                }

                const revealFrom = activeTarget.revealFrom ?? activeTarget.from;
                const revealTo = activeTarget.revealTo ?? activeTarget.to;
                if (!this.selectionOverlapsRange(revealFrom, revealTo)) {
                    this.revealedEmbedPos = null;
                    return;
                }

                this.revealedEmbedPos = activeTarget.revealPos ?? activeTarget.from;
            }

            private shouldRevealSource(target: BlockRenderTarget): boolean {
                if (target.mode === "inline") {
                    const revealFrom = target.revealFrom ?? target.from;
                    const revealTo = target.revealTo ?? target.to;
                    return this.selectionOverlapsRange(revealFrom, revealTo);
                }

                if (this.revealedEmbedPos === null) {
                    return false;
                }

                const revealFrom = target.revealFrom ?? target.from;
                const revealTo = target.revealTo ?? target.to;
                return this.revealedEmbedPos >= revealFrom && this.revealedEmbedPos <= revealTo;
            }

            private revealEmbedSource(from: number, to: number, revealPos: number, refId?: string) {
                const runningTask = this.runningRenders.get(from);
                if (runningTask) {
                    runningTask.controller.abort();
                    this.runningRenders.delete(from);
                }

                this.revealedEmbedPos = revealPos;
                this.view.focus();
                this.view.dispatch({
                    selection: EditorSelection.single(revealPos),
                    effects: removeWidgetEffect.of({ from, to, refId }),
                    scrollIntoView: true,
                });
            }

            handleEmbedRevealPointer(event: MouseEvent): boolean {
                if (event.button !== 0) {
                    return false;
                }

                const target = event.target;
                if (!isHtmlElement(target)) {
                    return false;
                }

                const widget = target.closest(".block-reference-embed-widget");
                if (!isHtmlElement(widget)) {
                    return false;
                }

                const from = Number(widget.dataset.blockRefFrom);
                const to = Number(widget.dataset.blockRefTo);
                const revealPos = Number(widget.dataset.blockRefRevealPos);
                const refId = widget.dataset.blockRefId;

                if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(revealPos)) {
                    return false;
                }

                event.preventDefault();
                event.stopPropagation();
                this.revealEmbedSource(from, to, revealPos, refId);
                return true;
            }

            scanAndRender() {
                this.ensureTargetsUpToDate();
                const visibleScanRanges = this.getVisibleScanRanges();
                const selectionFingerprint = this.view.state.selection.ranges
                    .map((range) => `${range.from}:${range.to}`)
                    .join("|");
                const contentWidth = Math.round(this.view.contentDOM.getBoundingClientRect().width);
                const scanFingerprint = [
                    this.documentScanVersion,
                    visibleScanRanges.map((range) => `${range.from}-${range.to}`).join("|"),
                    selectionFingerprint,
                    this.revealedEmbedPos ?? -1,
                    this.view.hasFocus ? 1 : 0,
                    contentWidth,
                    plugin.indexService.getIndexRevision(),
                ].join(":");

                if (scanFingerprint === this.lastScanFingerprint) {
                    return;
                }

                this.lastScanFingerprint = scanFingerprint;
                this.syncRevealedEmbedTarget(this.cachedTargets);
                const targets = this.cachedTargets
                    .filter((target) => this.isTargetInVisibleScanRanges(target, visibleScanRanges))
                    .map((target) => this.measureRenderTarget(target));
                const activeTargets = new Map<number, BlockRenderTarget>();

                for (const target of targets) {
                    if (!this.shouldRevealSource(target)) {
                        activeTargets.set(target.from, target);
                    }
                }

                for (const [from, task] of this.runningRenders.entries()) {
                    const target = activeTargets.get(from);
                    if (!target || task.signature !== buildRenderSignature(target)) {
                        task.controller.abort();
                        this.runningRenders.delete(from);
                    }
                }

                const removeEffects: Array<ReturnType<typeof removeWidgetEffect.of>> = [];
                const nextVisibleWidgetStates = new Map<string, VisibleWidgetState>();

                for (const target of activeTargets.values()) {
                    const refId = getTargetRefId(target);
                    nextVisibleWidgetStates.set(refId, {
                        from: target.from,
                        to: target.to,
                        signature: buildTargetSignature(target),
                    });
                }

                for (const [refId, previousState] of this.visibleWidgetStates.entries()) {
                    const nextState = nextVisibleWidgetStates.get(refId);
                    if (nextState && nextState.signature === previousState.signature) {
                        continue;
                    }

                    removeEffects.push(removeWidgetEffect.of({
                        from: previousState.from,
                        to: previousState.to,
                        refId,
                    }));
                }

                this.pendingEmbedRenderQueue = [];
                const inlineRenderEffects: Array<ReturnType<typeof setRenderedWidgetEffect.of>> = [];
                const embedLoadingEffects: Array<ReturnType<typeof addLoadingWidgetEffect.of>> = [];
                for (const target of activeTargets.values()) {
                    const refId = getTargetRefId(target);
                    const previousState = this.visibleWidgetStates.get(refId);
                    const nextState = nextVisibleWidgetStates.get(refId);
                    const isUnchanged = previousState !== undefined
                        && nextState !== undefined
                        && previousState.signature === nextState.signature;

                    if (isUnchanged || this.runningRenders.has(target.from)) {
                        continue;
                    }

                    if (target.mode === "embed") {
                        this.pendingEmbedRenderQueue.push(target);
                        embedLoadingEffects.push(addLoadingWidgetEffect.of({
                            from: target.from,
                            to: target.to,
                            uuid: target.uuid,
                            mode: "embed",
                            interaction: this.createEmbedInteraction(target, buildTargetSignature(target)),
                        }));
                        continue;
                    }

                    const inlineInfo = plugin.getInlineReferenceInfo(target.uuid);
                    inlineRenderEffects.push(setRenderedWidgetEffect.of({
                        from: target.from,
                        to: target.to,
                        content: inlineInfo.text ?? "[missing block]",
                        mode: "inline",
                        interaction: {
                            from: target.from,
                            to: target.to,
                            revealPos: target.from,
                            stale: inlineInfo.stale,
                            sourceBlockId: target.uuid,
                        },
                    }));
                }

                const immediateEffects = [
                    ...removeEffects,
                    ...inlineRenderEffects,
                    ...embedLoadingEffects,
                ];

                if (immediateEffects.length > 0) {
                    this.view.dispatch({ effects: immediateEffects });
                }

                this.visibleWidgetStates = nextVisibleWidgetStates;
                this.pumpEmbedRenderQueue();
            }

            async triggerRender(target: BlockRenderTarget) {
                const controller = new AbortController();
                const renderSignature = buildRenderSignature(target);
                const widgetSignature = buildTargetSignature(target);
                this.runningRenders.set(target.from, { controller, signature: renderSignature });

                try {
                    if (target.mode === "inline") {
                        const inlineInfo = plugin.getInlineReferenceInfo(target.uuid);
                        const summary = inlineInfo.text ?? "[missing block]";

                        if (controller.signal.aborted) {
                            return;
                        }

                        this.view.dispatch({
                            effects: setRenderedWidgetEffect.of({
                                from: target.from,
                                to: target.to,
                                content: summary,
                                mode: "inline",
                                interaction: {
                                    from: target.from,
                                    to: target.to,
                                    revealPos: target.from,
                                    stale: inlineInfo.stale,
                                },
                            }),
                        });
                        return;
                    }

                    const sourcePath = this.view.state.field(editorInfoField).file?.path ?? "";
                    const embedInnerHtml = await plugin.buildEmbedHtml(target.uuid, sourcePath, this.component);
                    const html = `<div class="block-reference-live-preview-embed-layout"><div class="block-reference-embed block-reference-live-preview-embed-card">${embedInnerHtml}</div></div>`;

                    if (controller.signal.aborted) {
                        return;
                    }

                    const refId = getTargetRefId(target);
                    this.view.dispatch({
                        effects: setRenderedWidgetEffect.of({
                            from: target.from,
                            to: target.to,
                            content: html,
                            mode: "embed",
                            interaction: this.createEmbedInteraction(target, widgetSignature),
                        }),
                    });
                    this.captureRenderedEmbedHeight(refId);
                } catch (error) {
                    console.error("Block Reference Enhancer Error:", error);
                } finally {
                    const runningTask = this.runningRenders.get(target.from);
                    if (runningTask?.signature === renderSignature) {
                        this.runningRenders.delete(target.from);
                    }
                }
            }
        },
        {
            eventHandlers: {
                mousedown(event) {
                    return this.handleEmbedRevealPointer(event);
                },
            },
        }
    );
}
