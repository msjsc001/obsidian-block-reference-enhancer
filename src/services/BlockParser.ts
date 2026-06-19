import { BlockCache, BlockReferenceLocation, ParsedMarkdownFile } from '../types';

interface BlockInProgress {
    block: BlockCache;
    indentation: number;
    id?: string;
}

interface FenceState {
    char: '`' | '~';
    length: number;
}

const EMBED_BLOCK_REF_REGEX = /\{\{embed\s+\(\(([A-Za-z0-9_-]{36,})\)\)\s*\}\}/y;
const INLINE_BLOCK_REF_REGEX = /\(\(([A-Za-z0-9_-]{36,})\)\)/y;
const FULLWIDTH_INLINE_BLOCK_REF_REGEX = /（（([A-Za-z0-9_-]{36,})））/y;
const FENCE_REGEX = /^\s{0,3}(`{3,}|~{3,})/;

/**
 * Parses UUID-style outline Markdown files to extract source blocks and references.
 */
export class BlockParser {
    private readonly PAGE_PROPS_REGEX = /^\s*[^-\s].*?::\s*.*$/;
    private readonly BLOCK_CONTENT_REGEX = /^(\s*)-\s(.+)/;
    private readonly BLOCK_ID_REGEX = /^\s*id::\s*([a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12})/;
    private readonly BLOCK_PROPS_REGEX = /^\s*([^-\s].*?::\s*.*)$/;

    public parse(filePath: string, content: string): ParsedMarkdownFile {
        return {
            blocks: this.parseBlocks(filePath, content),
            referencesById: this.parseReferences(filePath, content),
        };
    }

    private parseBlocks(filePath: string, content: string): Map<string, BlockCache> {
        const lines = content.split('\n');
        const allFoundBlocks: BlockInProgress[] = [];
        const parentStack: BlockInProgress[] = [];
        let inPageProperties = true;

        for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
            const line = lines[lineNumber];

            if (inPageProperties) {
                if (this.PAGE_PROPS_REGEX.test(line) || line.trim() === '') {
                    continue;
                }
                inPageProperties = false;
            }

            const blockMatch = line.match(this.BLOCK_CONTENT_REGEX);
            if (blockMatch) {
                const indentation = blockMatch[1].length;
                const rawContent = blockMatch[2];

                const newBlock: BlockInProgress = {
                    block: {
                        id: '',
                        filePath,
                        rawContent,
                        childrenMarkdown: '',
                        startLine: lineNumber,
                        endLine: lineNumber,
                        childrenIDs: [],
                        sourceUpdatedAt: 0,
                        status: 'active',
                        firstSeenAt: 0,
                        lastSeenAt: 0,
                    },
                    indentation,
                };

                while (parentStack.length > 0 && parentStack[parentStack.length - 1].indentation >= indentation) {
                    parentStack.pop();
                }

                for (const ancestor of parentStack) {
                    this.appendChildLine(ancestor.block, line, lineNumber);
                }

                if (parentStack.length > 0) {
                    const parent = parentStack[parentStack.length - 1];
                    (parent.block as BlockCache & { _children?: BlockInProgress[] })._children = (parent.block as BlockCache & { _children?: BlockInProgress[] })._children || [];
                    (parent.block as BlockCache & { _children?: BlockInProgress[] })._children?.push(newBlock);
                    parent.block.endLine = lineNumber;
                }

                parentStack.push(newBlock);
                allFoundBlocks.push(newBlock);
                continue;
            }

            const lastBlock = allFoundBlocks[allFoundBlocks.length - 1];
            if (!lastBlock) {
                continue;
            }

            const lineIndentation = this.getLineIndentation(line);
            if (line.trim() === '') {
                if (lineIndentation > lastBlock.indentation) {
                    this.appendBlockContinuation(lastBlock, line, lineNumber, parentStack);
                }
                continue;
            }

            const idMatch = line.match(this.BLOCK_ID_REGEX);
            if (idMatch && lineIndentation > lastBlock.indentation) {
                lastBlock.id = idMatch[1];
                lastBlock.block.endLine = Math.max(lastBlock.block.endLine ?? lastBlock.block.startLine, lineNumber);
                for (let index = 0; index < parentStack.length - 1; index++) {
                    parentStack[index].block.endLine = Math.max(parentStack[index].block.endLine ?? parentStack[index].block.startLine, lineNumber);
                }
                continue;
            }

            const propMatch = line.match(this.BLOCK_PROPS_REGEX);
            if (propMatch && lineIndentation > lastBlock.indentation) {
                this.appendBlockContinuation(lastBlock, line, lineNumber, parentStack);
                continue;
            }

            if (lineIndentation > lastBlock.indentation) {
                this.appendBlockContinuation(lastBlock, line, lineNumber, parentStack);
            }
        }

        const finalIndex = new Map<string, BlockCache>();
        for (const blockInProgress of allFoundBlocks) {
            const childHolder = blockInProgress.block as BlockCache & { _children?: BlockInProgress[] };
            if (childHolder._children) {
                blockInProgress.block.childrenIDs = childHolder._children
                    .map((child) => child.id)
                    .filter((id): id is string => !!id);
                delete childHolder._children;
            }

            if (blockInProgress.id) {
                blockInProgress.block.id = blockInProgress.id;
                finalIndex.set(blockInProgress.id, blockInProgress.block);
            }
        }

        return finalIndex;
    }

    private parseReferences(filePath: string, content: string): Map<string, BlockReferenceLocation[]> {
        const referencesById = new Map<string, BlockReferenceLocation[]>();
        const lines = content.split('\n');
        let inFrontmatter = lines[0]?.trim() === '---';
        let fenceState: FenceState | null = null;

        for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
            const line = lines[lineNumber];

            if (inFrontmatter) {
                if (lineNumber > 0 && (line.trim() === '---' || line.trim() === '...')) {
                    inFrontmatter = false;
                }
                continue;
            }

            if (fenceState) {
                if (this.isClosingFence(line, fenceState)) {
                    fenceState = null;
                }
                continue;
            }

            const nextFenceState = this.getFenceState(line);
            if (nextFenceState) {
                fenceState = nextFenceState;
                continue;
            }

            this.scanLineForReferences(filePath, line, lineNumber, referencesById);
        }

        return referencesById;
    }

    private scanLineForReferences(
        filePath: string,
        line: string,
        lineNumber: number,
        referencesById: Map<string, BlockReferenceLocation[]>
    ) {
        let index = 0;

        while (index < line.length) {
            if (line[index] === '`') {
                index = this.findInlineCodeSpanEnd(line, index);
                continue;
            }

            EMBED_BLOCK_REF_REGEX.lastIndex = index;
            const embedMatch = EMBED_BLOCK_REF_REGEX.exec(line);
            if (embedMatch) {
                this.addReference(referencesById, embedMatch[1], {
                    filePath,
                    line: lineNumber,
                    ch: embedMatch.index,
                    kind: 'embed',
                });
                index = embedMatch.index + embedMatch[0].length;
                continue;
            }

            INLINE_BLOCK_REF_REGEX.lastIndex = index;
            const inlineMatch = INLINE_BLOCK_REF_REGEX.exec(line);
            if (inlineMatch) {
                this.addReference(referencesById, inlineMatch[1], {
                    filePath,
                    line: lineNumber,
                    ch: inlineMatch.index,
                    kind: 'inline',
                });
                index = inlineMatch.index + inlineMatch[0].length;
                continue;
            }

            FULLWIDTH_INLINE_BLOCK_REF_REGEX.lastIndex = index;
            const fullwidthMatch = FULLWIDTH_INLINE_BLOCK_REF_REGEX.exec(line);
            if (fullwidthMatch) {
                this.addReference(referencesById, fullwidthMatch[1], {
                    filePath,
                    line: lineNumber,
                    ch: fullwidthMatch.index,
                    kind: 'inline',
                });
                index = fullwidthMatch.index + fullwidthMatch[0].length;
                continue;
            }

            index++;
        }
    }

    private addReference(
        referencesById: Map<string, BlockReferenceLocation[]>,
        id: string,
        location: BlockReferenceLocation
    ) {
        const existing = referencesById.get(id);
        if (existing) {
            existing.push(location);
            return;
        }

        referencesById.set(id, [location]);
    }

    private appendBlockContinuation(
        blockInProgress: BlockInProgress,
        line: string,
        lineNumber: number,
        parentStack: BlockInProgress[]
    ) {
        blockInProgress.block.rawContent = blockInProgress.block.rawContent
            ? `${blockInProgress.block.rawContent}\n${line}`
            : line;
        blockInProgress.block.endLine = lineNumber;

        for (let index = 0; index < parentStack.length - 1; index++) {
            this.appendChildLine(parentStack[index].block, line, lineNumber);
        }
    }

    private appendChildLine(target: BlockCache, line: string, lineNumber: number) {
        target.childrenMarkdown = target.childrenMarkdown
            ? `${target.childrenMarkdown}\n${line}`
            : line;
        target.endLine = lineNumber;
    }

    private getLineIndentation(line: string): number {
        const match = line.match(/^(\s*)/);
        return match ? match[1].length : 0;
    }

    private getFenceState(line: string): FenceState | null {
        const match = line.match(FENCE_REGEX);
        if (!match) {
            return null;
        }

        const marker = match[1];
        return {
            char: marker[0] as FenceState['char'],
            length: marker.length,
        };
    }

    private isClosingFence(line: string, fenceState: FenceState): boolean {
        const closingRegex = new RegExp(`^\\s{0,3}${fenceState.char}{${fenceState.length},}\\s*$`);
        return closingRegex.test(line);
    }

    private findInlineCodeSpanEnd(line: string, start: number): number {
        let ticks = 0;
        while (start + ticks < line.length && line[start + ticks] === '`') {
            ticks++;
        }

        const delimiter = '`'.repeat(ticks);
        const closingIndex = line.indexOf(delimiter, start + ticks);
        if (closingIndex === -1) {
            return start + ticks;
        }

        return closingIndex + ticks;
    }
}
