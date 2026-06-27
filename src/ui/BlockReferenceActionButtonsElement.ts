import { getDocument } from '../utils/dom';
import { createBlockReferenceDeleteButtonElement } from './BlockReferenceDeleteButtonElement';
import { createSourceBlockBackButtonElement } from './SourceBlockBackButtonElement';

export function createBlockReferenceActionButtonsElement(
	blockId: string,
	owner?: Node | Document | null,
): HTMLDivElement {
	const doc = getDocument(owner);
	const actions = doc.createElement('div');
	actions.className = 'block-reference-action-buttons';
	actions.append(
		createSourceBlockBackButtonElement(blockId, doc),
		createBlockReferenceDeleteButtonElement(doc),
	);
	return actions;
}
