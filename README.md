# Block Reference Enhancer

简体中文版文档见 [README.zh-CN.md](https://github.com/msjsc001/obsidian-block-reference-enhancer/blob/main/README.zh-CN.md)。

The plugin supports low-granularity block references and block embeds inside Obsidian, and it also makes UUID-based block references and block embeds readable, clickable, and usable in Obsidian, while staying compatible with Logseq-style block reference and block embed syntax for rendering and use.

<img alt="图片" src="https://github.com/user-attachments/assets/9aca75b9-056a-4a7e-bb62-6562f93deb03" />

It is a display enhancer and renderer, and it also builds a local block index and automatically tracks additions, removals, and changes for block references and block embeds:
- `((uuid))` is shown as an inline summary.
- `{{embed ((uuid))}}` is shown as a full block embed with children.
- Original Markdown is not rewritten.
- The plugin maintains its own local block index instead of relying on Obsidian search indexing.

> [!NOTE]
> Plugin display name: `Block Reference Enhancer`  
> Plugin ID and install folder: `block-reference-enhancer`  
> The GitHub repository keeps the `obsidian-` prefix only as a repository name.

## ✨ What It Does

If your notes already use UUID-style blocks, this plugin makes them readable inside Obsidian without forcing you to rewrite your notes.

You get:
- Inline summaries for `((uuid))`
- Full embeds for `{{embed ((uuid))}}`
- A hover-only `Back` button that jumps references and embeds to their source blocks
- Reference-count badges next to source blocks
- A compact popover that shows where a block is referenced
- Block autocomplete when typing `((`
- Commands and editor context menu actions to copy the current block reference or block embed
- A local cache and block index for large vaults

## 👀 Best For

- Users migrating from Logseq-style UUID notes
- Outline-heavy Markdown vaults
- Large vaults where source blocks and references need stable rendering
- Users who want block references and embeds to stay readable in both Live Preview and Reading Mode

<img alt="截图" src="https://github.com/user-attachments/assets/dbb64e41-f922-483f-9cf3-27916a57aa5b" />

<img alt="20210606180518-2" src="https://github.com/user-attachments/assets/cedf92bf-a82b-4a35-bca5-9dd689fb3384" />

<img alt="截图" src="https://github.com/user-attachments/assets/b69b1a35-7e31-4cf2-ae20-73ce725e7046" />

<img alt="图片" src="https://github.com/user-attachments/assets/9b50225a-00ce-4078-850b-89b8397be095" />

## 🚀 Install

### Community plugin install

1. Open `Settings` -> `Community plugins`.
2. Search for `Block Reference Enhancer`.
3. Install it.
4. Enable it.

### Manual install

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest GitHub release.
2. Open your vault folder.
3. Go to `.obsidian/plugins/`.
4. Create a folder named `block-reference-enhancer`.
5. Copy the three files into that folder.
6. Enable `Block Reference Enhancer` in Obsidian.

## 📝 Raw Syntax Used in Notes

### Source block

```md
- Opportunity cost
  id:: 68a92328-da50-46cc-aa45-73dec00ca8ce
```

### Inline block reference

```md
((68a92328-da50-46cc-aa45-73dec00ca8ce))
```

### Block embed

```md
{{embed ((68a92328-da50-46cc-aa45-73dec00ca8ce))}}
```

## 🎯 Effects After Enabling the Plugin

### Inline references

`((uuid))` is rendered as a short summary of the target block's first line.

Hover, focus, or click the rendered reference to keep a small `Back` button visible and jump to the source block.

### Block embeds

`{{embed ((uuid))}}` is rendered as the target block plus its children.

Hover, focus, or click the rendered embed to keep the same `Back` button visible and jump to the source block.

### Source badges

When a source block is referenced, the plugin shows a numeric badge beside the source block in:
- Live Preview
- Reading Mode

Clicking the badge opens a compact reference popover with:
- file name
- line number
- reference type
- preview text
- full path

If the same UUID exists as an active source block in multiple files, each active source location shows the same reference-count badge.

## 🧭 Useful Commands

### `((` autocomplete

Type:

```md
((
```

This opens block autocomplete.

It only searches blocks that have already been established as source blocks. This restriction is intentional for long-term vault performance.

If a needed block has not been established as a source block yet, you can first use normal Obsidian search to find the right place, then add a source block in the expected outline form.

Open the Obsidian command palette with:
- `Ctrl/Cmd + P`

### `Copy current block reference`

Place the cursor on an outline block and run the command.

If the block does not already have `id:: uuid`, the plugin adds one and copies `((uuid))` to the clipboard. If the block already has `id:: uuid`, the plugin reuses the existing ID instead of generating a new one.

You can also right-click the current outline block in the editor and use:
- `Copy block reference`

### `Copy current block embed`

Place the cursor on an outline block and run the command.

If the block does not already have `id:: uuid`, the plugin adds one and copies `{{embed ((uuid))}}` to the clipboard. If the block already has `id:: uuid`, the plugin reuses the existing ID instead of generating a new one.

You can also right-click the current outline block in the editor and use:
- `Copy block embed`

### `Rebuild block reference index`

Use this when:
- many Markdown files changed outside Obsidian
- some references render as `[missing block]`
- some embeds render as `Missing block`

### `Review missing source blocks`

Use this when a source block disappeared but references still exist.

The review dialog lets you:
- restore the cached source to the recovery page
- confirm deletion
- ignore it for now

Default recovery page:

`pages/Block Recovery.md`

## 📦 First Launch and Indexing

The plugin builds and maintains its own block index. This is separate from Obsidian's built-in search index.

On first launch, watch the status bar for `Block index: ...`.

Common states:
- `loading cache...` means the plugin is reading its local cache.
- `no cache found, building full index...` means a first full build is running.
- `cache loaded, checking vault changes...` means cached data was found and is being validated.
- `reconciling X/Y files ...` means changed or removed files are being compared against the cache.
- `ready | F files | B blocks | R refs` means startup indexing is complete.

Normal create, modify, delete, and rename updates after startup are incremental and usually happen silently.

## 🛟 Safety: What Happens When a Source Block Goes Missing

If a source block disappears but references still exist:
- inline references keep showing the last cached summary
- embeds keep showing the last cached content
- the plugin marks the content as stale

Recovery is intentionally sent to the recovery page instead of trying to reinsert the block back into its old file path and old line number. That default is safer and more predictable in large vaults.

## 🔎 Troubleshooting

If you see `[missing block]` or `Missing block`:
- wait until the status bar reaches `Block index: ready`
- run `Rebuild block reference index`
- check whether the source block follows the expected outline syntax
- use `Review missing source blocks` if the source content was actually removed

If you changed many files through Logseq, sync tools, git, or external editors while the plugin was not running, a manual rebuild is recommended.

## 📐 Parsing Rules

The plugin is intentionally strict about what counts as a source block.

A block is indexed as a source block when:
- the source line starts with an outline list marker such as `- `
- the block has an indented property line containing `id:: uuid`

This strictness is deliberate. It keeps UUID-based outline notes predictable and prevents loose Markdown from being indexed as the wrong block.

## 🧩 Recommended Companion Plugins

Primary recommendations:
- `Outliner`
- `Zoom`

Secondary recommendations:
- `Better Search Views`
- `PDF++`
- `Recent Files`
- `Tag Wrangler`
- `Toggle Readable line length`

## ⚠️ Known Limitations

- This plugin is a UUID block reference and block embed syntax enhancer, not a Logseq replacement.
- Live Preview can still show small visual differences in very complex lists or under heavily customized themes.
- When a source block is missing, recovery defaults to the recovery page instead of restoring the block back into its original file and line position.

## 🛠 Development

```bash
npm install
npm run build
```

Build artifacts:
- `main.js`
- `manifest.json`
- `styles.css`

Release notes:
- GitHub releases should attach `main.js`, `manifest.json`, and `styles.css`.
- Community-plugin releases should use an exact numeric tag such as `1.1.3`, without a `v` prefix.
- Release notes should be written for each GitHub release.

## 🔒 Privacy

- The plugin runs locally inside Obsidian.
- It does not send your notes, UUIDs, or index data over the network.
- It does not include telemetry, ads, or account-gated behavior.
- Its block index cache is stored through Obsidian's plugin data storage.

## 🗺 Roadmap

Planned directions include:
- right-click source creation for block references and embeds: let native Obsidian unordered list blocks support right-click creation of source IDs with `id:: uuid`
- search feature: provide a plugin search view that searches real block content instead of only the raw `((uuid))` syntax
- more block-oriented workflows built on the current index and cache foundation
