import { CachedMetadata, Component, Editor, ListItemCache, MarkdownPostProcessorContext, MarkdownRenderChild, MarkdownRenderer, MarkdownView, Menu, Notice, Plugin, TFile } from 'obsidian';
import { IndexService } from './services/IndexService';
import { BlockSuggest } from './editor/BlockSuggest';
import { blockReferenceField } from './editor/BlockReferenceField';
import { createAsyncBlockRendererPlugin } from './editor/AsyncBlockRendererPlugin';
import { createSourceReferenceBadgePlugin } from './editor/SourceReferenceBadgePlugin';
import { BlockCache, BlockReferenceLocation, IndexBuildStats, IndexProgress, IndexStatus, LegacyPersistedBlockCacheEntry, PersistedIndexCacheV3 } from './types';
import { StaleBlockReviewModal } from './ui/StaleBlockReviewModal';
import { createSourceReferenceBadgeElement } from './ui/SourceReferenceBadgeElement';
import { createSourceBlockBackButtonElement } from './ui/SourceBlockBackButtonElement';
import { SourceReferencePopover } from './ui/SourceReferencePopover';
import { isHtmlElement } from './utils/dom';
import { serializeChildrenToHtml } from './utils/html';

type BlockReferenceEnhancerSettings = Record<string, never>;

interface BlockReferenceEnhancerPersistedData {
	settings?: Partial<BlockReferenceEnhancerSettings>;
	indexCache?: PersistedIndexCacheV3 | LegacyPersistedBlockCacheEntry[] | null;
}

const DEFAULT_SETTINGS: BlockReferenceEnhancerSettings = {};

const MAX_INLINE_SUMMARY_LENGTH = 60;
const STANDALONE_EMBED_REGEX = /^\s*\{\{embed\s+\(\(([A-Za-z0-9_-]{36,})\)\)\s*\}\}\s*$/;
const MANUAL_RENDER_SCOPE_ATTR = 'data-block-ref-manual-render';
const MANAGED_NODE_ATTR = 'data-block-ref-managed-node';
const EMBED_PLACEHOLDER_LINE_HEIGHT_PX = 22;
const EMBED_PLACEHOLDER_BASE_HEIGHT_PX = 24;
const EMBED_PLACEHOLDER_MIN_LINES = 2;
const EMBED_PLACEHOLDER_MAX_LINES = 10;
const READING_MODE_SCROLL_IDLE_MS = 180;
const SCROLL_ANCHOR_SAMPLE_OFFSETS_PX = [16, 32, 48, 72];

interface DeferredEmbedRenderTask {
	host: HTMLElement;
	uuid: string;
	sourcePath: string;
	component: Component;
	visitedEmbeds: Set<string>;
}

interface ScrollAnchorSnapshot {
	element: HTMLElement;
	top: number;
}

interface ReadingModeRenderQueue {
	previewRoot: HTMLElement;
	scrollRoot: HTMLElement;
	tasks: DeferredEmbedRenderTask[];
	scrollListener: () => void;
	idleTimer: number | null;
	isScrolling: boolean;
	isFlushing: boolean;
	isFlushScheduled: boolean;
	retainCount: number;
}

interface ReferencePreviewCacheEntry {
	mtime: number;
	lines: string[];
}

function createBlockReferenceRegex() {
	return /\{\{embed\s+\(\(([A-Za-z0-9_-]{36,})\)\)\s*\}\}|\(\(([A-Za-z0-9_-]{36,})\)\)|（（([A-Za-z0-9_-]{36,})））/g;
}

class ReferencePostProcessChild extends MarkdownRenderChild {
	private readingModeQueueRoot: HTMLElement | null = null;

	constructor(
		containerEl: HTMLElement,
		private readonly plugin: BlockReferenceEnhancer,
		private readonly context: MarkdownPostProcessorContext
	) {
		super(containerEl);
	}

	onload() {
		void this.loadReferences();
	}

	private async loadReferences() {
		this.readingModeQueueRoot = this.plugin.attachReadingModeRenderQueue(this.containerEl);
		await this.plugin.processRenderedReferences(this.containerEl, this.context.sourcePath, this, new Set<string>());
		this.plugin.processReadingModeSourceBlockBadges(this.containerEl, this.context);
	}

	onunload() {
		this.plugin.detachReadingModeRenderQueue(this.readingModeQueueRoot);
	}
}

export default class BlockReferenceEnhancer extends Plugin {
	settings: BlockReferenceEnhancerSettings;
	indexService: IndexService;
	private readonly readingModeRenderQueues = new Map<HTMLElement, ReadingModeRenderQueue>();
	private readonly referencePreviewCache = new Map<string, ReferencePreviewCacheEntry>();
	private statusBarEl: HTMLElement | null = null;
	private lastKnownIndexStats: IndexBuildStats | null = null;
	private startupFullRebuildPending = false;
	private sourceReferencePopover: SourceReferencePopover | null = null;
	private persistedData: BlockReferenceEnhancerPersistedData = {};

	private getBackButtonHost(target: HTMLElement): HTMLElement | null {
		const host = target.closest('.block-reference-inline-ref, .block-reference-embed');
		return isHtmlElement(host) ? host : null;
	}

	private clearPinnedBackButtons(except?: HTMLElement | null) {
		activeDocument.querySelectorAll('.is-back-pinned').forEach((element) => {
			if (except && element === except) {
				return;
			}

			if (isHtmlElement(element)) {
				element.removeClass('is-back-pinned');
			}
		});
	}

	private pinBackButtonHost(host: HTMLElement) {
		this.clearPinnedBackButtons(host);
		host.addClass('is-back-pinned');
	}

