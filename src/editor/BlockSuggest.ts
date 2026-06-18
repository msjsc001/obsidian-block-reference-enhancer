import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, TFile } from 'obsidian';
import { IndexService } from '../services/IndexService';
import { BlockCache } from '../types';

interface SuggestionItem {
    id: string;
    block: BlockCache;
}

export class BlockSuggest extends EditorSuggest<SuggestionItem> {
    private indexService: IndexService;

    constructor(app: App, indexService: IndexService) {
        super(app);
        this.indexService = indexService;
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
        el.createEl('div', { text: item.block.rawContent.substring(0, 100) });
        el.createEl('small', { text: item.block.filePath, cls: 'block-reference-suggest-filepath' });
    }

    selectSuggestion(item: SuggestionItem, evt: MouseEvent | KeyboardEvent): void {
        if (!this.context) return;
        
        const replacement = `((${item.id}))`;
        this.context.editor.replaceRange(replacement, this.context.start, this.context.end);
    }
}