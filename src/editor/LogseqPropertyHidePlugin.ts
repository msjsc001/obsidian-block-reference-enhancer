import { EventRef } from 'obsidian';
import {
	EditorSelection,
	Line,
	RangeSetBuilder,
	countColumn,
	type Extension,
	type EditorState,
} from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { getIndentUnit, indentString } from '@codemirror/language';
import type BlockReferenceEnhancer from '../main';
import {
	collectHiddenLogseqPropertyLineNumbers,
} from '../services/LogseqPropertyMatcher';
import { isDomNode } from '../utils/dom';

const PROPERTY_HIDE_DOC_SCAN_DEBOUNCE_MS = 220;
const PROPERTY_HIDE_VIEWPORT_SCAN_DEBOUNCE_MS = 100;
const PROPERTY_HIDE_VISIBLE_MARGIN_LINES = 10;
const UNORDERED_LIST_LINE_REGEX = /^\s*-\s+/;
const UNORDERED_LIST_INSERTION_PREFIX_REGEX = /^(\s*-\s+(?:\[[ xX-]\]\s+)?)/;
const FENCE_REGEX = /^\s{0,3}(`{3,}|~{3,})/;

interface FenceState {
	char: '`' | '~';
	length: number;
}

interface VisibleLineRange {
	fromLine: number;
	toLine: number;
}

interface UnorderedListLineInfo {
	indentColumns: number;
	contentIndentColumns: number;
	insertionPrefix: string;
	leadingWhitespace: string;
	hasContent: boolean;
}

interface HiddenPropertyAwareEnterTarget {
	replaceFrom: number;
	replaceTo: number;
	replaceText: string;
	selectionHead: number;
}

function getVisibleLineRanges(view: EditorView): VisibleLineRange[] {
	const doc = view.state.doc;
	const sourceRanges = view.visibleRanges.length > 0 ? view.visibleRanges : [view.viewport];

	return sourceRanges.map((range) => {
		const fromLine = Math.max(1, doc.lineAt(range.from).number - PROPERTY_HIDE_VISIBLE_MARGIN_LINES);
		const toLine = Math.min(doc.lines, doc.lineAt(Math.max(range.from, range.to - 1)).number + PROPERTY_HIDE_VISIBLE_MARGIN_LINES);
		return { fromLine, toLine };
	});
}

function isLineVisible(lineNumber: number, visibleRanges: VisibleLineRange[]): boolean {
	for (const range of visibleRanges) {
		if (lineNumber >= range.fromLine && lineNumber <= range.toLine) {
			return true;
		}
	}

	return false;
}

