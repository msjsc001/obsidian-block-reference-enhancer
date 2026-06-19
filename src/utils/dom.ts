export function isDomNode(value: unknown): value is Node {
	return !!value && typeof value === 'object' && 'nodeType' in value;
}

export function isHtmlElement(value: unknown): value is HTMLElement {
	return isDomNode(value) && value.instanceOf(HTMLElement);
}

export function isDocumentNode(value: unknown): value is Document {
	return isDomNode(value) && value.nodeType === 9 && 'createElement' in value;
}

export function getDocument(owner?: Node | Document | null): Document {
	if (!owner) {
		return activeDocument;
	}

	if (isDocumentNode(owner)) {
		return owner;
	}

	return owner.ownerDocument ?? activeDocument;
}

export function getWindow(owner?: Node | Document | null): Window {
	const doc = getDocument(owner);
	return doc.defaultView ?? activeWindow;
}
