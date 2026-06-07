/**
 * Represents the metadata for a single block stored in the index.
 */
export interface BlockCache {
    /** The relative path to the file containing the block. */
    filePath: string;
    /** The raw text content of the block itself (the line with the dash). */
    rawContent: string;
    /** Descendant block lines belonging to this block, excluding the root line itself. */
    childrenMarkdown?: string;
    /** The starting line number of the block in the file (0-indexed). */
    startLine: number;
    /** An array of UUIDs of the direct children of this block. */
    childrenIDs: string[];
}

/**
 * The main index structure, mapping block UUIDs to their cache metadata.
 */
export type BlockIndex = Map<string, BlockCache>;
