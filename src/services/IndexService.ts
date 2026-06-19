import { App, Events, TFile, debounce, normalizePath } from 'obsidian';
import {
    BlockCache,
    BlockReferenceLocation,
    FileIndexMeta,
    IndexBuildStats,
    IndexProgress,
    IndexStatus,
    LegacyPersistedBlockCacheEntry,
    PaginatedBlockReferences,
    ParsedMarkdownFile,
    PersistedIndexCacheV3,
    SourceBlockRecord,
    StaleBlockRecord,
} from '../types';
import { BlockParser } from './BlockParser';

const CACHE_SCHEMA_VERSION = 3;
const RECOVERY_PAGE_PATH = 'pages/Block Recovery.md';

interface BuildOptions {
    phase: IndexProgress['phase'];
    onProgress?: (progress: IndexProgress) => void;
}

interface InitializeCallbacks {
    onProgress?: (progress: IndexProgress) => void;
    onStatus?: (status: IndexStatus) => void;
}

interface IndexCacheStore {
    load: () => Promise<PersistedIndexCacheV3 | LegacyPersistedBlockCacheEntry[] | null>;
    save: (cache: PersistedIndexCacheV3) => Promise<void>;
}

interface ReconcileResult {
    didChange: boolean;
    changedFiles: number;
    removedFiles: number;
    totalWork: number;
}

/**
 * Manages the block index for the entire vault.
 */
export class IndexService extends Events {
    private readonly app: App;
    private readonly blockParser: BlockParser;
    private readonly cacheStore: IndexCacheStore;
    private readonly debouncedSave: () => void;
    private readonly recoverPagePath = normalizePath(RECOVERY_PAGE_PATH);

    private blocksById = new Map<string, BlockCache>();
    private refsById = new Map<string, BlockReferenceLocation[]>();
    private fileMetaByPath = new Map<string, FileIndexMeta>();
    private sourceBlocksByFile = new Map<string, BlockCache[]>();
    private activeSourceBlocksById = new Map<string, BlockCache[]>();
    private indexRevision = 0;
    private operationQueue: Promise<unknown> = Promise.resolve();

    constructor(app: App, cacheStore: IndexCacheStore) {
        super();
        this.app = app;
        this.blockParser = new BlockParser();
        this.cacheStore = cacheStore;
        this.debouncedSave = debounce(() => this.saveIndexToCache(), 1000, true);
    }

    public async initialize(callbacks: InitializeCallbacks = {}) {
        this.emitStatus({ state: 'loading-cache' }, callbacks.onStatus);
        const loaded = await this.loadIndexFromCache();
        if (!loaded) {
            this.emitStatus({ state: 'cache-missing' }, callbacks.onStatus);
            const stats = await this.rebuildIndex({
                phase: 'rebuild',
                onProgress: callbacks.onProgress,
            });
            this.emitStatus({ state: 'ready', source: 'rebuild', stats }, callbacks.onStatus);
            return;
        }

        this.emitStatus({
            state: 'cache-loaded',
            stats: this.getStats(),
        }, callbacks.onStatus);

        void this.queueOperation(async () => {
            const result = await this.reconcileVaultInternal(callbacks);
            this.emitStatus({
                state: 'ready',
                source: result.didChange ? 'reconcile' : 'cache',
                stats: this.getStats(),
            }, callbacks.onStatus);
        }).catch((error) => {
            console.error('Error reconciling block index:', error);
        });
    }

    public async rebuildIndex(options: Partial<BuildOptions> = {}) {
        return this.queueOperation(() => this.rebuildIndexInternal({
            phase: options.phase ?? 'rebuild',
            onProgress: options.onProgress,
        }));
    }

    public async processFileChange(file: TFile) {
        await this.queueOperation(async () => {
            await this.processFileChangeInternal(file, true);
        });
    }

    public async processFileDelete(filePath: string) {
        await this.queueOperation(async () => {
            const didChange = this.removeFileFromIndexInternal(filePath);
            if (!didChange) {
                return;
            }

            this.scheduleSave();
            this.notifyIndexUpdated();
        });
    }

