import { BlockCache } from '../types';

interface BlockInProgress {
    block: BlockCache;
    indentation: number;
    id?: string;
    line: number;
}

/**
 * Parses the content of a Markdown file to extract Logseq-style blocks and their metadata.
 */
export class BlockParser {
    private readonly PAGE_PROPS_REGEX = /^\s*[^-\s].*?::\s*.*$/;
    private readonly BLOCK_CONTENT_REGEX = /^(\s*)-\s(.+)/;
    private readonly BLOCK_ID_REGEX = /^\s*id::\s*([a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12})/;
    private readonly BLOCK_PROPS_REGEX = /^\s*([^-\s].*?::\s*.*)$/;

    private appendChildLine(target: BlockCache, line: string) {
        target.childrenMarkdown = target.childrenMarkdown
            ? `${target.childrenMarkdown}\n${line}`
            : line;
    }

    public parse(filePath: string, content: string): Map<string, BlockCache> {
        const lines = content.split('\n');
        const allFoundBlocks: BlockInProgress[] = [];
        const parentStack: BlockInProgress[] = [];
        let inPageProperties = true;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

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
                        filePath,
                        rawContent,
                        childrenMarkdown: "",
                        startLine: i,
                        childrenIDs: [],
                    },
                    indentation,
                    line: i,
                };

                while (parentStack.length > 0 && parentStack[parentStack.length - 1].indentation >= indentation) {
                    parentStack.pop();
                }

                for (const ancestor of parentStack) {
                    this.appendChildLine(ancestor.block, line);
                }

                if (parentStack.length > 0) {
                    const parent = parentStack[parentStack.length - 1];
                    // We will resolve the ID later, for now we link the objects
                    (parent.block as any)._children = (parent.block as any)._children || [];
                    (parent.block as any)._children.push(newBlock);
                }

                parentStack.push(newBlock);
                allFoundBlocks.push(newBlock);
            } else {
                const lastBlock = allFoundBlocks[allFoundBlocks.length - 1];
                if (!lastBlock) continue;

                const idMatch = line.match(this.BLOCK_ID_REGEX);
                if (idMatch && i === lastBlock.line + 1) {
                    const idIndentation = line.indexOf('id::');
                    if (idIndentation > lastBlock.indentation) {
                        lastBlock.id = idMatch[1];
                        continue;
                    }
                }

                const propMatch = line.match(this.BLOCK_PROPS_REGEX);
                if (propMatch) {
                     const propIndentation = line.indexOf(propMatch[1]);
                     if (propIndentation > lastBlock.indentation) {
                         lastBlock.block.rawContent += '\n' + line;
                         for (let index = 0; index < parentStack.length - 1; index++) {
                             this.appendChildLine(parentStack[index].block, line);
                         }
                     }
                }
            }
        }

        const finalIndex = new Map<string, BlockCache>();
        for (const blockInProgress of allFoundBlocks) {
            // Resolve children IDs
            if ((blockInProgress.block as any)._children) {
                blockInProgress.block.childrenIDs = (blockInProgress.block as any)._children
                    .map((child: BlockInProgress) => child.id)
                    .filter((id?: string): id is string => !!id);
                delete (blockInProgress.block as any)._children;
            }

            if (blockInProgress.id) {
                finalIndex.set(blockInProgress.id, blockInProgress.block);
            }
        }
        
        return finalIndex;
    }
}
