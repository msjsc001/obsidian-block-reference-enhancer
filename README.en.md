# Obsidian Logseq Block Enhancer

[中文说明](./README.md)

An Obsidian plugin for viewing Logseq-style block references and block embeds.

The current release is best understood as a viewer:
- Normal block references `((uuid))` are shown as inline summaries in Reading Mode and Live Preview.
- Block embeds `{{embed ((uuid))}}` render full block content and children in Reading Mode and Live Preview.
- The original Markdown is not rewritten.

## What it currently does

- View normal block references `((uuid))`
- View block embeds `{{embed ((uuid))}}`
- Trigger block autocomplete by typing `((`
- Copy the current block's Logseq reference with a command
- Scan the vault, build an index, and use a local cache

## Manual install

1. Open your vault folder
2. Go to `.obsidian/plugins/`
3. Create a folder named `logseq-block-ref-enhancer`
4. Copy these three files into it:
   - `main.js`
   - `manifest.json`
   - `styles.css`
5. Open Obsidian
6. Go to `Settings` -> `Community plugins`
7. Enable `Logseq Block Ref Enhancer`

## Current status

- Live Preview editor scrolling is now stable when passing block embeds, and the slow auto-scroll issue in editing mode has been fixed
- High-frequency console spam caused by repeated block lookups in editing mode has been fixed
- Reading Mode scrolling is now stable in long notes that contain many block embeds
- Live Preview is usable
- Complex list layouts and some themes may still show small visual differences in Live Preview

## Development

```bash
npm install
npm run build
```

## Roadmap

Future versions may support assigning UUIDs directly to individual Obsidian list blocks, so block references and block embeds can be authored natively inside Obsidian.

More block-related features may also be added over time as the plugin evolves.