    public async processFileRename(oldPath: string, newPath: string) {
        await this.queueOperation(async () => {
            const normalizedNewPath = normalizePath(newPath);
            const fileMeta = this.fileMetaByPath.get(oldPath);
            const sourceBlocks = this.sourceBlocksByFile.get(oldPath) ?? [];
            let didChange = false;

            if (fileMeta) {
                this.fileMetaByPath.delete(oldPath);
                this.fileMetaByPath.set(normalizedNewPath, {
                    ...fileMeta,
                    path: normalizedNewPath,
                });
                didChange = true;
            }

            if (sourceBlocks.length > 0) {
                this.sourceBlocksByFile.delete(oldPath);
                const renamedBlocks = sourceBlocks.map((block) => ({
                    ...block,
                    filePath: normalizedNewPath,
                }));
                this.sourceBlocksByFile.set(normalizedNewPath, renamedBlocks);
                this.rebuildActiveSourceBlocksById();
                didChange = true;
            }

            for (const block of this.blocksById.values()) {
                if (block.filePath === oldPath) {
                    block.filePath = normalizedNewPath;
                    didChange = true;
                }
            }

            for (const references of this.refsById.values()) {
                for (const reference of references) {
                    if (reference.filePath === oldPath) {
                        reference.filePath = normalizedNewPath;
                        didChange = true;
                    }
                }
            }

            if (!didChange) {
                return;
            }

            for (const block of sourceBlocks) {
                this.refreshCanonicalBlock(block.id);
            }

            this.scheduleSave();
            this.notifyIndexUpdated();
        });
    }

    public getBlock(id: string): BlockCache | undefined {
        const block = this.blocksById.get(id);
        if (!block || block.status === 'confirmed_deleted') {
            return undefined;
        }

        return block;
    }

    public getBlockRecord(id: string): BlockCache | undefined {
        return this.blocksById.get(id);
    }

    public getBlockStatus(id: string): BlockCache['status'] | null {
        return this.blocksById.get(id)?.status ?? null;
    }

    public getReferencesToBlock(id: string): BlockReferenceLocation[] {
        return [...(this.refsById.get(id) ?? [])];
    }

    public getReferenceCount(id: string): number {
        return this.refsById.get(id)?.length ?? 0;
    }

    public getBlocksForFile(filePath: string): SourceBlockRecord[] {
        const blocks = this.sourceBlocksByFile.get(filePath) ?? [];
        return blocks
            .map((block) => ({ id: block.id, block }))
            .sort((left, right) => left.block.startLine - right.block.startLine || left.id.localeCompare(right.id));
    }

    public getActiveSourceBlocks(id: string): SourceBlockRecord[] {
        const blocks = this.activeSourceBlocksById.get(id) ?? [];
        return blocks
            .map((block) => ({ id: block.id, block }))
            .sort((left, right) => {
                return left.block.filePath.localeCompare(right.block.filePath)
                    || left.block.startLine - right.block.startLine;
            });
    }

    public getPaginatedReferencesToBlock(id: string, page: number, pageSize: number): PaginatedBlockReferences {
        const normalizedPageSize = Math.max(1, pageSize);
        const references = this.getReferencesToBlock(id);
        const total = references.length;
        const maxPage = total === 0 ? 0 : Math.max(Math.ceil(total / normalizedPageSize) - 1, 0);
        const normalizedPage = Math.max(0, Math.min(page, maxPage));
        const start = normalizedPage * normalizedPageSize;
        const end = start + normalizedPageSize;

        return {
            page: normalizedPage,
            pageSize: normalizedPageSize,
            total,
            references: references.slice(start, end),
        };
    }

    public getStaleBlocks(): StaleBlockRecord[] {
        return [...this.blocksById.entries()]
            .filter(([, block]) => block.status === 'stale')
            .map(([id, block]) => ({
                id,
                block,
                references: this.getReferencesToBlock(id),
            }))
            .filter((item) => item.references.length > 0)
            .sort((left, right) => right.references.length - left.references.length || left.block.filePath.localeCompare(right.block.filePath));
    }

    public getIndexRevision(): number {
        return this.indexRevision;
    }

