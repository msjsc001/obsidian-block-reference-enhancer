# Block Reference Enhancer

Simplified Chinese documentation is available in [README.zh-CN.md](./README.zh-CN.md).

<img alt="20210606180518" src="https://github.com/user-attachments/assets/dbb64e41-f922-483f-9cf3-27916a57aa5b" />

<img alt="Screenshot" src="https://github.com/user-attachments/assets/b69b1a35-7e31-4cf2-ae20-73ce725e7046" />

<img alt="Screenshot" src="https://github.com/user-attachments/assets/bb31f1bf-5c23-4e5d-b3f3-014b64147b9f" />

Render UUID-based block references and block embeds in Obsidian, with compatibility for common Logseq-style outline syntax.

The current release is best understood as a viewer and renderer:
- Inline block references `((uuid))` are shown as summaries in Reading Mode and Live Preview.
- Block embeds `{{embed ((uuid))}}` render full block content and children in Reading Mode and Live Preview.
- Original Markdown is not rewritten.
- The plugin maintains its own block index instead of relying on Obsidian's search index.

## What It Currently Does

- View inline block references `((uuid))`
- View block embeds `{{embed ((uuid))}}`
- Show reference-count badges near source blocks with `id:: uuid`
- Open a compact reference popover from the source badge
- Trigger block autocomplete by typing `((`
- Copy the current block reference with a command
- Scan the vault, build an index, and use a local cache
- Keep index phase and summary information visible in the status bar
- Rebuild the block index manually with a command
- Keep rendering cached content when a source block disappears but references still exist
- Review missing source blocks and recover them to the recovery page

## Current Behavior

- Inline block references no longer force a line break and are rendered in a way that fits Obsidian more naturally.
- Block embeds continue to show full content and children.
- Live Preview scrolling is now stable when block embeds are present.
- Repeated editor-side refresh noise caused by block rendering has been reduced.
- Long Reading Mode pages with many embeds no longer trigger the earlier auto-scroll behavior.
- Source blocks with active references show a numeric badge in both Live Preview and Reading Mode.
- If the same UUID exists as an active source block in multiple files, each source location shows the same reference-count badge.
- Clicking the badge opens a reference panel that emphasizes file name, line number, preview text, and full path.

## Parsing Rules

The plugin is intentionally strict about what counts as a source block.

A block is indexed as a source block when:
- the source line starts with an outline list marker such as `- `
- the block has an indented property line containing `id:: uuid`

This is designed around UUID-based outline notes and common Logseq-style block structure. If the syntax is looser or uses a different block shape, the plugin may skip it on purpose.

## Manual Install

1. Open your vault folder.
2. Go to `.obsidian/plugins/`.
3. Create a folder named `logseq-block-ref-enhancer`.
   The plugin ID still keeps this legacy value for installation and local data compatibility.
4. Copy these files into it:
   - `main.js`
   - `manifest.json`
   - `styles.css`
5. Open Obsidian.
6. Go to `Settings` -> `Community plugins`.
7. Enable `Block Reference Enhancer`.

After the plugin is enabled:
- The first full index build shows progress in the status bar.
- When a cache already exists, startup still shows phases such as `loading cache`, `checking vault changes`, `reconciling`, and `ready`.
- Later Markdown create/modify/delete/rename events update the index silently.
- After startup indexing finishes, the status bar keeps a `ready` summary so you can confirm the plugin is done.
- If many files were changed outside Obsidian, rebuilding the index manually is recommended.
- If no local cache file exists, startup shows that a fresh full index build is running.

## Status Bar and Index States

After the plugin is enabled, the status bar shows `Block index: ...` messages. This is the plugin's own block-index status, not Obsidian's search index status.

Common states:
- `Block index: loading cache...`
  The plugin is reading the local cache.
- `Block index: no cache found, building full index...`
  No usable cache exists, so the plugin is running a first full index build.
- `Block index: cache loaded, checking vault changes...`
  The cache was loaded and the plugin is checking whether vault Markdown files still match it.
- `Block index: checking vault changes...`
  The plugin is checking for external changes before file-by-file reconciliation starts.
- `Block index: reconciling X/Y files | A changed | B removed`
  The plugin detected changed or removed files and is reconciling the cache against the real vault state.
