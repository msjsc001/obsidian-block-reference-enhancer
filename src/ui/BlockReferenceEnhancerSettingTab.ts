import { App, PluginSettingTab, Setting } from 'obsidian';
import type BlockReferenceEnhancer from '../main';
import { DEFAULT_HIDDEN_LOGSEQ_PROPERTY_KEYS } from '../services/LogseqPropertyMatcher';
import { getDocument } from '../utils/dom';

const SETTINGS_SAVE_DEBOUNCE_MS = 250;

export class BlockReferenceEnhancerSettingTab extends PluginSettingTab {
	private saveTimer: number | null = null;

	constructor(app: App, private readonly plugin: BlockReferenceEnhancer) {
		super(app, plugin);
	}

	hide() {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();
		const doc = getDocument(containerEl);

		new Setting(containerEl)
			.setName('Property hiding')
			.setHeading();

		new Setting(containerEl)
			.setName('Hide Logseq-style property lines')
			.setDesc('Only hides matching key:: value property lines under unordered-list blocks in Obsidian. Markdown files are not modified.')
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.hideLogseqProperties)
					.onChange(async (value) => {
						this.plugin.settings.hideLogseqProperties = value;
						await this.plugin.saveSettings();
						this.display();
					});
			});

		new Setting(containerEl)
			.setName('Hidden property keys')
			.setDesc(this.createRulesDescription(doc))
			.addTextArea((textArea) => {
				textArea
					.setValue(this.plugin.settings.hiddenLogseqPropertyKeys)
					.setPlaceholder(DEFAULT_HIDDEN_LOGSEQ_PROPERTY_KEYS)
					.onChange((value) => {
						this.plugin.settings.hiddenLogseqPropertyKeys = value;
						this.scheduleSave();
					});
				textArea.inputEl.rows = 8;
				textArea.inputEl.cols = 40;
				textArea.inputEl.addClass('block-reference-hidden-property-rules-input');
				textArea.setDisabled(!this.plugin.settings.hideLogseqProperties);
			})
			.addExtraButton((button) => {
				button
					.setIcon('reset')
					.setTooltip('Reset to defaults')
					.onClick(async () => {
						this.plugin.settings.hiddenLogseqPropertyKeys = DEFAULT_HIDDEN_LOGSEQ_PROPERTY_KEYS;
						await this.plugin.saveSettings();
						this.display();
					});
				button.setDisabled(!this.plugin.settings.hideLogseqProperties);
			});

		new Setting(containerEl)
			.setName('Experimental')
			.setHeading();

		new Setting(containerEl)
			.setName('Convert pasted content to outline')
			.setDesc('Adds right-click menu actions on unordered-list blocks, including empty ones. It can paste clipboard HTML or text as child outline blocks without changing normal paste behavior.')
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.enablePasteClipboardAsOutline)
					.onChange(async (value) => {
						this.plugin.settings.enablePasteClipboardAsOutline = value;
						await this.plugin.saveSettings();
					});
			});
	}

	private scheduleSave() {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
		}

		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			void this.plugin.saveSettings();
		}, SETTINGS_SAVE_DEBOUNCE_MS);
	}

	private createRulesDescription(doc: Document): DocumentFragment {
		const fragment = doc.createDocumentFragment();
		fragment.append('Use ');
		fragment.appendChild(this.createInlineCode(doc, '\\\\'));
		fragment.append(' as the separator between rules.');
		fragment.appendChild(doc.createElement('br'));
		fragment.append('Examples in notes: ');
		fragment.appendChild(this.createInlineCode(doc, 'hl:: value'));
		fragment.append(' hides only the exact key ');
		fragment.appendChild(this.createInlineCode(doc, 'hl'));
		fragment.append('. ');
		fragment.appendChild(this.createInlineCode(doc, 'hl-*:: value'));
		fragment.append(' hides any key that starts with ');
		fragment.appendChild(this.createInlineCode(doc, 'hl-'));
		fragment.append('. In the setting box, write only the key rules themselves, for example ');
		fragment.appendChild(this.createInlineCode(doc, 'collapsed\\\\id\\\\hl-*'));
		fragment.append('.');
		return fragment;
	}

	private createInlineCode(doc: Document, text: string): HTMLElement {
		const code = doc.createElement('code');
		code.textContent = text;
		return code;
	}
}