export function createLogseqPropertyHidePlugin(plugin: BlockReferenceEnhancer): Extension {
	const propertyHideViewPlugin = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet = Decoration.none;

			private readonly settingsChangedRef: EventRef;
			private readonly handleDocumentKeydown = (event: KeyboardEvent) => {
				this.handleHiddenPropertyAwareEnter(event);
			};
			private refreshTimer: number | null = null;
			private analyzedDocFingerprint = '';
			private decorationsFingerprint = '';
			private hiddenLineNumbers: number[] = [];

			constructor(private readonly view: EditorView) {
				this.settingsChangedRef = plugin.onLogseqPropertySettingsChanged(() => {
					this.analyzedDocFingerprint = '';
					this.decorationsFingerprint = '';
					this.scheduleRefresh(PROPERTY_HIDE_DOC_SCAN_DEBOUNCE_MS);
				});

				this.view.contentDOM.ownerDocument.addEventListener('keydown', this.handleDocumentKeydown, true);
				this.scheduleRefresh(PROPERTY_HIDE_VIEWPORT_SCAN_DEBOUNCE_MS);
			}

			update(update: ViewUpdate) {
				if (update.docChanged) {
					this.decorations = this.decorations.map(update.changes);
					this.analyzedDocFingerprint = '';
					this.scheduleRefresh(PROPERTY_HIDE_DOC_SCAN_DEBOUNCE_MS);
					return;
				}

				if (update.viewportChanged || update.focusChanged) {
					this.scheduleRefresh(PROPERTY_HIDE_VIEWPORT_SCAN_DEBOUNCE_MS);
				}
			}

			destroy() {
				if (this.refreshTimer !== null) {
					window.clearTimeout(this.refreshTimer);
				}

				this.view.contentDOM.ownerDocument.removeEventListener('keydown', this.handleDocumentKeydown, true);
				plugin.offLogseqPropertySettingsChanged(this.settingsChangedRef);
			}

			private scheduleRefresh(delayMs: number) {
				if (this.refreshTimer !== null) {
					window.clearTimeout(this.refreshTimer);
				}

				this.refreshTimer = window.setTimeout(() => {
					this.refreshTimer = null;
					this.refreshDecorations();
				}, delayMs);
			}

			private refreshDecorations() {
				if (!plugin.shouldHideLogseqProperties()) {
					if (this.decorations !== Decoration.none) {
						this.decorations = Decoration.none;
						this.decorationsFingerprint = 'disabled';
						this.view.dispatch({});
					}
					return;
				}

				this.ensureHiddenLineNumbers();
				const visibleRanges = getVisibleLineRanges(this.view);
				const builder = new RangeSetBuilder<Decoration>();
				const fingerprintParts: string[] = [
					String(plugin.getLogseqPropertySettingsRevision()),
					String(this.view.state.doc.length),
					visibleRanges.map((range) => `${range.fromLine}-${range.toLine}`).join('|'),
				];

				for (const lineNumber of this.hiddenLineNumbers) {
					if (!isLineVisible(lineNumber, visibleRanges) || lineNumber > this.view.state.doc.lines) {
						continue;
					}

					const line = this.view.state.doc.line(lineNumber);
					fingerprintParts.push(String(lineNumber));
					builder.add(
						line.from,
						line.from,
						Decoration.line({
							attributes: {
								class: 'block-reference-hidden-logseq-property',
							},
						}),
					);
				}

				const nextFingerprint = fingerprintParts.join(':');
				if (nextFingerprint === this.decorationsFingerprint) {
					return;
				}

				this.decorationsFingerprint = nextFingerprint;
				this.decorations = builder.finish();
				this.view.dispatch({});
			}

			private ensureHiddenLineNumbers() {
				const matcher = plugin.getHiddenLogseqPropertyMatcher();
				const docFingerprint = `${plugin.getLogseqPropertySettingsRevision()}:${this.view.state.doc.length}:${this.view.state.doc.lines}`;
				if (docFingerprint === this.analyzedDocFingerprint) {
					return;
				}

				this.analyzedDocFingerprint = docFingerprint;
				this.hiddenLineNumbers = Array.from(
					collectHiddenLogseqPropertyLineNumbers(this.view.state.doc.toString(), matcher),
				).sort((left, right) => left - right);
			}

			private handleHiddenPropertyAwareEnter(event: KeyboardEvent) {
				if (
					event.defaultPrevented
					|| !plugin.shouldHideLogseqProperties()
					|| event.key !== 'Enter'
					|| event.shiftKey
					|| event.ctrlKey
					|| event.altKey
					|| event.metaKey
					|| event.isComposing
				) {
					return;
				}

				if (!isDomNode(event.target) || !this.view.contentDOM.contains(event.target)) {
					return;
				}

				const selection = this.view.state.selection;
				if (selection.ranges.length !== 1 || !selection.main.empty) {
					return;
				}

				const cursor = selection.main.head;
				const line = this.view.state.doc.lineAt(cursor);
				const currentLineInfo = parseUnorderedListLineInfo(line.text, this.view.state.tabSize);
				if (!currentLineInfo || !currentLineInfo.hasContent) {
					return;
				}

				const lineBodyFrom = line.from + currentLineInfo.insertionPrefix.length;
				if (cursor < lineBodyFrom || cursor > line.to) {
					return;
				}

				const target = resolveHiddenPropertyAwareEnterTarget(
					this.view.state,
					line,
					currentLineInfo,
					cursor,
				);
				if (!target) {
					return;
				}

				event.preventDefault();
				event.stopImmediatePropagation();

				this.view.dispatch({
					changes: {
						from: target.replaceFrom,
						to: target.replaceTo,
						insert: target.replaceText,
					},
					selection: EditorSelection.cursor(target.selectionHead),
					scrollIntoView: true,
					userEvent: 'input.type',
				});
			}
		},
		{
			decorations: (value) => value.decorations,
		},
	);

	return [propertyHideViewPlugin];
}

