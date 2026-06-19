import { EditorView, WidgetType } from '@codemirror/view';
import { createSourceReferenceBadgeElement } from '../ui/SourceReferenceBadgeElement';

export class SourceReferenceBadgeWidget extends WidgetType {
    constructor(
        private readonly blockId: string,
        private readonly count: number,
        private readonly sourceFilePath: string,
        private readonly sourceStartLine: number,
    ) {
        super();
    }

    eq(other: SourceReferenceBadgeWidget): boolean {
        return this.blockId === other.blockId
            && this.count === other.count
            && this.sourceFilePath === other.sourceFilePath
            && this.sourceStartLine === other.sourceStartLine;
    }

    ignoreEvent(): boolean {
        return false;
    }

    toDOM(view: EditorView): HTMLElement {
        const anchor = view.contentDOM.ownerDocument.createElement('span');
        anchor.className = 'block-reference-source-badge-anchor';
        anchor.appendChild(
            createSourceReferenceBadgeElement(
                this.blockId,
                this.count,
                this.sourceFilePath,
                this.sourceStartLine,
                view.contentDOM,
            ),
        );
        return anchor;
    }
}
