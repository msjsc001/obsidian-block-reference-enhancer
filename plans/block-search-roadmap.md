# Block Search Roadmap

## Status

Priority: low

This document is only a high-level roadmap note for future work. It is not part of the current implementation plan.

## Goal

Add a plugin-provided search experience for UUID-based block references and block embeds in Obsidian.

The purpose is to let users search against expanded block content, instead of only matching the raw `((uuid))` and `{{embed ((uuid))}}` syntax stored in Markdown files.

## Planned Direction

The search feature should be built on top of the plugin's own block index.

The existing index already contains:

- source block content by UUID
- source block file path and line information
- reference locations for each UUID

That makes it possible to build search results from indexed block data without reparsing the whole vault for every query.

## Intended User Experience

The future feature should provide a plugin command that opens a dedicated search view or search modal.

Users should be able to:

- enter a text query
- search expanded source block content
- search inline block reference content as resolved text
- search block embed content as resolved block content
- open the matching file and jump to the relevant source block or reference location

## Result Types

The search model should support at least these result categories:

- source block match
- inline reference match
- block embed match

Each result should carry enough metadata to show:

- matched text preview
- file path
- line number
- UUID
- result type

## Rough Technical Shape

The first version should reuse `IndexService` data and add a search-oriented layer above it.

Possible structure:

1. Build a search document for each indexed source block.
2. Build search entries for reference locations using the UUID they point to.
3. Resolve the displayed searchable text from the indexed block content.
4. Run text matching against those search entries.
5. Return ranked results with jump metadata.

The first search implementation can stay simple and use straightforward text matching before later upgrades such as filtering and ranking improvements.

## Likely First Scope

The first implementation should focus on:

- dedicated plugin search command
- dedicated search UI
- block-content-based matching
- result click-to-jump behavior

## Future Expansion

After the first version is stable, the feature can be expanded with:

- result filters by source block / inline reference / block embed
- path-based filtering
- stale block visibility control
- better ranking and preview snippets

