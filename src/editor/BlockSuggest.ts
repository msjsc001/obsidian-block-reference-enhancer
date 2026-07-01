import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, Notice, TFile } from 'obsidian';
import { IndexService } from '../services/IndexService';
import { BlockCache } from '../types';
import { matchesBlockSuggestContext, resolveBlockSuggestEditEndCh } from './BlockSuggestRange';

interface SuggestionItem {
    id: string;
    block: BlockCache;
}

export class BlockSuggest extends EditorSuggest<SuggestionItem> {
    private indexService: IndexService;
    private readonly openBlock: (block: BlockCache) => Promise<void>;

    constructor(app: App, indexService: IndexService, openBlock: (block: BlockCache) => Promise<void>) {
        super(app);
        this.indexService = indexService;
        this.openBlock = openBlock;
    }

    onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
        const line = editor.getLine(cursor.line);
        const subline = line.substring(0, cursor.ch);
        const match = subline.match(/\(\(([^)]*)$/);

        if (match) {
            return {
                start: { line: cursor.line, ch: match.index! },
                end: cursor,
                query: match[1],
            };
        }
        return null;
    }

    getSuggestions(context: EditorSuggestContext): SuggestionItem[] | Promise<SuggestionItem[]> {
        return this.indexService.searchBlocks(context.query);
    }

    renderSuggestion(item: SuggestionItem, el: HTMLElement): void {
        const row = el.createDiv({ cls: 'block-reference-suggest-row' });
        const content = row.createDiv({ cls: 'block-reference-suggest-content' });
        content.createDiv({
            text: item.block.rawContent.substring(0, 100),
            cls: 'block-reference-suggest-title',
        });
        content.createEl('small', {
            text: item.block.filePath,
            cls: 'block-reference-suggest-filepath',
        });

        const goToButton = row.createEl('button', {
            text: 'Go to',
            cls: 'block-reference-suggest-go-to',
            attr: {
                type: 'button',
                'aria-label': 'Go to source block',
            },
        });
        goToButton.addEventListener('mousedown', (event) => {
            if (event.button !== 0) {
                return;
            }

            event.preventDefault();
            event.stopImmediatePropagation();
        });
        goToButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopImmediatePropagation();
            void this.goToSuggestion(item);
        });
    }

    selectSuggestion(item: SuggestionItem, evt: MouseEvent | KeyboardEvent): void {
        const editRange = this.resolveCurrentEditRange();
        if (!editRange) {
            return;
        }

        const replacement = `((${item.id}))`;
        editRange.context.editor.replaceRange(replacement, editRange.context.start, editRange.end);
        this.close();
    }

    private resolveCurrentEditRange(): { context: EditorSuggestContext; end: EditorPosition } | null {
        const context = this.context;
        if (!context || context.start.line !== context.end.line) {
            return null;
        }

        const lineText = context.editor.getLine(context.end.line);
        if (!matchesBlockSuggestContext(lineText, context.start.ch, context.end.ch, context.query)) {
            return null;
        }

        return {
            context,
            end: {
                line: context.end.line,
                ch: resolveBlockSuggestEditEndCh(lineText, context.end.ch),
            },
        };
    }

    private async goToSuggestion(item: SuggestionItem): Promise<void> {
        const editRange = this.resolveCurrentEditRange();
        if (!editRange) {
            return;
        }

        const block = this.indexService.getBlock(item.id);
        if (!block || block.status !== 'active') {
            new Notice('Source block is no longer available.');
            return;
        }

        const file = this.app.vault.getAbstractFileByPath(block.filePath);
        if (!(file instanceof TFile)) {
            new Notice('Unable to open the source block file.');
            return;
        }

        editRange.context.editor.replaceRange('', editRange.context.start, editRange.end);
        this.close();

        try {
            await this.openBlock(block);
        } catch (error) {
            console.error('Unable to open block suggestion target:', error);
            new Notice('Unable to open the source block.');
        }
    }
}
