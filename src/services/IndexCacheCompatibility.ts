import { PersistedIndexCacheV4 } from '../types';

export const INDEX_CACHE_SCHEMA_VERSION = 4;
export const INDEX_CACHE_PARSER_REVISION = 2;

export type IndexCacheCompatibilityState = 'missing' | 'current' | 'invalidated';

export interface IndexCacheCompatibilityResult {
    state: IndexCacheCompatibilityState;
    cache?: PersistedIndexCacheV4;
}

type UnknownRecord = Record<string, unknown>;

function isObject(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasRequiredCacheCollections(value: UnknownRecord): boolean {
    return isObject(value.files)
        && isObject(value.blocks)
        && isObject(value.refsById)
        && isObject(value.sourceBlocksByFile);
}

export function resolveIndexCacheCompatibility(cache: unknown): IndexCacheCompatibilityResult {
    if (cache == null) {
        return { state: 'missing' };
    }

    if (Array.isArray(cache)) {
        return { state: 'invalidated' };
    }

    if (!isObject(cache) || !hasRequiredCacheCollections(cache)) {
        return { state: 'invalidated' };
    }

    if (cache.schemaVersion !== INDEX_CACHE_SCHEMA_VERSION) {
        return { state: 'invalidated' };
    }

    if (cache.parserRevision !== INDEX_CACHE_PARSER_REVISION) {
        return { state: 'invalidated' };
    }

    if (typeof cache.builtAt !== 'number') {
        return { state: 'invalidated' };
    }

    return {
        state: 'current',
        cache: cache as unknown as PersistedIndexCacheV4,
    };
}
