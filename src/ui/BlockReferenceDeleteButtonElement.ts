import { getDocument } from '../utils/dom';

export function createBlockReferenceDeleteButtonElement(
	owner?: Node | Document | null,
): HTMLButtonElement {
	const button = getDocument(owner).createElement('button');
	button.type = 'button';
	button.className = 'block-reference-delete-button';
	button.setAttribute('aria-label', 'Delete block reference syntax');
	button.setAttribute('title', 'Delete block reference syntax');
	button.setText('Delete');
	return button;
}