    public getStats(): IndexBuildStats {
        let activeBlockCount = 0;
        let staleBlockCount = 0;

        for (const block of this.blocksById.values()) {
            if (block.status === 'active') {
                activeBlockCount++;
            } else if (block.status === 'stale') {
                staleBlockCount++;
            }
        }

        let referenceCount = 0;
        for (const references of this.refsById.values()) {
            referenceCount += references.length;
        }

        return {
            fileCount: this.fileMetaByPath.size,
            blockCount: activeBlockCount,
            referenceCount,
            staleBlockCount,
        };
    }

    public searchBlocks(query: string): { id: string, block: BlockCache }[] {
        if (!query) {
            return [];
        }

        const lowerCaseQuery = query.toLowerCase();
        const results: { id: string, block: BlockCache }[] = [];

        for (const [id, block] of this.blocksById.entries()) {
            if (block.status !== 'active') {
                continue;
            }

            if (block.rawContent.toLowerCase().includes(lowerCaseQuery)) {
                results.push({ id, block });
            }
        }

        return results.slice(0, 50);
    }

    public findBlockByFileAndLine(filePath: string, line: number): { id: string, block: BlockCache } | null {
        const blocks = this.sourceBlocksByFile.get(filePath) ?? [];
        for (const block of blocks) {
            if (block.startLine === line) {
                return { id: block.id, block };
            }
        }

        return null;
    }

    public addBlock(id: string, block: Omit<BlockCache, 'id' | 'status' | 'firstSeenAt' | 'lastSeenAt'>) {
        const now = Date.now();
        const existing = this.blocksById.get(id);

        const nextBlock: BlockCache = {
            id,
            filePath: block.filePath,
            rawContent: block.rawContent,
            childrenMarkdown: block.childrenMarkdown ?? '',
            startLine: block.startLine,
            endLine: block.endLine ?? block.startLine,
            childrenIDs: block.childrenIDs,
            status: 'active',
            firstSeenAt: existing?.firstSeenAt ?? now,
            lastSeenAt: now,
            recoveredAt: existing?.status === 'stale' ? now : existing?.recoveredAt,
        };

        this.blocksById.set(id, nextBlock);
        this.upsertSourceBlockForFile(nextBlock.filePath, nextBlock);
        this.upsertActiveSourceBlock(nextBlock);

        this.scheduleSave();
        this.notifyIndexUpdated();
    }

    public async confirmBlockDeletion(id: string) {
        await this.queueOperation(async () => {
            const block = this.blocksById.get(id);
            if (!block || block.status !== 'stale') {
                return;
            }

            block.status = 'confirmed_deleted';
            this.scheduleSave();
            this.notifyIndexUpdated();
        });
    }

    public async recoverBlockToRecoveryPage(id: string): Promise<TFile | null> {
        return this.queueOperation(async () => {
            const block = this.blocksById.get(id);
            if (!block || block.status !== 'stale') {
                return null;
            }

            await this.ensureRecoveryFolderExists();
            const existingFile = this.app.vault.getFileByPath(this.recoverPagePath);
            const recoveryMarkdown = this.buildRecoveryMarkdown(block);

            let recoveryFile: TFile;
            if (existingFile) {
                const existingContent = await this.app.vault.cachedRead(existingFile);
                if (this.containsBlockId(existingContent, id)) {
                    recoveryFile = existingFile;
                } else {
                    const prefix = existingContent.trim().length > 0 ? '\n\n' : '';
                    await this.app.vault.append(existingFile, `${prefix}${recoveryMarkdown}`);
                    recoveryFile = existingFile;
                }
            } else {
                recoveryFile = await this.app.vault.create(this.recoverPagePath, `# Block Recovery\n\n${recoveryMarkdown}`);
            }

            await this.processFileChangeInternal(recoveryFile, false);
            return recoveryFile;
        });
    }

