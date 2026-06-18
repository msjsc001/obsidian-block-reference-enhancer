# Block Reference Enhancer

[中文说明](./README.md)

An Obsidian plugin for rendering UUID-based block references and block embeds in Obsidian, with compatibility for common Logseq-style outline syntax.

The current release is best understood as a viewer:
- Normal block references `((uuid))` are shown as inline summaries in Reading Mode and Live Preview.
- Block embeds `{{embed ((uuid))}}` render full block content and children in Reading Mode and Live Preview.
- The original Markdown is not rewritten.
- The plugin maintains its own block index instead of relying on Obsidian's search index.

## What it currently does

- View normal block references `((uuid))`
- View block embeds `{{embed ((uuid))}}`
- Trigger block autocomplete by typing `((`
- Copy the current block reference with a command
- Scan the vault, build an index, and use a local cache
- Keep index phase and summary information visible in the status bar
- Rebuild the block index manually with a command
- Keep showing cached content when a source block disappears but references still exist
- Review missing source blocks and recover them

## Manual install

1. Open your vault folder
2. Go to `.obsidian/plugins/`
3. Create a folder named `logseq-block-ref-enhancer`
   The plugin ID still keeps this legacy value for installation and data compatibility
4. Copy these three files into it:
   - `main.js`
   - `manifest.json`
   - `styles.css`
5. Open Obsidian
6. Go to `Settings` -> `Community plugins`
7. Enable `Block Reference Enhancer`

After the plugin is enabled:
- The first full index build shows progress in the status bar
- When a cache already exists, startup still shows status-bar phases such as `loading cache`, `checking vault changes`, `reconciling`, and `ready`
- Later Markdown create/modify/delete/rename events update the index silently
- After startup indexing finishes, the status bar keeps a `ready` summary so you can confirm the plugin is done
- If you changed many files outside Obsidian, rebuilding the index manually is recommended
- If no local cache file exists, startup shows that a fresh full index build is running

### Status bar and index states

After the plugin is enabled, the status bar shows `Block index: ...` messages. This is the plugin's own block-index status, not Obsidian's search index status.

Common states:
- `Block index: loading cache...`
  The plugin is reading the local cache.
- `Block index: no cache found, building full index...`
  No usable local cache exists, so the plugin is running a first full index build.
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

## Current status

- Live Preview editor scrolling is now stable when passing block embeds, and the slow auto-scroll issue in editing mode has been fixed
- High-frequency console spam caused by repeated block lookups in editing mode has been fixed
- Reading Mode scrolling is now stable in long notes that contain many block embeds
- Live Preview is usable
- Complex list layouts and some themes may still show small visual differences in Live Preview

## Commands

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
- Inline references render the last cached summary with a stale marker
- Block embeds render the last cached content with a source-missing warning
- The review dialog lets you:
  - restore to the recovery page
  - confirm deletion
  - ignore for now

Default recovery page:

`pages/Block Recovery.md`

Recovery is intentionally routed to the recovery page instead of trying to reinsert the block at its old file path and line number. That keeps the default behavior predictable in large vaults.

## Development

```bash
npm install
npm run build
```

## Roadmap

Future versions may support assigning UUIDs directly to individual Obsidian list blocks, so block references and block embeds can be authored natively inside Obsidian.

More block-related features may also be added over time as the plugin evolves.
