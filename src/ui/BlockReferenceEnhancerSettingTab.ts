import { App, PluginSettingTab, Setting } from 'obsidian';
import type BlockReferenceEnhancer from '../main';
import { DEFAULT_HIDDEN_LOGSEQ_PROPERTY_KEYS } from '../services/LogseqPropertyMatcher';

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
		containerEl.createEl('h2', { text: 'Block Reference Enhancer' });

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
			.setDesc(this.createRulesDescription())
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
				textArea.inputEl.style.width = '100%';
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

	private createRulesDescription(): DocumentFragment {
		const fragment = document.createDocumentFragment();
		fragment.append('Use ');
		fragment.appendChild(this.createInlineCode('\\\\'));
		fragment.append(' as the separator between rules.');
		fragment.appendChild(document.createElement('br'));
		fragment.append('Examples in notes: ');
		fragment.appendChild(this.createInlineCode('hl:: value'));
		fragment.append(' hides only the exact key ');
		fragment.appendChild(this.createInlineCode('hl'));
		fragment.append('. ');
		fragment.appendChild(this.createInlineCode('hl-*:: value'));
		fragment.append(' hides any key that starts with ');
		fragment.appendChild(this.createInlineCode('hl-'));
		fragment.append('. In the setting box, write only the key rules themselves, for example ');
		fragment.appendChild(this.createInlineCode('collapsed\\\\id\\\\hl-*'));
		fragment.append('.');
		return fragment;
	}

	private createInlineCode(text: string): HTMLElement {
		const code = document.createElement('code');
		code.textContent = text;
		return code;
	}
}