    private async rebuildIndexInternal({ phase, onProgress }: BuildOptions): Promise<IndexBuildStats> {
        const previousBlocks = new Map(this.blocksById);
        const markdownFiles = this.app.vault.getMarkdownFiles();
        const nextRefs = new Map<string, BlockReferenceLocation[]>();
        const nextFileMeta = new Map<string, FileIndexMeta>();
        const nextSourceBlocksByFile = new Map<string, BlockCache[]>();
        const nextActiveSourceBlocksById = new Map<string, BlockCache[]>();
        let processedFiles = 0;

        this.emitProgress({
            processedFiles: 0,
            totalFiles: markdownFiles.length,
            blockCount: 0,
            referenceCount: 0,
            phase,
        }, onProgress);

        for (const file of markdownFiles) {
            const parsed = await this.parseFile(file);
            this.populateStateFromParsedFile(
                nextRefs,
                nextFileMeta,
                nextSourceBlocksByFile,
                nextActiveSourceBlocksById,
                file,
                parsed,
                previousBlocks,
            );

            processedFiles++;
            if (processedFiles % 50 === 0 || processedFiles === markdownFiles.length) {
                this.emitProgress({
                    processedFiles,
                    totalFiles: markdownFiles.length,
                    blockCount: nextActiveSourceBlocksById.size,
                    referenceCount: this.countReferenceLocations(nextRefs),
                    phase,
                }, onProgress);
                await this.yieldToMainThread();
            }
        }

        const nextBlocks = new Map<string, BlockCache>();
        for (const [id, activeSourceBlocks] of nextActiveSourceBlocksById.entries()) {
            nextBlocks.set(id, this.buildCanonicalActiveBlock(id, activeSourceBlocks, previousBlocks.get(id)));
        }

        for (const [id, previousBlock] of previousBlocks.entries()) {
            if (nextBlocks.has(id)) {
                continue;
            }

            if (previousBlock.status === 'confirmed_deleted') {
                nextBlocks.set(id, previousBlock);
                continue;
            }

            const references = nextRefs.get(id);
            if (references && references.length > 0) {
                nextBlocks.set(id, {
                    ...previousBlock,
                    status: 'stale',
                    lostAt: previousBlock.lostAt ?? Date.now(),
                });
            }
        }

        this.blocksById = nextBlocks;
        this.refsById = nextRefs;
        this.fileMetaByPath = nextFileMeta;
        this.sourceBlocksByFile = nextSourceBlocksByFile;
        this.activeSourceBlocksById = nextActiveSourceBlocksById;
        await this.saveIndexToCache();
        this.notifyIndexUpdated();
        return this.getStats();
    }

    private async reconcileVaultInternal({ onProgress, onStatus }: InitializeCallbacks): Promise<ReconcileResult> {
        const markdownFiles = this.app.vault.getMarkdownFiles();
        if (this.fileMetaByPath.size === 0) {
            const totalWork = markdownFiles.length;
            this.emitStatus({
                state: 'reconcile-start',
                changedFiles: markdownFiles.length,
                removedFiles: 0,
                totalWork,
            }, onStatus);
            await this.rebuildIndexInternal({ phase: 'reconcile', onProgress });
            return {
                didChange: true,
                changedFiles: markdownFiles.length,
                removedFiles: 0,
                totalWork,
            };
        }

        const currentFilesByPath = new Map(markdownFiles.map((file) => [file.path, file]));
        const cachedPaths = [...this.fileMetaByPath.keys()];
        const removedPaths = cachedPaths.filter((path) => !currentFilesByPath.has(path));
        const changedFiles = markdownFiles.filter((file) => {
            const metadata = this.fileMetaByPath.get(file.path);
            return !metadata || metadata.mtime !== file.stat.mtime || metadata.size !== file.stat.size;
        });
        const totalWork = removedPaths.length + changedFiles.length;

        this.emitStatus({
            state: 'reconcile-start',
            changedFiles: changedFiles.length,
            removedFiles: removedPaths.length,
            totalWork,
        }, onStatus);

        if (removedPaths.length === 0 && changedFiles.length === 0) {
            return {
                didChange: false,
                changedFiles: 0,
                removedFiles: 0,
                totalWork: 0,
            };
        }

        let didChange = false;
        let processedFiles = 0;

        this.emitProgress({
            processedFiles: 0,
            totalFiles: totalWork,
            blockCount: this.getStats().blockCount,
            referenceCount: this.getStats().referenceCount,
            phase: 'reconcile',
        }, onProgress);

        for (const removedPath of removedPaths) {
            didChange = this.removeFileFromIndexInternal(removedPath) || didChange;
            processedFiles++;
            this.emitProgress({
                processedFiles,
                totalFiles: totalWork,
                blockCount: this.getStats().blockCount,
                referenceCount: this.getStats().referenceCount,
                phase: 'reconcile',
            }, onProgress);
        }

        for (const file of changedFiles) {
            didChange = (await this.processFileChangeInternal(file, false)) || didChange;
            processedFiles++;
            if (processedFiles % 50 === 0 || processedFiles === totalWork) {
                this.emitProgress({
                    processedFiles,
                    totalFiles: totalWork,
                    blockCount: this.getStats().blockCount,
                    referenceCount: this.getStats().referenceCount,
                    phase: 'reconcile',
                }, onProgress);
            }
            await this.yieldToMainThread();
        }

        if (!didChange) {
            return {
                didChange: false,
                changedFiles: changedFiles.length,
                removedFiles: removedPaths.length,
                totalWork,
            };
        }

        await this.saveIndexToCache();
        this.notifyIndexUpdated();
        return {
            didChange: true,
            changedFiles: changedFiles.length,
            removedFiles: removedPaths.length,
            totalWork,
        };
    }

