export function createSourceReferenceBadgeElement(
    blockId: string,
    count: number,
    sourceFilePath?: string,
    sourceStartLine?: number,
): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'block-reference-source-badge';
    button.dataset.blockRefSourceId = blockId;
    button.dataset.blockRefSourceCount = String(count);
    if (sourceFilePath) {
        button.dataset.blockRefSourceFilePath = sourceFilePath;
    }
    if (typeof sourceStartLine === 'number') {
        button.dataset.blockRefSourceStartLine = String(sourceStartLine);
    }
    button.setAttribute('aria-label', `Referenced ${count} times`);
    button.setAttribute('title', `${count} references`);
    button.setText(String(count));
    return button;
}
