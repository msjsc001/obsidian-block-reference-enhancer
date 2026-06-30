import { EditorView, WidgetType } from "@codemirror/view";
import { measureWidgetCoords } from "src/utils/widgetCoords";

export class BlockReferenceSourceAnchorWidget extends WidgetType {
    eq(): boolean {
        return true;
    }

    ignoreEvent(): boolean {
        return true;
    }

    coordsAt(dom: HTMLElement, pos: number, side: number) {
        return measureWidgetCoords(dom, pos, side);
    }

    toDOM(view: EditorView): HTMLElement {
        const anchor = view.contentDOM.ownerDocument.createElement("span");
        anchor.className = "block-reference-source-anchor";
        anchor.setAttribute("aria-hidden", "true");
        return anchor;
    }
}