    private async processFileChangeInternal(file: TFile, emitUpdate: boolean): Promise<boolean> {
        const parsed = await this.parseFile(file);
        const previousMeta = this.fileMetaByPath.get(file.path);
        const previousBlocks = new Map<string, BlockCache>();
        const affectedIds = new Set<string>();

        for (const blockId of previousMeta?.blockIds ?? []) {
            const existing = this.blocksById.get(blockId);
            if (existing) {
                previousBlocks.set(blockId, existing);
            }
            affectedIds.add(blockId);
        }

        const removedSourceBlocks = this.removeSourceBlocksForFileInternal(file.path);
        for (const block of removedSourceBlocks) {
            affectedIds.add(block.id);
        }

        this.removeReferencesForFile(file.path, previousMeta?.referencedIds ?? []);
        this.fileMetaByPath.delete(file.path);

        this.populateStateFromParsedFile(
            this.refsById,
            this.fileMetaByPath,
            this.sourceBlocksByFile,
            this.activeSourceBlocksById,
            file,
            parsed,
            previousBlocks,
        );

        for (const blockId of parsed.blocks.keys()) {
            affectedIds.add(blockId);
        }

        for (const blockId of affectedIds) {
            this.refreshCanonicalBlock(blockId, previousBlocks.get(blockId));
        }

        const didChange = true;
        if (emitUpdate) {
            this.scheduleSave();
            this.notifyIndexUpdated();
        }

        return didChange;
    }

    private removeFileFromIndexInternal(filePath: string): boolean {
        const fileMeta = this.fileMetaByPath.get(filePath);
        if (!fileMeta) {
            return false;
        }

        this.fileMetaByPath.delete(filePath);
        this.removeReferencesForFile(filePath, fileMeta.referencedIds);
        const removedSourceBlocks = this.removeSourceBlocksForFileInternal(filePath);
        const affectedIds = new Set<string>(fileMeta.blockIds);

        for (const block of removedSourceBlocks) {
            affectedIds.add(block.id);
        }

        for (const blockId of affectedIds) {
            this.refreshCanonicalBlock(blockId);
        }

        return affectedIds.size > 0 || fileMeta.referencedIds.length > 0;
    }

