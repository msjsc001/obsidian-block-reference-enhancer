import type { Rect } from "@codemirror/view";
import { isHtmlElement } from "./dom";

type RectLike = Pick<DOMRectReadOnly, "left" | "right" | "top" | "bottom">;

function toRect(rect: RectLike): Rect {
    return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
    };
}

function pickRect(dom: HTMLElement, preferStart: boolean): Rect | null {
    const rects = Array.from(dom.getClientRects())
        .filter((rect) => rect.width > 0 || rect.height > 0);

    if (rects.length > 0) {
        return toRect(preferStart ? rects[0] : rects[rects.length - 1]);
    }

    const bounds = dom.getBoundingClientRect();
    if (bounds.width <= 0 && bounds.height <= 0) {
        return null;
    }

    return toRect(bounds);
}

function pickAncestorRect(dom: HTMLElement): Rect | null {
    let current = dom.parentElement;
    while (current) {
        const rect = pickRect(current, true);
        if (rect) {
            return rect;
        }
        current = current.parentElement;
    }

    return null;
}

export function measureWidgetCoords(dom: HTMLElement, pos: number, side: number): Rect | null {
    const preferStart = pos <= 0 ? side <= 0 : side < 0;
    const childTarget = isHtmlElement(dom.firstElementChild) ? dom.firstElementChild : null;
    if (childTarget) {
        const childRect = pickRect(childTarget, preferStart);
        if (childRect) {
            return childRect;
        }
    }

    const ownRect = pickRect(dom, preferStart);
    if (ownRect) {
        return ownRect;
    }

    const ancestorRect = pickAncestorRect(dom);
    if (ancestorRect) {
        return ancestorRect;
    }

    // CodeMirror permits null, but Outliner's vertical-line implementation
    // assumes a rectangle is always present. Keep that compatibility boundary
    // safe during the short DOM replacement window.
    const bounds = dom.getBoundingClientRect();
    return {
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
    };
}
