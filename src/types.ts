export type BlockStatus = 'active' | 'stale' | 'confirmed_deleted';

/**
 * Represents the metadata for a single source block stored in the index.
 */
export interface BlockCache {
    id: string;
    filePath: string;
    rawContent: string;
    childrenMarkdown: string;
    startLine: number;
    endLine?: number;
    childrenIDs: string[];
    status: BlockStatus;
    firstSeenAt: number;
    lastSeenAt: number;
    lostAt?: number;
    recoveredAt?: number;
}

export interface BlockReferenceLocation {
    filePath: string;
    line: number;
    ch: number;
    kind: 'inline' | 'embed';
}

export interface FileIndexMeta {
    path: string;
    mtime: number;
    size: number;
    blockIds: string[];
    referencedIds: string[];
}

export interface ParsedMarkdownFile {
    blocks: Map<string, BlockCache>;
    referencesById: Map<string, BlockReferenceLocation[]>;
}

export interface PersistedIndexCacheV3 {
    schemaVersion: 3;
    builtAt: number;
    files: Record<string, FileIndexMeta>;
    blocks: Record<string, BlockCache>;
    refsById: Record<string, BlockReferenceLocation[]>;
    sourceBlocksByFile: Record<string, BlockCache[]>;
}

export interface LegacyPersistedBlockCacheEntry {
    0: string;
    1: {
        filePath: string;
        rawContent: string;
        childrenMarkdown?: string;
        startLine: number;
        childrenIDs?: string[];
    };
}

export interface IndexBuildStats {
    fileCount: number;
    blockCount: number;
    referenceCount: number;
    staleBlockCount: number;
}

export type IndexPhase = 'load-cache' | 'reconcile' | 'rebuild';

export interface IndexProgress {
    processedFiles: number;
    totalFiles: number;
    blockCount: number;
    referenceCount: number;
    phase: IndexPhase;
}

export type IndexReadySource = 'cache' | 'reconcile' | 'rebuild';

export interface IndexStatus {
    state: 'loading-cache' | 'cache-missing' | 'cache-loaded' | 'reconcile-start' | 'ready';
    stats?: IndexBuildStats;
    source?: IndexReadySource;
    changedFiles?: number;
    removedFiles?: number;
    totalWork?: number;
}

export interface StaleBlockRecord {
    id: string;
    block: BlockCache;
    references: BlockReferenceLocation[];
}

export interface SourceBlockRecord {
    id: string;
    block: BlockCache;
}

export interface PaginatedBlockReferences {
    page: number;
    pageSize: number;
    total: number;
    references: BlockReferenceLocation[];
}