    private populateStateFromParsedFile(
        targetRefs: Map<string, BlockReferenceLocation[]>,
        targetFileMeta: Map<string, FileIndexMeta>,
        targetSourceBlocksByFile: Map<string, BlockCache[]>,
        targetActiveSourceBlocksById: Map<string, BlockCache[]>,
        file: TFile,
        parsed: ParsedMarkdownFile,
        previousBlocks: Map<string, BlockCache>
    ) {
        const now = Date.now();
        const blockIds: string[] = [];
        const referencedIds = [...parsed.referencesById.keys()];

        for (const [id, parsedBlock] of parsed.blocks.entries()) {
            const previousBlock = previousBlocks.get(id) ?? this.blocksById.get(id);
            const normalizedBlock: BlockCache = {
                ...parsedBlock,
                id,
                status: 'active',
                firstSeenAt: previousBlock?.firstSeenAt ?? now,
                lastSeenAt: now,
                lostAt: undefined,
                recoveredAt: previousBlock?.status === 'stale' ? now : previousBlock?.recoveredAt,
            };
            blockIds.push(id);
            this.upsertSourceBlockForFile(file.path, normalizedBlock, targetSourceBlocksByFile);
            this.upsertActiveSourceBlock(normalizedBlock, targetActiveSourceBlocksById);
        }

        for (const [id, references] of parsed.referencesById.entries()) {
            const existing = targetRefs.get(id);
            if (existing) {
                existing.push(...references);
                continue;
            }

            targetRefs.set(id, [...references]);
        }

        targetFileMeta.set(file.path, {
            path: file.path,
            mtime: file.stat.mtime,
            size: file.stat.size,
            blockIds,
            referencedIds,
        });
    }

    private removeReferencesForFile(filePath: string, referencedIds: string[]) {
        for (const referencedId of referencedIds) {
            const references = this.refsById.get(referencedId);
            if (!references) {
                continue;
            }

            const nextReferences = references.filter((reference) => reference.filePath !== filePath);
            if (nextReferences.length === 0) {
                this.refsById.delete(referencedId);
                const block = this.blocksById.get(referencedId);
                if (block?.status === 'stale') {
                    this.blocksById.delete(referencedId);
                }
                continue;
            }

            this.refsById.set(referencedId, nextReferences);
        }
    }

    private async parseFile(file: TFile): Promise<ParsedMarkdownFile> {
        const content = await this.app.vault.cachedRead(file);
        return this.blockParser.parse(file.path, content);
    }

    private async loadIndexFromCache(): Promise<boolean> {
        try {
            const parsed = await this.cacheStore.load();
            if (!parsed) {
                return false;
            }

            if (Array.isArray(parsed)) {
                this.loadLegacyCache(parsed);
                this.notifyIndexUpdated();
                return true;
            }

            if (parsed.schemaVersion !== CACHE_SCHEMA_VERSION) {
                return false;
            }

            this.blocksById = new Map(
                Object.entries(parsed.blocks).map(([id, block]) => [id, this.normalizeLoadedBlock(id, block)])
            );
            this.refsById = new Map(
                Object.entries(parsed.refsById).map(([id, references]) => [id, references.map((reference) => ({ ...reference }))])
            );
            this.fileMetaByPath = new Map(
                Object.entries(parsed.files).map(([path, meta]) => [path, { ...meta }])
            );
            this.sourceBlocksByFile = new Map(
                Object.entries(parsed.sourceBlocksByFile).map(([path, blocks]) => [
                    path,
                    blocks.map((block) => this.normalizeLoadedBlock(block.id, block)),
                ])
            );
            this.rebuildActiveSourceBlocksById();
            this.notifyIndexUpdated();
            return true;
        } catch (error) {
            console.error('Error loading index from cache:', error);
            return false;
        }
    }

    private loadLegacyCache(entries: LegacyPersistedBlockCacheEntry[]) {
        const now = Date.now();
        this.blocksById = new Map();
        this.refsById = new Map();
        this.fileMetaByPath = new Map();
        this.sourceBlocksByFile = new Map();
        this.activeSourceBlocksById = new Map();

        for (const [id, block] of entries as unknown as [string, LegacyPersistedBlockCacheEntry[1]][]) {
            const loadedBlock: BlockCache = {
                id,
                filePath: block.filePath,
                rawContent: block.rawContent,
                childrenMarkdown: block.childrenMarkdown ?? '',
                startLine: block.startLine,
                endLine: block.startLine,
                childrenIDs: block.childrenIDs ?? [],
                status: 'active',
                firstSeenAt: now,
                lastSeenAt: now,
            };
            this.blocksById.set(id, loadedBlock);
            this.upsertSourceBlockForFile(block.filePath, loadedBlock);
            this.upsertActiveSourceBlock(loadedBlock);
        }
    }

