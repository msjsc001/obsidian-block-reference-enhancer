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

function createBlockReferenceRegex() {
	return /\{\{embed\s+\(\(([A-Za-z0-9_-]{36,})\)\)\s*\}\}|\(\(([A-Za-z0-9_-]{36,})\)\)|（（([A-Za-z0-9_-]{36,})））/g;
}

class ReferencePostProcessChild extends MarkdownRenderChild {
	constructor(
		containerEl: HTMLElement,
		private readonly plugin: LogseqBlockRefEnhancer,
		private readonly sourcePath: string
	) {
		super(containerEl);
	}

	async onload() {
		await this.plugin.processRenderedReferences(this.containerEl, this.sourcePath, this, new Set<string>());
	}
}

export default class LogseqBlockRefEnhancer extends Plugin {
	settings: LogseqBlockRefEnhancerSettings;
	indexService: IndexService;

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
		container.empty();
		container.addClass('logseq-block-embed');
		this.markManualRenderScope(container);

		if (visitedEmbeds.has(uuid)) {
			container.addClass('logseq-block-ref-enhancer-error');
			container.setText('Cyclic embed');
			return;
		}

		const block = this.indexService.getBlock(uuid);
		if (!block) {
			container.addClass('logseq-block-ref-enhancer-error');
			container.setText('Missing block');
			return;
		}

		const nextVisitedEmbeds = new Set(visitedEmbeds);
		nextVisitedEmbeds.add(uuid);

		const rootContainer = document.createElement('div');
		rootContainer.addClass('logseq-block-embed-root');
		container.appendChild(rootContainer);
		await this.renderMarkdownAndProcess(rootContainer, block.rawContent, sourcePath, component, nextVisitedEmbeds);

		const childMarkdown = block.childrenMarkdown?.trim();
		if (childMarkdown) {
			const childrenContainer = document.createElement('div');
			childrenContainer.addClass('logseq-block-embed-children');
			container.appendChild(childrenContainer);
			await this.renderMarkdownAndProcess(childrenContainer, childMarkdown, sourcePath, component, nextVisitedEmbeds);
		}
	}

	async processRenderedReferences(
		element: HTMLElement,
		sourcePath: string,
		component: Component,
		visitedEmbeds: Set<string>
	) {
		const probeRegex = createBlockReferenceRegex();
		const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
		const nodesToProcess: Text[] = [];

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

				await this.populateEmbedContainer(embedHost, standaloneEmbedMatch[1], sourcePath, component, visitedEmbeds);
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
	}

	async readingModeRenderer(element: HTMLElement, context: MarkdownPostProcessorContext) {
		if (element.closest(`[${MANUAL_RENDER_SCOPE_ATTR}="true"]`)) {
			return;
		}

		context.addChild(new ReferencePostProcessChild(element, this, context.sourcePath));
	}
}
