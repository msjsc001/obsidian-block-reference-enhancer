import { EventRef } from 'obsidian';
import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import type BlockReferenceEnhancer from '../main';
import { collectHiddenLogseqPropertyLineNumbers } from '../services/LogseqPropertyMatcher';

const PROPERTY_HIDE_DOC_SCAN_DEBOUNCE_MS = 220;
const PROPERTY_HIDE_VIEWPORT_SCAN_DEBOUNCE_MS = 100;
const PROPERTY_HIDE_VISIBLE_MARGIN_LINES = 10;

interface VisibleLineRange {
	fromLine: number;
	toLine: number;
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

export function createLogseqPropertyHidePlugin(plugin: BlockReferenceEnhancer) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet = Decoration.none;

			private readonly settingsChangedRef: EventRef;
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

				this.scheduleRefresh(PROPERTY_HIDE_VIEWPORT_SCAN_DEBOUNCE_MS);
			}

			update(update: ViewUpdate) {
				if (update.docChanged) {
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
		},
		{
			decorations: (value) => value.decorations,
		},
	);
}
