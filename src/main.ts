import { App, Component, Editor, MarkdownPostProcessorContext, MarkdownRenderChild, MarkdownRenderer, MarkdownView, Notice, Plugin, TFile } from 'obsidian';
import { IndexService } from './services/IndexService';
import { BlockSuggest } from './editor/BlockSuggest';
import { blockReferenceField } from './editor/BlockReferenceField';
import { createAsyncBlockRendererPlugin } from './editor/AsyncBlockRendererPlugin';

interface LogseqBlockRefEnhancerSettings {
	// 未来可能会在这里添加设置
}

const DEFAULT_SETTINGS: LogseqBlockRefEnhancerSettings = {
	// 默认值
};

const MAX_INLINE_SUMMARY_LENGTH = 60;
const STANDALONE_EMBED_REGEX = /^\s*\{\{embed\s+\(\(([A-Za-z0-9_-]{36,})\)\)\s*\}\}\s*$/;
const MANUAL_RENDER_SCOPE_ATTR = 'data-logseq-manual-render';
const MANAGED_NODE_ATTR = 'data-logseq-managed-node';
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

function createBlockReferenceRegex() {
	return /\{\{embed\s+\(\(([A-Za-z0-9_-]{36,})\)\)\s*\}\}|\(\(([A-Za-z0-9_-]{36,})\)\)|（（([A-Za-z0-9_-]{36,})））/g;
}

class ReferencePostProcessChild extends MarkdownRenderChild {
	private readingModeQueueRoot: HTMLElement | null = null;

	constructor(
		containerEl: HTMLElement,
		private readonly plugin: LogseqBlockRefEnhancer,
		private readonly sourcePath: string
	) {
		super(containerEl);
	}

	async onload() {
		this.readingModeQueueRoot = this.plugin.attachReadingModeRenderQueue(this.containerEl);
		await this.plugin.processRenderedReferences(this.containerEl, this.sourcePath, this, new Set<string>());
	}

	onunload() {
		this.plugin.detachReadingModeRenderQueue(this.readingModeQueueRoot);
	}
}

export default class LogseqBlockRefEnhancer extends Plugin {
	settings: LogseqBlockRefEnhancerSettings;
	indexService: IndexService;
	private readonly readingModeRenderQueues = new Map<HTMLElement, ReadingModeRenderQueue>();

	async onload() {
		await this.loadSettings();

		this.indexService = new IndexService(this.app, this.manifest.dir!);

		this.addCommand({
			id: 'rebuild-logseq-block-index',
			name: 'Rebuild block reference index',
			callback: () => {
				this.indexService.buildIndex();
			},
		});

		this.addCommand({
			id: 'copy-logseq-block-reference',
			name: 'Copy current block\'s Logseq reference',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.handleCopyBlockReference(editor, view);
			},
		});

