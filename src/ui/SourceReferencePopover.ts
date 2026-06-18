import { setIcon } from 'obsidian';
import type BlockReferenceEnhancer from '../main';
import { BlockCache, BlockReferenceLocation, PaginatedBlockReferences } from '../types';

const REFERENCE_PAGE_SIZE = 20;
const MAX_REFERENCE_PREVIEW_LENGTH = 140;

export class SourceReferencePopover {
    private containerEl: HTMLDivElement | null = null;
    private currentAnchorEl: HTMLElement | null = null;
    private currentBlockId: string | null = null;
    private currentBlock: BlockCache | null = null;
    private currentPage = 0;
    private renderToken = 0;
    private readonly handleDocumentPointerDown = (event: MouseEvent) => {
        if (!this.containerEl) {
            return;
        }

        const target = event.target;
        if (!(target instanceof Node)) {
            return;
        }

        if (this.containerEl.contains(target) || this.currentAnchorEl?.contains(target)) {
            return;
        }

        const containerRect = this.containerEl.getBoundingClientRect();
        if (
            event.clientX >= containerRect.left
            && event.clientX <= containerRect.right
            && event.clientY >= containerRect.top
            && event.clientY <= containerRect.bottom
        ) {
            return;
        }

        this.close();
    };
    private readonly handleWindowResize = () => {
        this.position();
    };
    private readonly handleDocumentKeydown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
            this.close();
        }
    };
    private readonly handleDocumentScroll = (event: Event) => {
        if (!this.containerEl) {
            return;
        }

        const target = event.target;
        if (target instanceof Node && this.containerEl.contains(target)) {
            return;
        }

        if (!this.currentAnchorEl?.isConnected) {
            this.close();
            return;
        }

        this.position();
    };

    constructor(private readonly plugin: BlockReferenceEnhancer) {}

    async toggle(anchorEl: HTMLElement, blockId: string, block: BlockCache) {
        if (this.currentBlockId === blockId && this.containerEl && this.currentAnchorEl === anchorEl) {
            this.close();
            return;
        }

        await this.open(anchorEl, blockId, block, 0);
    }

    async refreshIfOpen() {
        if (!this.containerEl || !this.currentAnchorEl || !this.currentBlockId || !this.currentBlock) {
            return;
        }

        if (!this.currentAnchorEl.isConnected) {
            this.close();
            return;
        }

        await this.open(this.currentAnchorEl, this.currentBlockId, this.currentBlock, this.currentPage);
    }

    close() {
        this.renderToken += 1;
        this.detachGlobalListeners();
        if (this.containerEl) {
            this.containerEl.remove();
            this.containerEl = null;
        }

        this.currentAnchorEl = null;
        this.currentBlockId = null;
        this.currentBlock = null;
        this.currentPage = 0;
    }

    destroy() {
        this.close();
    }

    private async open(anchorEl: HTMLElement, blockId: string, block: BlockCache, page: number) {
        if (!anchorEl.isConnected) {
            this.close();
            return;
        }

        this.currentAnchorEl = anchorEl;
        this.currentBlockId = blockId;
        this.currentBlock = block;
        this.currentPage = page;

        this.ensureContainer();
        this.attachGlobalListeners();
        this.position();
        this.renderLoading();

        const pageData = this.plugin.indexService.getPaginatedReferencesToBlock(blockId, page, REFERENCE_PAGE_SIZE);
        if (pageData.total === 0) {
            this.renderEmptyState();
            return;
        }

        const token = ++this.renderToken;
        const items = await Promise.all(pageData.references.map(async (reference) => ({
            reference,
            preview: await this.plugin.getReferencePreview(reference, MAX_REFERENCE_PREVIEW_LENGTH),
        })));

        if (token !== this.renderToken || !this.containerEl || this.currentBlockId !== blockId) {
            return;
        }

        this.currentPage = pageData.page;
        this.renderPage(blockId, block, pageData, items);
    }

    private ensureContainer() {
        if (this.containerEl) {
            return;
        }

        const container = document.createElement('div');
        container.className = 'block-reference-source-popover';
        document.body.appendChild(container);
        this.containerEl = container;
    }

    private attachGlobalListeners() {
        document.addEventListener('mousedown', this.handleDocumentPointerDown, true);
        document.addEventListener('keydown', this.handleDocumentKeydown);
        document.addEventListener('scroll', this.handleDocumentScroll, true);
        window.addEventListener('resize', this.handleWindowResize);
    }

    private detachGlobalListeners() {
        document.removeEventListener('mousedown', this.handleDocumentPointerDown, true);
        document.removeEventListener('keydown', this.handleDocumentKeydown);
        document.removeEventListener('scroll', this.handleDocumentScroll, true);
        window.removeEventListener('resize', this.handleWindowResize);
    }

    private position() {
        if (!this.containerEl || !this.currentAnchorEl) {
            return;
        }

        const anchorRect = this.currentAnchorEl.getBoundingClientRect();
        const popoverWidth = Math.max(280, Math.min(520, window.innerWidth - 24));
        const left = Math.min(
            Math.max(12, anchorRect.left),
            window.innerWidth - popoverWidth - 12,
        );

        this.containerEl.style.width = `${popoverWidth}px`;
        this.containerEl.style.left = `${left}px`;

        const preferredTop = anchorRect.bottom + 8;
        const measuredHeight = this.containerEl.offsetHeight || Math.min(360, window.innerHeight - 24);
        const topAbove = anchorRect.top - measuredHeight - 8;
        const fitsAbove = topAbove >= 12;
        const fitsBelow = preferredTop + measuredHeight <= window.innerHeight - 12;
        const top = fitsBelow
            ? preferredTop
            : fitsAbove
                ? topAbove
                : Math.max(12, window.innerHeight - measuredHeight - 12);

        this.containerEl.style.top = `${top}px`;
    }

    private renderLoading() {
        if (!this.containerEl) {
            return;
        }

        this.containerEl.empty();
        this.containerEl.createDiv({
            cls: 'block-reference-source-popover-loading',
            text: 'Loading references...',
        });
    }

    private renderEmptyState() {
        if (!this.containerEl) {
            return;
        }

        this.containerEl.empty();
        this.containerEl.createDiv({
            cls: 'block-reference-source-popover-loading',
            text: 'No active references.',
        });
    }

    private renderPage(
        blockId: string,
        block: BlockCache,
        pageData: PaginatedBlockReferences,
        items: Array<{ reference: BlockReferenceLocation; preview: string }>
    ) {
        if (!this.containerEl) {
            return;
        }

        this.containerEl.empty();

        const header = this.containerEl.createDiv({ cls: 'block-reference-source-popover-header' });
        const headerMain = header.createDiv({ cls: 'block-reference-source-popover-header-main' });
        const titleEl = headerMain.createDiv({
            cls: 'block-reference-source-popover-title',
            text: this.plugin.getBlockSummary(block),
        });
        titleEl.title = this.plugin.getBlockSummary(block);
        headerMain.createDiv({
            cls: 'block-reference-source-popover-count',
            text: this.getReferenceCountLabel(pageData.total),
        });

        const headerMeta = header.createDiv({ cls: 'block-reference-source-popover-header-meta' });
        const blockIdEl = headerMeta.createSpan({
            cls: 'block-reference-source-popover-block-id',
            text: this.getShortBlockId(blockId),
        });
        blockIdEl.title = blockId;

        const list = this.containerEl.createDiv({ cls: 'block-reference-source-popover-list' });
        for (const item of items) {
            const fileName = this.getFileName(item.reference.filePath);
            const row = list.createDiv({
                cls: 'block-reference-source-popover-item',
                attr: {
                    role: 'button',
                    tabindex: '0',
                },
            });
            row.title = `${item.reference.filePath}:${item.reference.line + 1}`;
            this.bindReferenceRowEvents(row, item.reference);

            const headerRow = row.createDiv({ cls: 'block-reference-source-popover-item-header' });
            headerRow.createSpan({
                cls: 'block-reference-source-popover-kind',
                text: this.getReferenceKindLabel(item.reference.kind),
            });

            const locationRow = headerRow.createDiv({ cls: 'block-reference-source-popover-item-location' });
            const fileNameEl = locationRow.createSpan({
                cls: 'block-reference-source-popover-item-file',
                text: fileName,
            });
            fileNameEl.title = item.reference.filePath;
            locationRow.createSpan({
                cls: 'block-reference-source-popover-item-line',
                text: `L${item.reference.line + 1}`,
            });

            row.createDiv({
                cls: 'block-reference-source-popover-item-preview',
                text: item.preview,
            });

            if (fileName !== item.reference.filePath) {
                const fullPathEl = row.createDiv({
                    cls: 'block-reference-source-popover-item-path',
                    text: item.reference.filePath,
                });
                fullPathEl.title = item.reference.filePath;
            }
        }

        const pageCount = Math.max(Math.ceil(pageData.total / pageData.pageSize), 1);
        if (pageCount > 1) {
            const footer = this.containerEl.createDiv({ cls: 'block-reference-source-popover-footer' });
            const previousButton = footer.createEl('button', {
                cls: 'block-reference-source-popover-nav',
                attr: {
                    type: 'button',
                    'aria-label': 'Previous page',
                    title: 'Previous page',
                },
            });
            setIcon(previousButton, 'chevron-left');
            previousButton.disabled = pageData.page <= 0;
            previousButton.addEventListener('click', () => {
                if (!this.currentAnchorEl) {
                    return;
                }

                void this.open(this.currentAnchorEl, blockId, block, pageData.page - 1);
            });

            footer.createDiv({
                cls: 'block-reference-source-popover-page',
                text: `${pageData.page + 1} / ${pageCount}`,
            });

            const nextButton = footer.createEl('button', {
                cls: 'block-reference-source-popover-nav',
                attr: {
                    type: 'button',
                    'aria-label': 'Next page',
                    title: 'Next page',
                },
            });
            setIcon(nextButton, 'chevron-right');
            nextButton.disabled = pageData.page >= pageCount - 1;
            nextButton.addEventListener('click', () => {
                if (!this.currentAnchorEl) {
                    return;
                }

                void this.open(this.currentAnchorEl, blockId, block, pageData.page + 1);
            });
        }

        this.position();
    }

    private getReferenceKindLabel(kind: BlockReferenceLocation['kind']): string {
        return kind === 'embed' ? 'EMBED' : 'REF';
    }

    private getFileName(filePath: string): string {
        const segments = filePath.split(/[\\/]/);
        return segments[segments.length - 1] || filePath;
    }

    private getShortBlockId(blockId: string): string {
        if (blockId.length <= 18) {
            return blockId;
        }

        return `${blockId.slice(0, 8)}...${blockId.slice(-6)}`;
    }

    private getReferenceCountLabel(total: number): string {
        return total === 1 ? '1 ref' : `${total} refs`;
    }

    private bindReferenceRowEvents(row: HTMLDivElement, reference: BlockReferenceLocation) {
        const activate = () => {
            void this.plugin.openReferenceLocation(reference);
            this.close();
        };

        row.addEventListener('click', activate);
        row.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') {
                return;
            }

            event.preventDefault();
            activate();
        });
    }
}