    private normalizeLoadedBlock(id: string, block: BlockCache): BlockCache {
        return {
            ...block,
            id,
            childrenMarkdown: block.childrenMarkdown ?? '',
            status: block.status ?? 'active',
            firstSeenAt: block.firstSeenAt ?? Date.now(),
            lastSeenAt: block.lastSeenAt ?? Date.now(),
        };
    }

    private upsertSourceBlockForFile(
        filePath: string,
        block: BlockCache,
        targetSourceBlocksByFile: Map<string, BlockCache[]> = this.sourceBlocksByFile,
    ) {
        const existingBlocks = targetSourceBlocksByFile.get(filePath) ?? [];
        const nextBlocks = existingBlocks.filter((existingBlock) => !this.isSameSourceBlock(existingBlock, block));
        nextBlocks.push({ ...block });
        nextBlocks.sort((left, right) => left.startLine - right.startLine || left.id.localeCompare(right.id));
        targetSourceBlocksByFile.set(filePath, nextBlocks);
    }

    private removeSourceBlocksForFileInternal(filePath: string): BlockCache[] {
        const blocks = this.sourceBlocksByFile.get(filePath) ?? [];
        if (blocks.length === 0) {
            return [];
        }

        this.sourceBlocksByFile.delete(filePath);
        for (const block of blocks) {
            const activeBlocks = this.activeSourceBlocksById.get(block.id);
            if (!activeBlocks) {
                continue;
            }

            const nextBlocks = activeBlocks.filter((existingBlock) => !this.isSameSourceBlock(existingBlock, block));
            if (nextBlocks.length === 0) {
                this.activeSourceBlocksById.delete(block.id);
                continue;
            }

            this.activeSourceBlocksById.set(block.id, nextBlocks);
        }

        return blocks;
    }

    private upsertActiveSourceBlock(
        block: BlockCache,
        targetActiveSourceBlocksById: Map<string, BlockCache[]> = this.activeSourceBlocksById,
    ) {
        const existingBlocks = targetActiveSourceBlocksById.get(block.id) ?? [];
        const nextBlocks = existingBlocks.filter((existingBlock) => !this.isSameSourceBlock(existingBlock, block));
        nextBlocks.push({ ...block });
        nextBlocks.sort((left, right) => {
            return left.filePath.localeCompare(right.filePath)
                || left.startLine - right.startLine
                || (left.endLine ?? left.startLine) - (right.endLine ?? right.startLine);
        });
        targetActiveSourceBlocksById.set(block.id, nextBlocks);
    }

    private rebuildActiveSourceBlocksById() {
        const nextActiveSourceBlocksById = new Map<string, BlockCache[]>();

        for (const blocks of this.sourceBlocksByFile.values()) {
            for (const block of blocks) {
                this.upsertActiveSourceBlock(block, nextActiveSourceBlocksById);
            }
        }

        this.activeSourceBlocksById = nextActiveSourceBlocksById;
    }

    private refreshCanonicalBlock(id: string, previousBlock?: BlockCache) {
        const activeSourceBlocks = this.activeSourceBlocksById.get(id);
        if (activeSourceBlocks && activeSourceBlocks.length > 0) {
            this.blocksById.set(id, this.buildCanonicalActiveBlock(id, activeSourceBlocks, previousBlock));
            return;
        }

        const existingBlock = previousBlock ?? this.blocksById.get(id);
        if (!existingBlock) {
            return;
        }

        if (existingBlock.status === 'confirmed_deleted') {
            this.blocksById.set(id, existingBlock);
            return;
        }

        const references = this.refsById.get(id);
        if (references && references.length > 0) {
            this.blocksById.set(id, {
                ...existingBlock,
                status: 'stale',
                lostAt: existingBlock.lostAt ?? Date.now(),
            });
            return;
        }

        this.blocksById.delete(id);
    }

    private buildCanonicalActiveBlock(id: string, activeSourceBlocks: BlockCache[], previousBlock?: BlockCache): BlockCache {
        const sourceBlock = this.pickCanonicalSourceBlock(activeSourceBlocks, previousBlock);
        const now = Date.now();

        return {
            ...sourceBlock,
            id,
            status: 'active',
            firstSeenAt: previousBlock?.firstSeenAt ?? sourceBlock.firstSeenAt ?? now,
            lastSeenAt: now,
            lostAt: undefined,
            recoveredAt: previousBlock?.status === 'stale' ? now : previousBlock?.recoveredAt,
        };
    }

