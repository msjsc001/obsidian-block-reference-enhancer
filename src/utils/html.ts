export function replaceChildrenFromHtml(target: HTMLElement, html: string) {
    const range = document.createRange();
    range.selectNodeContents(target);
    const fragment = range.createContextualFragment(html);
    target.replaceChildren(fragment);
}

export function serializeChildrenToHtml(container: HTMLElement): string {
    const wrapper = document.createElement("div");
    wrapper.append(...Array.from(container.childNodes).map((node) => node.cloneNode(true)));

    const serialized = new XMLSerializer().serializeToString(wrapper);
    return serialized
        .replace(/^<div(?:\s+xmlns="[^"]+")?>/, "")
        .replace(/<\/div>$/, "");
}
