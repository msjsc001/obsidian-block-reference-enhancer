export function replaceChildrenFromHtml(target: HTMLElement, html: string) {
    const DomParser = target.ownerDocument.defaultView?.DOMParser ?? DOMParser;
    const parser = new DomParser();
    const parsed = parser.parseFromString(`<body>${html}</body>`, "text/html");
    const fragment = target.ownerDocument.createDocumentFragment();

    for (const node of Array.from(parsed.body.childNodes)) {
        fragment.appendChild(target.ownerDocument.importNode(node, true));
    }

    target.replaceChildren(fragment);
}

export function serializeChildrenToHtml(container: HTMLElement): string {
    const wrapper = container.ownerDocument.createElement("div");
    wrapper.append(...Array.from(container.childNodes).map((node) => node.cloneNode(true)));

    const XmlSerializer = container.ownerDocument.defaultView?.XMLSerializer ?? XMLSerializer;
    const serialized = new XmlSerializer().serializeToString(wrapper);
    return serialized
        .replace(/^<div(?:\s+xmlns="[^"]+")?>/, "")
        .replace(/<\/div>$/, "");
}
