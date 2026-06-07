import { App, TFile, TAbstractFile } from 'obsidian';
import { BlockIndex, BlockCache } from '../types';
import { BlockParser } from './BlockParser';
import { debounce } from 'obsidian';

/**
 * Manages the block index for the entire vault.
 */
export class IndexService {
    private app: App;
    private blockParser: BlockParser;
    private index: BlockIndex;
    private CACHE_FILE_PATH: string;
    private debouncedSave: () => void;

    constructor(app: App, pluginDataPath: string) {
        this.app = app;
        this.blockParser = new BlockParser();
        this.index = new Map();
        this.CACHE_FILE_PATH = `${pluginDataPath}/block-cache.json`;

        this.debouncedSave = debounce(() => this.saveIndexToCache(), 1000, true);
    }

    /**
     * Builds the index for the entire vault.
     */
    public async initialize() {
        const loaded = await this.loadIndexFromCache();
        if (!loaded) {
            await this.buildIndex();
        }
    }

    private async saveIndexToCache() {
        try {
            const data = JSON.stringify(Array.from(this.index.entries()));
            await this.app.vault.adapter.write(this.CACHE_FILE_PATH, data);
            // console.log(`Index saved to cache. Total blocks: ${this.index.size}`);
        } catch (error) {
            console.error("Error saving index to cache:", error);
        }
        console.log(`%c[IndexService] INITIALIZED. Index size: ${this.index.size}`, 'background: #222; color: #bada55');
    }

    private async loadIndexFromCache(): Promise<boolean> {
        try {
            if (!await this.app.vault.adapter.exists(this.CACHE_FILE_PATH)) {
                 // console.log("Cache file not found. A full index is required.");
                return false;
            }
            const data = await this.app.vault.adapter.read(this.CACHE_FILE_PATH);
            const entries = JSON.parse(data) as [string, BlockCache][];
            if (entries.some(([, block]) => typeof block.childrenMarkdown !== 'string')) {
                return false;
            }
            this.index = new Map(entries);
            // console.log(`Index loaded from cache. Total blocks: ${this.index.size}`);
            return true;
        } catch (error) {
            console.error("Error loading index from cache:", error);
            return false;
        }
    }

    public async buildIndex() {
        // console.log("Building block index from scratch...");
        this.index.clear();

        const markdownFiles = this.app.vault.getMarkdownFiles();
        let processedCount = 0;

        for (const file of markdownFiles) {
            const content = await this.app.vault.cachedRead(file);
            const fileBlocks = this.blockParser.parse(file.path, content);
            fileBlocks.forEach((block, id) => {
                this.index.set(id, block);
            });

            processedCount++;
            if (processedCount % 100 === 0) {
                // Yield to the main thread to prevent UI freezing
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        // console.log(`Index built. Found ${this.index.size} blocks.`);
        await this.saveIndexToCache();
    }

    public async processFileChange(file: TFile) {
        // console.log(`Processing file change: ${file.path}`);
        this.removeFileFromIndex(file.path);

        const content = await this.app.vault.cachedRead(file);
        const fileBlocks = this.blockParser.parse(file.path, content);
        fileBlocks.forEach((block, id) => {
            this.index.set(id, block);
        });
        
        this.debouncedSave();
    }

    public processFileDelete(filePath: string) {
        // console.log(`Processing file deletion: ${filePath}`);
        this.removeFileFromIndex(filePath);
        this.debouncedSave();
    }

    public processFileRename(oldPath: string, newPath: string) {
        // console.log(`Processing file rename: from ${oldPath} to ${newPath}`);
        for (const block of this.index.values()) {
            if (block.filePath === oldPath) {
                block.filePath = newPath;
            }
        }
        this.debouncedSave();
    }
    
    public getBlock(id: string): BlockCache | undefined {
        console.log(`[IndexService] GET_BLOCK called for ID: ${id}. Current index size: ${this.index.size}`);
        return this.index.get(id);
    }

    public searchBlocks(query: string): { id: string, block: BlockCache }[] {
        if (!query) return [];
        
        const lowerCaseQuery = query.toLowerCase();
        const results: { id: string, block: BlockCache }[] = [];

        for (const [id, block] of this.index.entries()) {
            if (block.rawContent.toLowerCase().includes(lowerCaseQuery)) {
                results.push({ id, block });
            }
        }
        
        return results.slice(0, 50); // Limit results for performance
    }
    
    public findBlockByFileAndLine(filePath: string, line: number): { id: string, block: BlockCache } | null {
        for (const [id, block] of this.index.entries()) {
            if (block.filePath === filePath && block.startLine === line) {
                return { id, block };
            }
        }
        return null;
    }

    public addBlock(id: string, block: BlockCache) {
        this.index.set(id, block);
        this.debouncedSave();
    }
    
    private removeFileFromIndex(filePath: string) {
        const idsToRemove: string[] = [];
        for (const [id, block] of this.index.entries()) {
            if (block.filePath === filePath) {
                idsToRemove.push(id);
            }
        }
        idsToRemove.forEach(id => this.index.delete(id));
        // console.log(`Removed ${idsToRemove.length} blocks from index for file: ${filePath}`);
    }
}