    private pickCanonicalSourceBlock(activeSourceBlocks: BlockCache[], previousBlock?: BlockCache): BlockCache {
        if (previousBlock) {
            const matchingBlock = activeSourceBlocks.find((block) => this.isSameSourceBlock(block, previousBlock));
            if (matchingBlock) {
                return matchingBlock;
            }
        }

        return activeSourceBlocks[0];
    }

    private isSameSourceBlock(left: BlockCache, right: BlockCache): boolean {
        return left.id === right.id
            && left.filePath === right.filePath
            && left.startLine === right.startLine
            && (left.endLine ?? left.startLine) === (right.endLine ?? right.startLine);
    }

    private async saveIndexToCache() {
        try {
            const persisted: PersistedIndexCacheV3 = {
                schemaVersion: CACHE_SCHEMA_VERSION,
                builtAt: Date.now(),
                files: Object.fromEntries(this.fileMetaByPath.entries()),
                blocks: Object.fromEntries(this.blocksById.entries()),
                refsById: Object.fromEntries(this.refsById.entries()),
                sourceBlocksByFile: Object.fromEntries(
                    [...this.sourceBlocksByFile.entries()].map(([path, blocks]) => [path, blocks.map((block) => ({ ...block }))])
                ),
            };
            await this.cacheStore.save(persisted);
        } catch (error) {
            console.error('Error saving index to cache:', error);
        }
    }

    private scheduleSave() {
        this.debouncedSave();
    }

    private emitProgress(progress: IndexProgress, onProgress?: (progress: IndexProgress) => void) {
        onProgress?.(progress);
        this.trigger('index-progress', progress);
    }

    private emitStatus(status: IndexStatus, onStatus?: (status: IndexStatus) => void) {
        onStatus?.(status);
        this.trigger('index-status', status);
    }

    private notifyIndexUpdated() {
        this.indexRevision += 1;
        this.trigger('index-updated', {
            revision: this.indexRevision,
            stats: this.getStats(),
        });
    }

    private async ensureRecoveryFolderExists() {
        const folderPath = normalizePath('pages');
        const existing = this.app.vault.getAbstractFileByPath(folderPath);
        if (existing) {
            return;
        }

        await this.app.vault.createFolder(folderPath);
    }

    private buildRecoveryMarkdown(block: BlockCache): string {
        const rawLines = block.rawContent.split(/\r?\n/);
        const rootLine = rawLines[0] ?? '';
        const continuationLines = rawLines.slice(1);
        const metadataLines = [
            `  id:: ${block.id}`,
            `  recovered-from:: ${block.filePath}`,
            `  recovered-at:: ${new Date().toISOString()}`,
        ];

        const lines = [`- ${rootLine}`, ...continuationLines, ...metadataLines];
        if (block.childrenMarkdown.trim()) {
            lines.push(...block.childrenMarkdown.split(/\r?\n/));
        }

        return lines.join('\n');
    }

    private containsBlockId(content: string, id: string): boolean {
        const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`^\\s*id::\\s*${escapedId}\\s*$`, 'm');
        return pattern.test(content);
    }

    private countActiveBlocks(blocks: Map<string, BlockCache>): number {
        let count = 0;
        for (const block of blocks.values()) {
            if (block.status === 'active') {
                count++;
            }
        }
        return count;
    }

    private countReferenceLocations(refs: Map<string, BlockReferenceLocation[]>): number {
        let count = 0;
        for (const references of refs.values()) {
            count += references.length;
        }
        return count;
    }

    private async yieldToMainThread() {
        await new Promise<void>((resolve) => activeWindow.setTimeout(resolve, 0));
    }

    private queueOperation<T>(operation: () => Promise<T>): Promise<T> {
        const next = this.operationQueue.then(operation, operation);
        this.operationQueue = next.then(() => undefined, () => undefined);
        return next;
    }
}
