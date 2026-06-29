import type { OutlineClipboardPayload } from './OutlinePasteParser';

export async function readOutlineClipboard(): Promise<OutlineClipboardPayload> {
	const clipboard = navigator.clipboard;
	if (!clipboard) {
		return {
			html: null,
			text: null,
		};
	}

	try {
		return await readClipboardItems(clipboard);
	} catch {
		// Fall back to plain text below.
	}

	if (!clipboard.readText) {
		return {
			html: null,
			text: null,
		};
	}

	try {
		return {
			html: null,
			text: await clipboard.readText(),
		};
	} catch {
		return {
			html: null,
			text: null,
		};
	}
}

async function readClipboardItems(clipboard: Clipboard): Promise<OutlineClipboardPayload> {
	const items = await clipboard.read();
	let html: string | null = null;
	let text: string | null = null;

	for (const item of items) {
		if (!html && item.types.includes('text/html')) {
			html = await readClipboardItemAsText(item, 'text/html');
		}

		if (!text && item.types.includes('text/plain')) {
			text = await readClipboardItemAsText(item, 'text/plain');
		}

		if (html && text) {
			break;
		}
	}

	return { html, text };
}

async function readClipboardItemAsText(item: ClipboardItem, mimeType: string): Promise<string | null> {
	try {
		const blob = await item.getType(mimeType);
		return await blob.text();
	} catch {
		return null;
	}
}