- `Block index: building X/Y files | N blocks | M refs`
  A full rebuild is running, with live file/block/reference counts.
- `Block index: ready | F files | B blocks | R refs`
  Startup indexing is finished. The summary stays in the status bar so you can confirm the plugin is ready.
- `Block index: rebuild failed`
  A manual rebuild failed and should be checked in the console or retried.

Additional notes:
- Normal create/modify/delete/rename updates after startup are incremental and usually do not show persistent progress UI.
- The first startup full build shows a completion notice once it finishes.
- A manual `Rebuild block reference index` also shows a completion notice with file, block, and reference counts.
- If the status bar has stabilized on `Block index: ready ...`, the plugin has usually finished its current startup indexing work.

## Common Features

### Inline block references

Write:

```md
((xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx))
```

The plugin renders it as an inline summary of the target block's first line.

### Block embeds

Write:

```md
{{embed ((xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx))}}
```

The plugin renders the target block with its children.

### Copy current block reference

Place the cursor on an outline list block and run:

`Copy current block reference`

If the current block does not already have `id:: uuid`, the plugin adds one and copies `((uuid))` to the clipboard.

### Block autocomplete

Type:

```md
((
```

This triggers block search and autocomplete.

### Source block reference count

When a source block is referenced by `((uuid))` or `{{embed ((uuid))}}`:
- Live Preview and Reading Mode show a count badge near the source block line.
- Clicking the badge opens a reference popover.
- The popover shows file name, line number, reference type, preview text, and full path.
- Clicking a result jumps to the referenced location.

This works as a source-block backlink count entry point, not just a visual counter.

If the same file references the source block multiple times, the badge counts each reference occurrence.

If the same UUID exists as an active source block in multiple files, each source location shows the badge. Reusing the same UUID across different source blocks is still not recommended.

### Rebuild block index

Run this command from the command palette:

`Rebuild block reference index`

Use it when:
- Many Markdown files were changed by Logseq, sync tools, external editors, or git while the plugin was not running
- Some `((uuid))` references render as `[missing block]`
- Some embeds render as `Missing block`

During rebuild:
- The status bar shows indexing progress
- If rebuild succeeds, the status bar returns to `Block index: ready | ...`
- A completion notice reports file, block, and reference counts

### Review missing source blocks

Run this command from the command palette:

`Review missing source blocks`

When a source block with `id:: uuid` disappears but references still exist:
- Inline references render the last cached summary with a stale marker.
- Block embeds render the last cached content with a source-missing warning.
- The review dialog lets you:
  - restore to the recovery page
  - confirm deletion
  - ignore for now

Default recovery page:

`pages/Block Recovery.md`

Recovery is intentionally routed to the recovery page instead of trying to reinsert the block at its old file path and line number. That keeps the default behavior predictable in large vaults.

## Troubleshooting

If you see `[missing block]` or `Missing block`:
- check whether the status bar has already reached `Block index: ready`
- run `Rebuild block reference index`
- check whether the source block follows the expected `- ` plus indented `id:: uuid` shape
- use `Review missing source blocks` if the source block was removed but references still exist

## Recommended Companion Plugins

Primary recommendations:
- `Outliner`
- `Zoom`

Secondary recommendations:
- `Better Search Views`
- `PDF++`
- `Recent Files`
- `Tag Wrangler`
- `Toggle Readable line length`

## Development

```bash
npm install
npm run build
```

Build artifacts:
- `main.js`
- `manifest.json`
- `styles.css`

## Known Limitations

- The plugin is focused on UUID block reference and block embed enhancement, not on recreating the full Logseq editing experience inside Obsidian.
- Live Preview can still show small visual differences in complex lists or under heavily customized themes.
- Recovery currently defaults to the recovery page and does not try to restore the source block back into its original file and line position.

## Roadmap

Future versions may support assigning UUIDs directly to individual Obsidian list blocks, so block references and block embeds can be authored natively inside Obsidian.

Future versions may also add a plugin-provided search view for expanded block-reference and block-embed content, so searches can work against the real UUID-backed block content instead of only the raw `((uuid))` / `{{embed ((uuid))}}` syntax stored in notes.

More block-related features may also be added over time as the plugin evolves.