		this.app.workspace.onLayoutReady(async () => {
			await this.indexService.initialize();

			this.registerMarkdownPostProcessor(this.readingModeRenderer.bind(this));

			const asyncPlugin = createAsyncBlockRendererPlugin(this);
			this.registerEditorExtension([blockReferenceField, asyncPlugin]);

			this.registerEditorSuggest(new BlockSuggest(this.app, this.indexService));

			this.setupFileEvents();
		});
	}

	setupFileEvents() {
		this.registerEvent(this.app.vault.on('create', (file) => {
			if (file instanceof TFile && file.extension === 'md') {
				this.indexService.processFileChange(file);
			}
		}));

		this.registerEvent(this.app.vault.on('modify', (file) => {
			if (file instanceof TFile && file.extension === 'md') {
				this.indexService.processFileChange(file);
			}
		}));

		this.registerEvent(this.app.vault.on('delete', (file) => {
			if (file instanceof TFile && file.extension === 'md') {
				this.indexService.processFileDelete(file.path);
			}
		}));

		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			if (file instanceof TFile && file.extension === 'md') {
				this.indexService.processFileRename(oldPath, file.path);
			}
		}));
	}

	onunload() {
		console.log('Unloading Logseq Block Ref Enhancer plugin.');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async handleCopyBlockReference(editor: Editor, view: MarkdownView) {
		const file = view.file;
		if (!file) return;

		const cursor = editor.getCursor();
		const line = cursor.line;
		const lineContent = editor.getLine(line);

		const blockMatch = lineContent.match(/^\s*-\s(.+)/);
		if (!blockMatch) {
			new Notice('This line is not a valid Logseq block.');
			return;
		}

		let existingBlock = this.indexService.findBlockByFileAndLine(file.path, line);
		let blockId: string;

		if (existingBlock) {
			blockId = existingBlock.id;
		} else {
			blockId = crypto.randomUUID();
			const indentationMatch = lineContent.match(/^(\s*)/);
			const indentation = indentationMatch ? indentationMatch[1] : '';
			const idLine = `\n${indentation}  id:: ${blockId}`;

			editor.replaceRange(idLine, { line: line, ch: lineContent.length });

			this.indexService.addBlock(blockId, {
				filePath: file.path,
				rawContent: blockMatch[1],
				childrenMarkdown: '',
				startLine: line,
				childrenIDs: [],
			});
		}

		navigator.clipboard.writeText(`((${blockId}))`);
		new Notice('Block reference copied to clipboard!');
	}

	getInlineReferenceText(uuid: string): string | null {
		return this.getInlineReferenceTextInternal(uuid, new Set<string>());
	}

	private getInlineReferenceTextInternal(uuid: string, visited: Set<string>): string | null {
		if (visited.has(uuid)) {
			return '[cyclic block]';
		}

		const block = this.indexService.getBlock(uuid);
		if (!block) {
			return null;
		}

		const nextVisited = new Set(visited);
		nextVisited.add(uuid);

		const firstLine = block.rawContent.split(/\r?\n/, 1)[0] ?? '';
		const expandedLine = firstLine.replace(/(?:\(\(|\uFF08\uFF08)([A-Za-z0-9_-]{36,})(?:\)\)|\uFF09\uFF09)/g, (_match, nestedUuid: string) => {
			return this.getInlineReferenceTextInternal(nestedUuid, nextVisited) ?? '[missing block]';
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
		return summary.length > MAX_INLINE_SUMMARY_LENGTH
			? `${summary.slice(0, MAX_INLINE_SUMMARY_LENGTH).trimEnd()}…`
			: summary;
	}

	async buildEmbedHtml(uuid: string, sourcePath: string, component: Component): Promise<string> {
		const host = document.createElement('div');
		await this.populateEmbedContainer(host, uuid, sourcePath, component, new Set<string>());
		return host.innerHTML;
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
		if (previewRoot instanceof HTMLElement) {
			return previewRoot;
		}

		const renderedRoot = element.closest('.markdown-rendered');
		return renderedRoot instanceof HTMLElement ? renderedRoot : null;
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

			const hitElement = document.elementFromPoint(x, y);
			if (!(hitElement instanceof HTMLElement)) {
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
		const walker = document.createTreeWalker(previewRoot, NodeFilter.SHOW_ELEMENT);

		while (walker.nextNode()) {
			const candidate = walker.currentNode;
			if (!(candidate instanceof HTMLElement)) {
				continue;
			}

			if (candidate === excludedHost || excludedHost.contains(candidate)) {
				continue;
			}

			const managedAncestor = candidate.closest(`[${MANAGED_NODE_ATTR}="true"]`);
			if (managedAncestor instanceof HTMLElement) {
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
				const managedAncestor: Element | null = current.closest(`[${MANAGED_NODE_ATTR}="true"]`);
				if (managedAncestor instanceof HTMLElement && managedAncestor !== excludedHost) {
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
		return fallback instanceof HTMLElement ? fallback : null;
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

	private createInlineReferenceElement(summary: string): HTMLSpanElement {
		const inlineRef = document.createElement('span');
		inlineRef.addClass('logseq-inline-block-ref');
		inlineRef.setAttribute(MANAGED_NODE_ATTR, 'true');
		inlineRef.setText(summary);
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
		container.removeClass('logseq-block-ref-enhancer-error');
		container.addClass('logseq-block-embed', 'is-loading');
		container.setAttribute(MANAGED_NODE_ATTR, 'true');
		this.markManualRenderScope(container);

		const placeholderHeight = this.estimateEmbedPlaceholderHeight(uuid);
		if (placeholderHeight !== null) {
			container.style.setProperty('--logseq-embed-placeholder-height', `${placeholderHeight}px`);
		} else {
			container.style.removeProperty('--logseq-embed-placeholder-height');
		}

		const placeholder = document.createElement('div');
		placeholder.addClass('logseq-block-embed-placeholder');
		container.appendChild(placeholder);
	}

	private finalizeEmbedContainer(container: HTMLElement, contentNodes: Node[]) {
		container.replaceChildren(...contentNodes);
		container.removeClass('is-loading');
		container.style.removeProperty('--logseq-embed-placeholder-height');
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
			container.addClass('logseq-block-ref-enhancer-error');
			container.setText('Cyclic embed');
			return;
		}

		const block = this.indexService.getBlock(uuid);
		if (!block) {
			container.empty();
			container.removeClass('is-loading');
			container.addClass('logseq-block-ref-enhancer-error');
			container.setText('Missing block');
			return;
		}

		const nextVisitedEmbeds = new Set(visitedEmbeds);
		nextVisitedEmbeds.add(uuid);

		const rootContainer = document.createElement('div');
		rootContainer.addClass('logseq-block-embed-root');
		await this.renderMarkdownAndProcess(rootContainer, block.rawContent, sourcePath, component, nextVisitedEmbeds);

		const contentNodes: Node[] = [rootContainer];

		const childMarkdown = block.childrenMarkdown?.trim();
		if (childMarkdown) {
			const childrenContainer = document.createElement('div');
			childrenContainer.addClass('logseq-block-embed-children');
			await this.renderMarkdownAndProcess(childrenContainer, childMarkdown, sourcePath, component, nextVisitedEmbeds);
			contentNodes.push(childrenContainer);
		}

		this.finalizeEmbedContainer(container, contentNodes);
	}

	async processRenderedReferences(
		element: HTMLElement,
		sourcePath: string,
		component: Component,
		visitedEmbeds: Set<string>
	) {
		const previewRoot = element.isConnected ? this.resolveReadingModePreviewRoot(element) : null;
		const probeRegex = createBlockReferenceRegex();
		const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
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
				const embedHost = document.createElement('div');
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
			const fragment = document.createDocumentFragment();
			const replaceRegex = createBlockReferenceRegex();

			while ((match = replaceRegex.exec(text))) {
				const embedUuid = match[1];
				const inlineUuid = match[2] ?? match[3];
				const placeholder = match[0];
				const start = match.index;

				fragment.appendChild(document.createTextNode(text.slice(lastIndex, start)));

				if (embedUuid) {
					fragment.appendChild(document.createTextNode(placeholder));
				} else {
					const summary = this.getInlineReferenceText(inlineUuid) ?? '[missing block]';
					fragment.appendChild(this.createInlineReferenceElement(summary));
					replacedInline = true;
				}

				lastIndex = start + placeholder.length;
			}

			if (!replacedInline) {
				continue;
			}

			fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
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

		context.addChild(new ReferencePostProcessChild(element, this, context.sourcePath));
	}
}
