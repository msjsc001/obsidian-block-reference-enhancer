import { App, Events, TFile, debounce, normalizePath } from 'obsidian';
import {
    BlockCache,
    BlockReferenceLocation,
    FileIndexMeta,
    IndexBuildStats,
    IndexProgress,
    IndexStatus,
    LegacyPersistedBlockCacheEntry,
    ParsedMarkdownFile,
    PersistedIndexCacheV2,
    StaleBlockRecord,
} from '../types';
import { BlockParser } from './BlockParser';

const CACHE_SCHEMA_VERSION = 2;
const RECOVERY_PAGE_PATH = 'pages/Block Recovery.md';

interface BuildOptions {
    phase: IndexProgress['phase'];
    onProgress?: (progress: IndexProgress) => void;
}

interface InitializeCallbacks {
    onProgress?: (progress: IndexProgress) => void;
    onStatus?: (status: IndexStatus) => void;
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
    private readonly CACHE_FILE_PATH: string;
    private readonly debouncedSave: () => void;
    private readonly recoverPagePath = normalizePath(RECOVERY_PAGE_PATH);

    private blocksById = new Map<string, BlockCache>();
    private refsById = new Map<string, BlockReferenceLocation[]>();
    private fileMetaByPath = new Map<string, FileIndexMeta>();
    private indexRevision = 0;
    private operationQueue: Promise<unknown> = Promise.resolve();

    constructor(app: App, pluginDataPath: string) {
        super();
        this.app = app;
        this.blockParser = new BlockParser();
        this.CACHE_FILE_PATH = `${pluginDataPath}/block-cache.json`;
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
            let didChange = false;

            if (fileMeta) {
                this.fileMetaByPath.delete(oldPath);
                this.fileMetaByPath.set(normalizedNewPath, {
                    ...fileMeta,
                    path: normalizedNewPath,
                });
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
        for (const [id, block] of this.blocksById.entries()) {
            if (block.status !== 'active') {
                continue;
            }

            if (block.filePath === filePath && block.startLine === line) {
                return { id, block };
            }
        }

        return null;
    }

    public addBlock(id: string, block: Omit<BlockCache, 'id' | 'status' | 'firstSeenAt' | 'lastSeenAt'>) {
        const now = Date.now();
        const existing = this.blocksById.get(id);

        this.blocksById.set(id, {
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
        });

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
        const nextBlocks = new Map<string, BlockCache>();
        const nextRefs = new Map<string, BlockReferenceLocation[]>();
        const nextFileMeta = new Map<string, FileIndexMeta>();
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
            this.populateStateFromParsedFile(nextBlocks, nextRefs, nextFileMeta, file, parsed, previousBlocks);

            processedFiles++;
            if (processedFiles % 50 === 0 || processedFiles === markdownFiles.length) {
                this.emitProgress({
                    processedFiles,
                    totalFiles: markdownFiles.length,
                    blockCount: this.countActiveBlocks(nextBlocks),
                    referenceCount: this.countReferenceLocations(nextRefs),
                    phase,
                }, onProgress);
                await this.yieldToMainThread();
            }
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
        const previousBlockIds = new Set(previousMeta?.blockIds ?? []);
        const previousBlocks = new Map<string, BlockCache>();

        for (const blockId of previousBlockIds) {
            const existing = this.blocksById.get(blockId);
            if (existing) {
                previousBlocks.set(blockId, existing);
            }
            this.blocksById.delete(blockId);
        }

        this.removeReferencesForFile(file.path, previousMeta?.referencedIds ?? []);
        this.fileMetaByPath.delete(file.path);

        this.populateStateFromParsedFile(this.blocksById, this.refsById, this.fileMetaByPath, file, parsed, previousBlocks);

        const nextBlockIds = new Set([...parsed.blocks.keys()]);
        for (const [blockId, previousBlock] of previousBlocks.entries()) {
            if (nextBlockIds.has(blockId)) {
                continue;
            }

            const references = this.refsById.get(blockId);
            if (references && references.length > 0) {
                this.blocksById.set(blockId, {
                    ...previousBlock,
                    status: 'stale',
                    lostAt: previousBlock.lostAt ?? Date.now(),
                });
            }
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

        let didChange = false;
        for (const blockId of fileMeta.blockIds) {
            const block = this.blocksById.get(blockId);
            if (!block) {
                continue;
            }

            didChange = true;
            const references = this.refsById.get(blockId);
            if (references && references.length > 0) {
                this.blocksById.set(blockId, {
                    ...block,
                    status: 'stale',
                    lostAt: block.lostAt ?? Date.now(),
                });
                continue;
            }

            this.blocksById.delete(blockId);
        }

        return didChange;
    }

    private populateStateFromParsedFile(
        targetBlocks: Map<string, BlockCache>,
        targetRefs: Map<string, BlockReferenceLocation[]>,
        targetFileMeta: Map<string, FileIndexMeta>,
        file: TFile,
        parsed: ParsedMarkdownFile,
        previousBlocks: Map<string, BlockCache>
    ) {
        const now = Date.now();
        const blockIds = [...parsed.blocks.keys()];
        const referencedIds = [...parsed.referencesById.keys()];

        for (const [id, parsedBlock] of parsed.blocks.entries()) {
            const previousBlock = previousBlocks.get(id) ?? targetBlocks.get(id);
            targetBlocks.set(id, {
                ...parsedBlock,
                id,
                status: 'active',
                firstSeenAt: previousBlock?.firstSeenAt ?? now,
                lastSeenAt: now,
                lostAt: undefined,
                recoveredAt: previousBlock?.status === 'stale' ? now : previousBlock?.recoveredAt,
            });
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
            if (!await this.app.vault.adapter.exists(this.CACHE_FILE_PATH)) {
                return false;
            }

            const data = await this.app.vault.adapter.read(this.CACHE_FILE_PATH);
            const parsed = JSON.parse(data) as PersistedIndexCacheV2 | LegacyPersistedBlockCacheEntry[];

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

        for (const [id, block] of entries as unknown as [string, LegacyPersistedBlockCacheEntry[1]][]) {
            this.blocksById.set(id, {
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
            });
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

    private async saveIndexToCache() {
        try {
            const persisted: PersistedIndexCacheV2 = {
                schemaVersion: CACHE_SCHEMA_VERSION,
                builtAt: Date.now(),
                files: Object.fromEntries(this.fileMetaByPath.entries()),
                blocks: Object.fromEntries(this.blocksById.entries()),
                refsById: Object.fromEntries(this.refsById.entries()),
            };
            await this.app.vault.adapter.write(this.CACHE_FILE_PATH, JSON.stringify(persisted));
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
        if (await this.app.vault.adapter.exists(folderPath)) {
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
        await new Promise((resolve) => setTimeout(resolve, 0));
    }

    private queueOperation<T>(operation: () => Promise<T>): Promise<T> {
        const next = this.operationQueue.then(operation, operation);
        this.operationQueue = next.then(() => undefined, () => undefined);
        return next;
    }
}
