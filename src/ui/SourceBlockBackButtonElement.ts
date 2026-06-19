import { getDocument } from '../utils/dom';

export function createSourceBlockBackButtonElement(
	blockId: string,
	owner?: Node | Document | null,
): HTMLButtonElement {
	const button = getDocument(owner).createElement('button');
	button.type = 'button';
	button.className = 'block-reference-back-button';
	button.dataset.blockRefSourceId = blockId;
	button.setAttribute('aria-label', 'Open source block');
	button.setAttribute('title', 'Open source block');
	button.setText('Back');
	return button;
}
