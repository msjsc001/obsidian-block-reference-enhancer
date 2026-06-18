import { App, Modal, Setting } from 'obsidian';
import type BlockReferenceEnhancer from '../main';

export class StaleBlockReviewModal extends Modal {
    private readonly ignoredIds = new Set<string>();

    constructor(app: App, private readonly plugin: BlockReferenceEnhancer) {
        super(app);
    }

    onOpen() {
        this.setTitle('Review missing source blocks');
        this.render();
    }

    onClose() {
        this.contentEl.empty();
    }

    private render() {
        this.contentEl.empty();

        const staleBlocks = this.plugin.indexService
            .getStaleBlocks()
            .filter((record) => !this.ignoredIds.has(record.id));

        if (staleBlocks.length === 0) {
            this.contentEl.createEl('p', {
                text: 'No missing source blocks need review right now.',
            });
            return;
        }

        this.contentEl.createEl('p', {
            text: `${staleBlocks.length} missing source blocks still have active references.`,
        });

        for (const staleBlock of staleBlocks) {
            const summary = staleBlock.block.rawContent.split(/\r?\n/, 1)[0] || '[empty block]';
            const container = this.contentEl.createDiv({ cls: 'block-reference-stale-review-item' });
            container.createEl('div', {
                text: summary,
                cls: 'block-reference-stale-review-summary',
            });
            container.createEl('div', {
                text: `${staleBlock.id}`,
                cls: 'block-reference-stale-review-meta',
            });
            container.createEl('div', {
                text: `${staleBlock.block.filePath} | ${staleBlock.references.length} references`,
                cls: 'block-reference-stale-review-meta',
            });

            const actionSetting = new Setting(container);
            actionSetting
                .addButton((button) => {
                    button
                        .setButtonText('Restore recovery page')
                        .setCta()
                        .onClick(async () => {
                            this.setBusy(container, true);
                            await this.plugin.recoverBlockToRecoveryPage(staleBlock.id);
                            this.render();
                        });
                })
                .addButton((button) => {
                    button
                        .setWarning()
                        .setButtonText('Confirm deletion')
                        .onClick(async () => {
                            const confirmed = window.confirm('Confirm deletion for this missing source block? References will fall back to Missing block.');
                            if (!confirmed) {
                                return;
                            }

                            this.setBusy(container, true);
                            await this.plugin.confirmBlockDeletion(staleBlock.id);
                            this.render();
                        });
                })
                .addButton((button) => {
                    button
                        .setButtonText('Ignore for now')
                        .onClick(() => {
                            this.ignoredIds.add(staleBlock.id);
                            this.render();
                        });
                });
        }
    }

    private setBusy(container: HTMLElement, busy: boolean) {
        container.toggleClass('is-busy', busy);
    }
}