	async onload() {
		await this.loadSettings();

		this.indexService = new IndexService(this.app, {
			load: async () => this.persistedData.indexCache ?? null,
			save: async (cache) => {
				this.persistedData = {
					...this.persistedData,
					settings: this.settings,
					indexCache: cache,
				};
				await this.saveData(this.persistedData);
			},
		});
		this.sourceReferencePopover = new SourceReferencePopover(this);
		this.statusBarEl = this.addStatusBarItem();
		this.setIndexStatusMessage('Block index: loading cache...');

		this.addCommand({
			id: 'rebuild-block-reference-index',
			name: 'Rebuild block reference index',
			callback: () => {
				void this.rebuildBlockReferenceIndex();
			},
		});

		this.addCommand({
			id: 'copy-current-block-reference',
			name: 'Copy current block reference',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				void this.handleCopyBlockReference(editor, view);
			},
		});

		this.addCommand({
			id: 'copy-current-block-embed',
			name: 'Copy current block embed',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				void this.handleCopyBlockEmbed(editor, view);
			},
		});

		this.addCommand({
			id: 'review-missing-source-blocks',
			name: 'Review missing source blocks',
			callback: () => {
				this.openStaleBlockReview();
			},
		});

		this.registerDomEvent(activeDocument, 'mousedown', (event) => {
			if (event.button !== 0) {
				return;
			}

			const target = event.target;
			if (!isHtmlElement(target)) {
				return;
			}

			const backButton = target.closest('.block-reference-back-button');
			if (isHtmlElement(backButton)) {
				const host = this.getBackButtonHost(backButton);
				if (host) {
					this.pinBackButtonHost(host);
				}

				event.preventDefault();
				event.stopPropagation();
				return;
			}

			const backHost = this.getBackButtonHost(target);
			if (backHost) {
				this.pinBackButtonHost(backHost);
			} else {
				this.clearPinnedBackButtons();
			}

			const badge = target.closest('.block-reference-source-badge');
			if (!isHtmlElement(badge)) {
				return;
			}

			const blockId = badge.dataset.blockRefSourceId;
			if (!blockId) {
				return;
			}

			const sourceFilePath = badge.dataset.blockRefSourceFilePath;
			const sourceStartLine = badge.dataset.blockRefSourceStartLine;

			event.preventDefault();
			event.stopPropagation();
			const parsedSourceStartLine = typeof sourceStartLine === 'string' ? Number(sourceStartLine) : undefined;
			void this.toggleSourceReferencePopover(
				badge,
				blockId,
				sourceFilePath,
				typeof parsedSourceStartLine === 'number' && Number.isFinite(parsedSourceStartLine)
				? parsedSourceStartLine
					: undefined,
			);
		}, true);

		this.registerDomEvent(activeDocument, 'click', (event) => {
			if (event.button !== 0) {
				return;
			}

			const target = event.target;
			if (!isHtmlElement(target)) {
				return;
			}

			const backButton = target.closest('.block-reference-back-button');
			if (!isHtmlElement(backButton)) {
				return;
			}

			const blockId = backButton.dataset.blockRefSourceId;
			if (!blockId) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			void this.openSourceBlockFromBackButton(blockId, event);
		}, true);

		this.app.workspace.onLayoutReady(() => {
			void this.handleLayoutReady();
		});
	}

	onunload() {
		this.sourceReferencePopover?.destroy();
	}

	private async handleLayoutReady() {
		this.registerEvent(this.indexService.on('index-updated', () => {
			this.referencePreviewCache.clear();
			void this.sourceReferencePopover?.refreshIfOpen();
			this.refreshOpenMarkdownViews();
		}));

		await this.indexService.initialize({
			onProgress: (progress) => {
				this.updateIndexProgress(progress);
			},
			onStatus: (status) => {
				this.handleIndexStatus(status);
			},
		});

		this.registerMarkdownPostProcessor((element, context) => {
			return this.readingModeRenderer(element, context);
		});

		const asyncPlugin = createAsyncBlockRendererPlugin(this);
		const sourceReferenceBadgePlugin = createSourceReferenceBadgePlugin(this);
		this.registerEditorExtension([blockReferenceField, asyncPlugin, sourceReferenceBadgePlugin]);

		this.registerEditorSuggest(new BlockSuggest(this.app, this.indexService));

		this.setupFileEvents();
		this.refreshOpenMarkdownViews();
	}

	setupFileEvents() {
		this.registerEvent(this.app.vault.on('create', (file) => {
			if (file instanceof TFile && file.extension === 'md') {
				void this.indexService.processFileChange(file);
			}
		}));

		this.registerEvent(this.app.vault.on('modify', (file) => {
			if (file instanceof TFile && file.extension === 'md') {
				void this.indexService.processFileChange(file);
			}
		}));

		this.registerEvent(this.app.vault.on('delete', (file) => {
			if (file instanceof TFile && file.extension === 'md') {
				void this.indexService.processFileDelete(file.path);
			}
		}));

		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			if (file instanceof TFile && file.extension === 'md') {
				void this.indexService.processFileRename(oldPath, file.path);
			}
		}));
	}

	async loadSettings() {
		const rawData: unknown = await this.loadData();
		if (this.isPersistedData(rawData)) {
			this.persistedData = rawData;
		} else {
			this.persistedData = {
				settings: rawData as Partial<BlockReferenceEnhancerSettings> | undefined,
				indexCache: null,
			};
		}

		this.settings = Object.assign({}, DEFAULT_SETTINGS, this.persistedData.settings ?? {});
	}

	async saveSettings() {
		this.persistedData = {
			...this.persistedData,
			settings: this.settings,
		};
		await this.saveData(this.persistedData);
	}

	private isPersistedData(value: unknown): value is BlockReferenceEnhancerPersistedData {
		return !!value && typeof value === 'object' && ('settings' in value || 'indexCache' in value);
	}

	async handleCopyBlockReference(editor: Editor, view: MarkdownView) {
		await this.copyCurrentBlockSyntax(editor, view, 'reference');
	}

	async handleCopyBlockEmbed(editor: Editor, view: MarkdownView) {
		await this.copyCurrentBlockSyntax(editor, view, 'embed');
	}

	private async copyCurrentBlockSyntax(editor: Editor, view: MarkdownView, syntax: 'reference' | 'embed') {
		const blockId = this.getOrCreateCurrentBlockId(editor, view);
		if (!blockId) {
			return;
		}

		if (!navigator.clipboard?.writeText) {
			new Notice('Clipboard API unavailable on this platform.');
			return;
		}

		const text = syntax === 'embed'
			? `{{embed ((${blockId}))}}`
			: `((${blockId}))`;
		await navigator.clipboard.writeText(text);
		new Notice(syntax === 'embed' ? 'Block embed copied to clipboard!' : 'Block reference copied to clipboard!');
	}

	private measureIndentColumns(value: string): number {
		let columns = 0;
		for (const char of value) {
			columns += char === '\t' ? 4 : 1;
		}

		return columns;
	}

	private findExistingBlockIdInEditor(editor: Editor, blockLine: number): string | null {
		const sourceLine = editor.getLine(blockLine);
		const baseIndent = sourceLine.match(/^(\s*)/)?.[1] ?? '';
		const baseIndentColumns = this.measureIndentColumns(baseIndent);

		for (let line = blockLine + 1; line < editor.lineCount(); line++) {
			const lineContent = editor.getLine(line);
			if (lineContent.trim().length === 0) {
				continue;
			}

			const indentation = lineContent.match(/^(\s*)/)?.[1] ?? '';
			const indentationColumns = this.measureIndentColumns(indentation);
			if (indentationColumns <= baseIndentColumns) {
				break;
			}

			const idMatch = lineContent.match(/^\s*id::\s*([A-Za-z0-9_-]{36,})\s*$/);
			if (idMatch) {
				return idMatch[1];
			}
		}

		return null;
	}

	private getOrCreateCurrentBlockId(editor: Editor, view: MarkdownView): string | null {
		const file = view.file;
		if (!file) return null;

		const cursor = editor.getCursor();
		const line = cursor.line;
		const lineContent = editor.getLine(line);

		const blockMatch = lineContent.match(/^\s*-\s(.+)/);
		if (!blockMatch) {
			new Notice('This line is not a valid source block.');
			return null;
		}

		let existingBlock = this.indexService.findBlockByFileAndLine(file.path, line);
		if (existingBlock) {
			return existingBlock.id;
		}

		const existingBlockId = this.findExistingBlockIdInEditor(editor, line);
		if (existingBlockId) {
			if (!this.indexService.getBlock(existingBlockId)) {
				this.indexService.addBlock(existingBlockId, {
					filePath: file.path,
					rawContent: blockMatch[1],
					childrenMarkdown: '',
					startLine: line,
					endLine: line,
					childrenIDs: [],
				});
			}

			return existingBlockId;
		}

		const blockId = crypto.randomUUID();
		const indentationMatch = lineContent.match(/^(\s*)/);
		const indentation = indentationMatch ? indentationMatch[1] : '';
		const idLine = `\n${indentation}  id:: ${blockId}`;

		editor.replaceRange(idLine, { line: line, ch: lineContent.length });

		this.indexService.addBlock(blockId, {
			filePath: file.path,
			rawContent: blockMatch[1],
			childrenMarkdown: '',
			startLine: line,
			endLine: line,
			childrenIDs: [],
		});

		return blockId;
	}

	private async openSourceBlockLocation(block: BlockCache) {
		await this.openReferenceLocation({
			filePath: block.filePath,
			line: block.startLine,
			ch: 0,
			kind: 'inline',
		});
	}

	private async openSourceBlockFromBackButton(blockId: string, event: MouseEvent) {
		const sourceBlocks = this.indexService.getActiveSourceBlocks(blockId);
		if (sourceBlocks.length === 0) {
			new Notice('Source block is missing.');
			return;
		}

		if (sourceBlocks.length === 1) {
			await this.openSourceBlockLocation(sourceBlocks[0].block);
			return;
		}

		const menu = new Menu();
		for (const { block } of sourceBlocks) {
			const lineNumber = block.startLine + 1;
			menu.addItem((item) => {
				item
					.setTitle(`${block.filePath}:${lineNumber}`)
					.setIcon('file')
					.onClick(() => {
						void this.openSourceBlockLocation(block);
					});
			});
		}

		menu.showAtMouseEvent(event);
	}

	getInlineReferenceText(uuid: string): string | null {
		return this.getInlineReferenceInfo(uuid).text;
	}

	getInlineReferenceInfo(uuid: string): { text: string | null; stale: boolean } {
		return this.getInlineReferenceInfoInternal(uuid, new Set<string>());
	}

	private getInlineReferenceInfoInternal(uuid: string, visited: Set<string>): { text: string | null; stale: boolean } {
		if (visited.has(uuid)) {
			return { text: '[cyclic block]', stale: false };
		}

		const block = this.indexService.getBlock(uuid);
		if (!block) {
			return { text: null, stale: false };
		}

		const nextVisited = new Set(visited);
		nextVisited.add(uuid);

		const firstLine = block.rawContent.split(/\r?\n/, 1)[0] ?? '';
		const expandedLine = firstLine.replace(/(?:\(\(|\uFF08\uFF08)([A-Za-z0-9_-]{36,})(?:\)\)|\uFF09\uFF09)/g, (_match, nestedUuid: string) => {
			return this.getInlineReferenceInfoInternal(nestedUuid, nextVisited).text ?? '[missing block]';
		});

		const plainText = expandedLine
			.replace(/!\[\[([^\]]+)\]\]/g, '$1')
			.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
			.replace(/\[\[([^\]]+)\]\]/g, '$1')
			.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
			.replace(/^#{1,6}\s+/g, '')
			.replace(/[*_~`]/g, '')
			.replace(/\s+/g, ' ')
			.trim();

		const summary = plainText || '[empty block]';
		return {
			text: summary.length > MAX_INLINE_SUMMARY_LENGTH
				? `${summary.slice(0, MAX_INLINE_SUMMARY_LENGTH).trimEnd()}…`
				: summary,
			stale: block.status === 'stale',
		};
	}

	async buildEmbedHtml(uuid: string, sourcePath: string, component: Component): Promise<string> {
		const host = activeDocument.createElement('div');
		await this.populateEmbedContainer(host, uuid, sourcePath, component, new Set<string>());
		return serializeChildrenToHtml(host);
	}

	attachReadingModeRenderQueue(element: HTMLElement): HTMLElement | null {
		const previewRoot = this.resolveReadingModePreviewRoot(element);
		if (!previewRoot) {
			return null;
		}

		const existingQueue = this.readingModeRenderQueues.get(previewRoot);
		if (existingQueue) {
			existingQueue.retainCount += 1;
			return previewRoot;
		}

		const scrollRoot = this.findReadingModeScrollRoot(previewRoot);
		const queue: ReadingModeRenderQueue = {
			previewRoot,
			scrollRoot,
			tasks: [],
			scrollListener: () => {
				const activeQueue = this.readingModeRenderQueues.get(previewRoot);
				if (!activeQueue) {
					return;
				}

				activeQueue.isScrolling = true;
				if (activeQueue.idleTimer !== null) {
					window.clearTimeout(activeQueue.idleTimer);
				}

				activeQueue.idleTimer = window.setTimeout(() => {
					const latestQueue = this.readingModeRenderQueues.get(previewRoot);
					if (!latestQueue) {
						return;
					}

					latestQueue.idleTimer = null;
					latestQueue.isScrolling = false;
					this.scheduleReadingModeRenderQueueFlush(previewRoot);
				}, READING_MODE_SCROLL_IDLE_MS);
			},
			idleTimer: null,
			isScrolling: false,
			isFlushing: false,
			isFlushScheduled: false,
			retainCount: 1,
		};

		scrollRoot.addEventListener('scroll', queue.scrollListener, { passive: true });
		this.readingModeRenderQueues.set(previewRoot, queue);
		return previewRoot;
	}

	detachReadingModeRenderQueue(previewRoot: HTMLElement | null) {
		if (!previewRoot) {
			return;
		}

		const queue = this.readingModeRenderQueues.get(previewRoot);
		if (!queue) {
			return;
		}

		queue.retainCount -= 1;
		if (queue.retainCount > 0) {
			return;
		}

		if (queue.idleTimer !== null) {
			window.clearTimeout(queue.idleTimer);
		}

		queue.scrollRoot.removeEventListener('scroll', queue.scrollListener);
		queue.tasks.length = 0;
		this.readingModeRenderQueues.delete(previewRoot);
	}

	private resolveReadingModePreviewRoot(element: HTMLElement): HTMLElement | null {
		const previewRoot = element.closest('.markdown-reading-view, .markdown-preview-view');
		if (isHtmlElement(previewRoot)) {
			return previewRoot;
		}

		const renderedRoot = element.closest('.markdown-rendered');
		return isHtmlElement(renderedRoot) ? renderedRoot : null;
	}

	private findReadingModeScrollRoot(previewRoot: HTMLElement): HTMLElement {
		let current: HTMLElement | null = previewRoot;

		while (current) {
			const style = window.getComputedStyle(current);
			const isScrollable = /(auto|scroll)/.test(style.overflowY) && current.scrollHeight > current.clientHeight;
			if (isScrollable) {
				return current;
			}

			current = current.parentElement;
		}

		return previewRoot;
	}

	private enqueueReadingModeEmbedRender(previewRoot: HTMLElement, task: DeferredEmbedRenderTask) {
		const queue = this.readingModeRenderQueues.get(previewRoot);
		if (!queue) {
			void this.populateEmbedContainer(task.host, task.uuid, task.sourcePath, task.component, task.visitedEmbeds);
			return;
		}

		queue.tasks.push(task);
		this.scheduleReadingModeRenderQueueFlush(previewRoot);
	}

	private scheduleReadingModeRenderQueueFlush(previewRoot: HTMLElement) {
		const queue = this.readingModeRenderQueues.get(previewRoot);
		if (!queue || queue.isFlushing || queue.isFlushScheduled || queue.isScrolling) {
			return;
		}

		queue.isFlushScheduled = true;
		window.setTimeout(() => {
			const latestQueue = this.readingModeRenderQueues.get(previewRoot);
			if (!latestQueue) {
				return;
			}

			latestQueue.isFlushScheduled = false;
			void this.flushReadingModeRenderQueue(previewRoot);
		}, 0);
	}

	private async flushReadingModeRenderQueue(previewRoot: HTMLElement) {
		const queue = this.readingModeRenderQueues.get(previewRoot);
		if (!queue || queue.isFlushing || queue.isScrolling) {
			return;
		}

		queue.isFlushing = true;

		try {
			while (queue.tasks.length > 0) {
				if (queue.isScrolling) {
					break;
				}

				const task = queue.tasks.shift();
				if (!task || !task.host.isConnected) {
					continue;
				}

				const scrollAnchor = this.captureScrollAnchor(queue.previewRoot, queue.scrollRoot, task.host);
				await this.populateEmbedContainer(task.host, task.uuid, task.sourcePath, task.component, task.visitedEmbeds);
				this.restoreScrollAnchor(queue.scrollRoot, scrollAnchor);
				await this.waitForNextAnimationFrame();
				this.restoreScrollAnchor(queue.scrollRoot, scrollAnchor);
			}
		} finally {
			queue.isFlushing = false;

			if (queue.tasks.length > 0 && !queue.isScrolling) {
				this.scheduleReadingModeRenderQueueFlush(previewRoot);
			}
		}
	}

	private captureScrollAnchor(
		previewRoot: HTMLElement,
		scrollRoot: HTMLElement,
		excludedHost: HTMLElement
	): ScrollAnchorSnapshot | null {
		if (!previewRoot.isConnected || !scrollRoot.isConnected) {
			return null;
		}

		const scrollRect = scrollRoot.getBoundingClientRect();
		if (scrollRect.height <= 1 || scrollRect.width <= 1) {
			return null;
		}

		const x = Math.min(scrollRect.right - 12, Math.max(scrollRect.left + 12, scrollRect.left + 48));
		for (const offset of SCROLL_ANCHOR_SAMPLE_OFFSETS_PX) {
			const y = Math.min(scrollRect.bottom - 1, scrollRect.top + offset);
			if (y <= scrollRect.top) {
				continue;
			}

			const hitElement = previewRoot.ownerDocument.elementFromPoint(x, y);
			if (!isHtmlElement(hitElement)) {
				continue;
			}

			const anchor = this.normalizeScrollAnchor(previewRoot, hitElement, excludedHost);
			if (anchor) {
				return {
					element: anchor,
					top: anchor.getBoundingClientRect().top,
				};
			}
		}

		return this.findVisibleScrollAnchorFallback(previewRoot, scrollRoot, excludedHost);
	}

	private findVisibleScrollAnchorFallback(
		previewRoot: HTMLElement,
		scrollRoot: HTMLElement,
		excludedHost: HTMLElement
	): ScrollAnchorSnapshot | null {
		const scrollRect = scrollRoot.getBoundingClientRect();
		const nodeFilter = previewRoot.ownerDocument.defaultView?.NodeFilter ?? NodeFilter;
		const walker = previewRoot.ownerDocument.createTreeWalker(previewRoot, nodeFilter.SHOW_ELEMENT);

		while (walker.nextNode()) {
			const candidate = walker.currentNode;
			if (!isHtmlElement(candidate)) {
				continue;
			}

			if (candidate === excludedHost || excludedHost.contains(candidate)) {
				continue;
			}

			const managedAncestor = candidate.closest(`[${MANAGED_NODE_ATTR}="true"]`);
			if (isHtmlElement(managedAncestor)) {
				continue;
			}

			const rect = candidate.getBoundingClientRect();
			if (rect.height <= 0 || rect.width <= 0) {
				continue;
			}

			if (rect.bottom < scrollRect.top || rect.top > scrollRect.bottom) {
				continue;
			}

			return {
				element: candidate,
				top: rect.top,
			};
		}

		return null;
	}

	private normalizeScrollAnchor(
		previewRoot: HTMLElement,
		element: HTMLElement,
		excludedHost: HTMLElement
	): HTMLElement | null {
		let current: HTMLElement | null = element;

		while (current) {
			if (current === excludedHost || excludedHost.contains(current)) {
				return null;
			}

			if (current === previewRoot) {
				break;
			}

			if (previewRoot.contains(current)) {
				const managedAncestor: HTMLElement | null = current.closest(`[${MANAGED_NODE_ATTR}="true"]`);
				if (isHtmlElement(managedAncestor) && managedAncestor !== excludedHost) {
					current = managedAncestor.parentElement;
					continue;
				}

				const rect = current.getBoundingClientRect();
				if (rect.height > 0 && rect.width > 0) {
					return current;
				}
			}

			current = current.parentElement;
		}

		const fallback = previewRoot.firstElementChild;
		return isHtmlElement(fallback) ? fallback : null;
	}

	private restoreScrollAnchor(scrollRoot: HTMLElement, snapshot: ScrollAnchorSnapshot | null) {
		if (!snapshot || !snapshot.element.isConnected || !scrollRoot.isConnected) {
			return;
		}

		const currentTop = snapshot.element.getBoundingClientRect().top;
		const delta = currentTop - snapshot.top;
		if (Math.abs(delta) < 0.5) {
			return;
		}

		scrollRoot.scrollTop += delta;
	}

	private waitForNextAnimationFrame(): Promise<void> {
		return new Promise((resolve) => {
			if (typeof window.requestAnimationFrame === 'function') {
				window.requestAnimationFrame(() => resolve());
				return;
			}

			window.setTimeout(resolve, 16);
		});
	}

	private markManualRenderScope(element: HTMLElement) {
		element.setAttribute(MANUAL_RENDER_SCOPE_ATTR, 'true');
	}

	private createInlineReferenceElement(ownerDocument: Document, uuid: string, summary: string, stale: boolean): HTMLSpanElement {
		const inlineRef = ownerDocument.createElement('span');
		inlineRef.addClass('block-reference-inline-ref');
		inlineRef.dataset.blockRefSourceId = uuid;
		if (stale) {
			inlineRef.addClass('is-stale');
			inlineRef.setAttribute('title', 'Source block missing. Showing cached content.');
		}
		inlineRef.setAttribute(MANAGED_NODE_ATTR, 'true');

		const text = ownerDocument.createElement('span');
		text.addClass('block-reference-inline-ref-text');
		text.setText(summary);

		inlineRef.append(text, createSourceBlockBackButtonElement(uuid, ownerDocument));
		return inlineRef;
	}

	private estimateEmbedPlaceholderHeight(uuid: string): number | null {
		const block = this.indexService.getBlock(uuid);
		if (!block) {
			return null;
		}

		const combinedContent = [block.rawContent, block.childrenMarkdown]
			.filter((value) => value && value.trim().length > 0)
			.join('\n');

		if (!combinedContent) {
			return EMBED_PLACEHOLDER_BASE_HEIGHT_PX + (EMBED_PLACEHOLDER_MIN_LINES * EMBED_PLACEHOLDER_LINE_HEIGHT_PX);
		}

		const lineCount = combinedContent.split(/\r?\n/).length;
		const estimatedLines = Math.max(
			EMBED_PLACEHOLDER_MIN_LINES,
			Math.min(lineCount + 1, EMBED_PLACEHOLDER_MAX_LINES)
		);

		return EMBED_PLACEHOLDER_BASE_HEIGHT_PX + (estimatedLines * EMBED_PLACEHOLDER_LINE_HEIGHT_PX);
	}

	private prepareEmbedContainer(container: HTMLElement, uuid: string) {
		container.empty();
		container.removeClass('block-reference-enhancer-error');
		container.removeClass('is-stale');
		container.addClass('block-reference-embed', 'is-loading');
		container.dataset.blockRefSourceId = uuid;
		container.setAttribute(MANAGED_NODE_ATTR, 'true');
		this.markManualRenderScope(container);

		const placeholderHeight = this.estimateEmbedPlaceholderHeight(uuid);
		if (placeholderHeight !== null) {
			container.style.setProperty('--block-reference-embed-placeholder-height', `${placeholderHeight}px`);
		} else {
			container.style.removeProperty('--block-reference-embed-placeholder-height');
		}

		const placeholder = container.ownerDocument.createElement('div');
		placeholder.addClass('block-reference-embed-placeholder');
		container.appendChild(placeholder);
	}

	private attachSourceBackButton(container: HTMLElement, uuid: string) {
		const existingButton = Array.from(container.children).find((child) => {
			return child.classList.contains('block-reference-back-button');
		});
		if (existingButton) {
			existingButton.remove();
		}

		container.dataset.blockRefSourceId = uuid;
		container.appendChild(createSourceBlockBackButtonElement(uuid, container));
	}

	private finalizeEmbedContainer(container: HTMLElement, uuid: string, contentNodes: Node[]) {
		container.replaceChildren(...contentNodes);
		this.attachSourceBackButton(container, uuid);
		container.removeClass('is-loading');
		container.style.removeProperty('--block-reference-embed-placeholder-height');
	}

	private shouldSkipTextNode(node: Text, root: HTMLElement): boolean {
		const parentElement = node.parentElement;
		if (!parentElement || !root.contains(parentElement)) {
			return true;
		}

		if (parentElement.closest('code, pre, .metadata-container, .frontmatter, .mod-frontmatter')) {
			return true;
		}

		const managedAncestor = parentElement.closest(`[${MANAGED_NODE_ATTR}="true"]`);
		return managedAncestor !== null;
	}

	private async renderMarkdownAndProcess(
		container: HTMLElement,
		markdown: string,
		sourcePath: string,
		component: Component,
		visitedEmbeds: Set<string>
	) {
		if (!markdown.trim()) {
			return;
		}

		this.markManualRenderScope(container);
		await MarkdownRenderer.render(this.app, markdown, container, sourcePath, component);
		await this.processRenderedReferences(container, sourcePath, component, visitedEmbeds);
	}

	async populateEmbedContainer(
		container: HTMLElement,
		uuid: string,
		sourcePath: string,
		component: Component,
		visitedEmbeds: Set<string>
	) {
		this.prepareEmbedContainer(container, uuid);

		if (visitedEmbeds.has(uuid)) {
			container.empty();
			container.removeClass('is-loading');
			container.addClass('block-reference-enhancer-error');
			container.setText('Cyclic embed');
			this.attachSourceBackButton(container, uuid);
			return;
		}

		const block = this.indexService.getBlock(uuid);
		if (!block) {
			container.empty();
			container.removeClass('is-loading');
			container.addClass('block-reference-enhancer-error');
			container.setText('Missing block');
			this.attachSourceBackButton(container, uuid);
			return;
		}

		const nextVisitedEmbeds = new Set(visitedEmbeds);
		nextVisitedEmbeds.add(uuid);

		const contentNodes: Node[] = [];
		if (block.status === 'stale') {
			container.addClass('is-stale');
			const warning = container.ownerDocument.createElement('div');
			warning.addClass('block-reference-enhancer-warning');
			warning.setText('Source block missing. Showing cached content.');
			contentNodes.push(warning);
		}

		const rootContainer = container.ownerDocument.createElement('div');
		rootContainer.addClass('block-reference-embed-root');
		await this.renderMarkdownAndProcess(rootContainer, block.rawContent, sourcePath, component, nextVisitedEmbeds);
		contentNodes.push(rootContainer);

		const childMarkdown = block.childrenMarkdown?.trim();
		if (childMarkdown) {
			const childrenContainer = container.ownerDocument.createElement('div');
			childrenContainer.addClass('block-reference-embed-children');
			await this.renderMarkdownAndProcess(childrenContainer, childMarkdown, sourcePath, component, nextVisitedEmbeds);
			contentNodes.push(childrenContainer);
		}

		this.finalizeEmbedContainer(container, uuid, contentNodes);
	}

	async processRenderedReferences(
		element: HTMLElement,
		sourcePath: string,
		component: Component,
		visitedEmbeds: Set<string>
	) {
		const previewRoot = element.isConnected ? this.resolveReadingModePreviewRoot(element) : null;
		const probeRegex = createBlockReferenceRegex();
		const nodeFilter = element.ownerDocument.defaultView?.NodeFilter ?? NodeFilter;
		const walker = element.ownerDocument.createTreeWalker(element, nodeFilter.SHOW_TEXT);
		const nodesToProcess: Text[] = [];
		const deferredEmbedTasks: DeferredEmbedRenderTask[] = [];

		while (walker.nextNode()) {
			const node = walker.currentNode as Text;
			if (this.shouldSkipTextNode(node, element)) {
				continue;
			}

			if (node.nodeValue && probeRegex.test(node.nodeValue)) {
				nodesToProcess.push(node);
			}
			probeRegex.lastIndex = 0;
		}

		for (const node of nodesToProcess) {
			if (!node.nodeValue || !node.parentNode) {
				continue;
			}

			const text = node.nodeValue;
			const standaloneEmbedMatch = text.match(STANDALONE_EMBED_REGEX);
			if (standaloneEmbedMatch) {
				const embedHost = node.ownerDocument.createElement('div');
				const parentElement = node.parentElement;

				if (parentElement?.tagName === 'P') {
					parentElement.replaceWith(embedHost);
				} else {
					node.parentNode?.replaceChild(embedHost, node);
				}

				if (previewRoot && embedHost.isConnected) {
					this.prepareEmbedContainer(embedHost, standaloneEmbedMatch[1]);
					deferredEmbedTasks.push({
						host: embedHost,
						uuid: standaloneEmbedMatch[1],
						sourcePath,
						component,
						visitedEmbeds: new Set(visitedEmbeds),
					});
				} else {
					await this.populateEmbedContainer(embedHost, standaloneEmbedMatch[1], sourcePath, component, visitedEmbeds);
				}
				continue;
			}

			let lastIndex = 0;
			let match: RegExpExecArray | null;
			let replacedInline = false;
			const fragment = node.ownerDocument.createDocumentFragment();
			const replaceRegex = createBlockReferenceRegex();

			while ((match = replaceRegex.exec(text))) {
				const embedUuid = match[1];
				const inlineUuid = match[2] ?? match[3];
				const placeholder = match[0];
				const start = match.index;

				fragment.appendChild(node.ownerDocument.createTextNode(text.slice(lastIndex, start)));

				if (embedUuid) {
					fragment.appendChild(node.ownerDocument.createTextNode(placeholder));
				} else {
					const inlineInfo = this.getInlineReferenceInfo(inlineUuid);
					const summary = inlineInfo.text ?? '[missing block]';
					fragment.appendChild(this.createInlineReferenceElement(node.ownerDocument, inlineUuid, summary, inlineInfo.stale));
					replacedInline = true;
				}

				lastIndex = start + placeholder.length;
			}

			if (!replacedInline) {
				continue;
			}

			fragment.appendChild(node.ownerDocument.createTextNode(text.slice(lastIndex)));
			node.parentNode?.replaceChild(fragment, node);
		}

		if (previewRoot) {
			for (const task of deferredEmbedTasks) {
				this.enqueueReadingModeEmbedRender(previewRoot, task);
			}
		}
	}

	async readingModeRenderer(element: HTMLElement, context: MarkdownPostProcessorContext) {
		if (element.closest(`[${MANUAL_RENDER_SCOPE_ATTR}="true"]`)) {
			return;
		}

		context.addChild(new ReferencePostProcessChild(element, this, context));
	}

	processReadingModeSourceBlockBadges(element: HTMLElement, context: MarkdownPostProcessorContext) {
		const file = this.app.vault.getAbstractFileByPath(context.sourcePath);
		if (!(file instanceof TFile)) {
			return;
		}

		const sectionInfo = context.getSectionInfo(element);
		if (!sectionInfo) {
			return;
		}

		const cache = this.app.metadataCache.getFileCache(file);
		const listItems = this.getListItemsForSection(cache, sectionInfo.lineStart, sectionInfo.lineEnd);
		if (listItems.length === 0) {
			return;
		}

		const listElements = Array.from(element.querySelectorAll('li')).filter((listItem) => {
			return listItem.closest(`[${MANAGED_NODE_ATTR}="true"]`) === null;
		});
		if (listElements.length === 0) {
			return;
		}

		element.querySelectorAll('.block-reference-source-badge-anchor').forEach((badge) => badge.remove());

		const visibleSourceBlocks = this.indexService
			.getBlocksForFile(context.sourcePath)
			.filter(({ block, id }) => {
				return block.startLine >= sectionInfo.lineStart
					&& block.startLine <= sectionInfo.lineEnd
					&& this.indexService.getReferenceCount(id) > 0;
			});

		if (visibleSourceBlocks.length === 0) {
			return;
		}

		const listItemCount = Math.min(listItems.length, listElements.length);
		const listItemByLine = new Map<number, HTMLLIElement>();
		for (let index = 0; index < listItemCount; index++) {
			listItemByLine.set(listItems[index].position.start.line, listElements[index]);
		}

		for (const { id, block } of visibleSourceBlocks) {
			const listItem = listItemByLine.get(block.startLine);
			if (!listItem) {
				continue;
			}

			const count = this.indexService.getReferenceCount(id);
			if (count <= 0) {
				continue;
			}

			this.attachReadingModeSourceBadge(listItem, block, count);
		}
	}

	async toggleSourceReferencePopover(
		anchorEl: HTMLElement,
		blockId: string,
		sourceFilePath?: string,
		sourceStartLine?: number,
	) {
		const activeBlock = this.indexService.getBlock(blockId);
		if (!activeBlock || activeBlock.status !== 'active') {
			return;
		}

		if (this.indexService.getReferenceCount(blockId) <= 0) {
			return;
		}

		const sourceBlock = sourceFilePath && typeof sourceStartLine === 'number'
			? this.indexService.findBlockByFileAndLine(sourceFilePath, sourceStartLine)?.block
			: null;

		await this.sourceReferencePopover?.toggle(anchorEl, blockId, sourceBlock ?? activeBlock);
	}

	getBlockSummary(block: BlockCache): string {
		const firstLine = block.rawContent.split(/\r?\n/, 1)[0]?.trim();
		return firstLine && firstLine.length > 0 ? firstLine : '[empty block]';
	}

	async getReferencePreview(reference: BlockReferenceLocation, maxLength = 140): Promise<string> {
		const file = this.app.vault.getAbstractFileByPath(reference.filePath);
		if (!(file instanceof TFile)) {
			return '[file not found]';
		}

		const cached = this.referencePreviewCache.get(reference.filePath);
		let lines: string[];
		if (cached && cached.mtime === file.stat.mtime) {
			lines = cached.lines;
		} else {
			const content = await this.app.vault.cachedRead(file);
			lines = content.split(/\r?\n/);
			this.referencePreviewCache.set(reference.filePath, {
				mtime: file.stat.mtime,
				lines,
			});
		}

		const line = lines[reference.line]?.trim() ?? '';
		if (!line) {
			return '[empty line]';
		}

		return line.length > maxLength ? `${line.slice(0, maxLength).trimEnd()}…` : line;
	}

	async openReferenceLocation(reference: BlockReferenceLocation) {
		const file = this.app.vault.getAbstractFileByPath(reference.filePath);
		if (!(file instanceof TFile)) {
			new Notice('Unable to open the referenced file.');
			return;
		}

		const leaf = this.app.workspace.getMostRecentLeaf() ?? this.app.workspace.getLeaf(true);
		await leaf.openFile(file, { active: true });
		await this.app.workspace.revealLeaf(leaf);

		if (leaf.view instanceof MarkdownView) {
			const position = { line: reference.line, ch: reference.ch };
			leaf.view.editor.setCursor(position);
			leaf.view.editor.scrollIntoView({ from: position, to: position }, true);
			leaf.view.editor.focus();
		}
	}

	async recoverBlockToRecoveryPage(id: string) {
		const recoveryFile = await this.indexService.recoverBlockToRecoveryPage(id);
		if (!recoveryFile) {
			new Notice('Unable to recover source block to the recovery page.');
			return;
		}

		new Notice(`Recovered source block to ${recoveryFile.path}.`);
	}

	async confirmBlockDeletion(id: string) {
		await this.indexService.confirmBlockDeletion(id);
		new Notice('Confirmed missing source block deletion.');
	}

	openStaleBlockReview() {
		new StaleBlockReviewModal(this.app, this).open();
	}

	private async rebuildBlockReferenceIndex() {
		new Notice('Building block index...');

		try {
			const stats = await this.indexService.rebuildIndex({
				phase: 'rebuild',
				onProgress: (progress) => {
					this.updateIndexProgress(progress);
				},
			});
			this.setIndexReadyStatus(stats);
			new Notice(`Block index rebuilt: ${stats.fileCount} files, ${stats.blockCount} blocks, ${stats.referenceCount} references.`);
		} catch (error) {
			this.setIndexStatusMessage('Block index: rebuild failed');
			console.error('Failed to rebuild block index:', error);
			new Notice('Failed to rebuild block index.');
		}
	}

	private updateIndexProgress(progress: IndexProgress) {
		const phaseLabel = progress.phase === 'rebuild'
			? 'building'
			: progress.phase === 'reconcile'
				? 'reconciling'
				: 'loading cache';

		if (progress.totalFiles <= 0) {
			this.setIndexStatusMessage(`Block index: ${phaseLabel}...`);
			return;
		}

		this.setIndexStatusMessage(
			`Block index: ${phaseLabel} ${progress.processedFiles}/${progress.totalFiles} files | ${progress.blockCount} blocks | ${progress.referenceCount} refs`
		);
	}

	private handleIndexStatus(status: IndexStatus) {
		if (status.stats) {
			this.lastKnownIndexStats = status.stats;
		}

		switch (status.state) {
			case 'loading-cache':
				this.setIndexStatusMessage('Block index: loading cache...');
				return;
			case 'cache-missing':
				this.startupFullRebuildPending = true;
				this.setIndexStatusMessage('Block index: no cache found, building full index...');
				new Notice('No cached block index found. Building a new index...');
				return;
			case 'cache-loaded':
				this.setIndexStatusMessage(
					this.buildStatusText('Block index: cache loaded, checking vault changes...', status.stats)
				);
				return;
			case 'reconcile-start':
				if ((status.totalWork ?? 0) > 0) {
					this.setIndexStatusMessage(
						`Block index: reconciling 0/${status.totalWork} files | ${status.changedFiles ?? 0} changed | ${status.removedFiles ?? 0} removed`
					);
					return;
				}

				this.setIndexStatusMessage('Block index: checking vault changes...');
				return;
			case 'ready':
				this.setIndexReadyStatus(status.stats ?? this.lastKnownIndexStats);
				if (this.startupFullRebuildPending && status.source === 'rebuild' && status.stats) {
					new Notice(`Initial block index build complete: ${status.stats.fileCount} files, ${status.stats.blockCount} blocks, ${status.stats.referenceCount} references.`);
				}
				this.startupFullRebuildPending = false;
				return;
		}
	}

	private setIndexReadyStatus(stats?: IndexBuildStats | null) {
		this.lastKnownIndexStats = stats ?? this.lastKnownIndexStats;
		this.setIndexStatusMessage(this.buildStatusText('Block index: ready', this.lastKnownIndexStats));
	}

	private buildStatusText(prefix: string, stats?: IndexBuildStats | null): string {
		if (!stats) {
			return prefix;
		}

		return `${prefix} | ${stats.fileCount} files | ${stats.blockCount} blocks | ${stats.referenceCount} refs`;
	}

	private setIndexStatusMessage(message: string) {
		if (!this.statusBarEl) {
			return;
		}

		this.statusBarEl.setText(message);
	}

	private getListItemsForSection(cache: CachedMetadata | null, lineStart: number, lineEnd: number): ListItemCache[] {
		return (cache?.listItems ?? [])
			.filter((item) => item.position.start.line >= lineStart && item.position.start.line <= lineEnd)
			.sort((left, right) => {
				return left.position.start.line - right.position.start.line
					|| left.position.start.col - right.position.start.col;
			});
	}

	private attachReadingModeSourceBadge(listItem: HTMLLIElement, block: BlockCache, count: number) {
		const blockId = block.id;
		const existing = listItem.querySelector(`.block-reference-source-badge[data-block-ref-source-id="${CSS.escape(blockId)}"]`);
		if (isHtmlElement(existing)) {
			existing.dataset.blockRefSourceCount = String(count);
			existing.dataset.blockRefSourceFilePath = block.filePath;
			existing.dataset.blockRefSourceStartLine = String(block.startLine);
			existing.setAttribute('aria-label', `Referenced ${count} times`);
			existing.setAttribute('title', `${count} references`);
			existing.setText(String(count));
			return;
		}

		const anchor = listItem.ownerDocument.createElement('span');
		anchor.className = 'block-reference-source-badge-anchor';
		anchor.appendChild(createSourceReferenceBadgeElement(blockId, count, block.filePath, block.startLine, listItem));

		const contentHost = this.getReadingModeBadgeContentHost(listItem);
		if (contentHost) {
			contentHost.appendChild(anchor);
			return;
		}

		const firstNestedList = Array.from(listItem.children).find((child) => child.tagName === 'UL' || child.tagName === 'OL');
		if (firstNestedList) {
			listItem.insertBefore(anchor, firstNestedList);
			return;
		}

		listItem.appendChild(anchor);
	}

	private getReadingModeBadgeContentHost(listItem: HTMLLIElement): HTMLElement | null {
		for (const child of Array.from(listItem.children)) {
			if (child.matches('ul, ol, .block-reference-source-badge-anchor')) {
				continue;
			}

			return child as HTMLElement;
		}

		return null;
	}

	private refreshOpenMarkdownViews() {
		this.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) {
				return;
			}

			if (view.getMode() === 'preview') {
				view.previewMode.rerender(true);
			}
		});
	}
}