function resolveHiddenPropertyAwareEnterTarget(
	state: EditorState,
	currentLine: Line,
	currentLineInfo: UnorderedListLineInfo,
	cursor: number,
): HiddenPropertyAwareEnterTarget | null {
	const doc = state.doc;
	const tabSize = state.tabSize;
	const currentListIndentColumns = currentLineInfo.indentColumns;
	const continuationIndentColumns = currentLineInfo.contentIndentColumns;

	let fenceState: FenceState | null = null;
	let insertFrom = doc.length;
	let childInsertionPrefix: string | null = null;

	for (let lineNumber = currentLine.number + 1; lineNumber <= doc.lines; lineNumber++) {
		const line = doc.line(lineNumber);
		const lineText = line.text;

		if (fenceState) {
			if (isClosingFence(lineText, fenceState)) {
				fenceState = null;
			}
			continue;
		}

		if (lineText.trim().length === 0) {
			continue;
		}

		const listLineInfo = parseUnorderedListLineInfo(lineText, tabSize);
		if (listLineInfo) {
			if (listLineInfo.indentColumns > currentListIndentColumns) {
				insertFrom = line.from;
				childInsertionPrefix = listLineInfo.insertionPrefix;
				break;
			}

			insertFrom = line.from;
			break;
		}

		const lineIndentColumns = countColumn(lineText.match(/^(\s*)/)?.[1] ?? '', tabSize);
		const nextFenceState = getFenceState(lineText);
		if (nextFenceState && lineIndentColumns >= continuationIndentColumns) {
			fenceState = nextFenceState;
			continue;
		}

		if (lineIndentColumns >= continuationIndentColumns) {
			continue;
		}

		insertFrom = line.from;
		break;
	}

	if (childInsertionPrefix === null) {
		childInsertionPrefix = buildChildInsertionPrefix(currentLineInfo.leadingWhitespace, state);
	}

	const suffixText = doc.sliceString(cursor, currentLine.to);
	const preservedTail = doc.sliceString(currentLine.to, insertFrom);
	const beforeChildNewline = preservedTail.endsWith('\n') ? '' : '\n';
	const afterChildNewline = insertFrom < doc.length ? '\n' : '';
	const replaceText = `${preservedTail}${beforeChildNewline}${childInsertionPrefix}${suffixText}${afterChildNewline}`;
	const selectionHead = cursor + preservedTail.length + beforeChildNewline.length + childInsertionPrefix.length;

	return {
		replaceFrom: cursor,
		replaceTo: insertFrom,
		replaceText,
		selectionHead,
	};
}

function parseUnorderedListLineInfo(lineText: string, tabSize: number): UnorderedListLineInfo | null {
	if (!UNORDERED_LIST_LINE_REGEX.test(lineText)) {
		return null;
	}

	const insertionPrefixMatch = lineText.match(UNORDERED_LIST_INSERTION_PREFIX_REGEX);
	if (!insertionPrefixMatch) {
		return null;
	}

	const insertionPrefix = insertionPrefixMatch[1];
	const indentation = lineText.match(/^(\s*)/)?.[1] ?? '';
	return {
		indentColumns: countColumn(indentation, tabSize),
		contentIndentColumns: countColumn(insertionPrefix, tabSize),
		insertionPrefix,
		leadingWhitespace: indentation,
		hasContent: lineText.slice(insertionPrefix.length).trim().length > 0,
	};
}

function buildChildInsertionPrefix(parentLeadingWhitespace: string, state: EditorState): string {
	const unit = indentString(state, getIndentUnit(state)) || '\t';
	return `${parentLeadingWhitespace}${unit}- `;
}

function getFenceState(line: string): FenceState | null {
	const match = line.match(FENCE_REGEX);
	if (!match) {
		return null;
	}

	const marker = match[1];
	return {
		char: marker[0] as FenceState['char'],
		length: marker.length,
	};
}

function isClosingFence(line: string, fenceState: FenceState): boolean {
	const closingRegex = new RegExp(`^\\s{0,3}${fenceState.char}{${fenceState.length},}\\s*$`);
	return closingRegex.test(line);
}
