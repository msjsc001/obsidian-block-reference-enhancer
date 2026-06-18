# Source Reference Badge Plan

## Summary

This document records the implementation plan and final design for source block reference-count badges.

It is written so another chat window or engineer can continue this work without needing the original conversation.

## Goal

Show a small numeric badge on source blocks that have active references.

The badge belongs to the source block itself, not to the `((uuid))` or `{{embed ((uuid))}}` reference location.

## Locked Product Decisions

1. The feature must support both Live Preview and Reading Mode.
2. The first version places the badge near the end of the source block line, not in a far-right overlay column.
3. The badge opens its reference list on click.
4. The badge count represents reference occurrence count, not unique page count.
5. Large reference lists must be paginated instead of rendering every reference at once.
6. If the same UUID appears as a source block in multiple files, every source location must show the same badge count.

## Data Source

The feature is built from the plugin's existing reverse-reference index.

Relevant `IndexService` data:

- canonical source block by UUID for rendering
- source block locations by file path for badge placement
- active source block locations by UUID so duplicate source files do not overwrite each other
- source block file path and start line
- reverse reference locations from `refsById`

The badge number is derived from `getReferenceCount(id)`.

The reference list is derived from `getReferencesToBlock(id)` or a paginated equivalent.

## Intended Behavior

When a source block has one or more active references:

- show a numeric badge next to the source block
- clicking the badge opens a small reference popover
- the popover lists reference file path, line number, reference type, and a short preview of the reference line
- clicking a reference jumps to the corresponding file and location

When a source block has zero references:

- do not show a badge

## Live Preview Design

Live Preview uses a dedicated CodeMirror plugin.

Implementation shape:

1. Read the current file path from the editor view.
2. Query source blocks for that file from `IndexService`.
3. Restrict rendering to visible lines plus a small line margin.
4. Create a widget decoration at the end of each visible source block line that has a positive reference count.
5. Refresh when:
   - the visible viewport changes
   - the current document changes
   - the block index updates

Performance rule:

- do not scan or decorate the whole note on every interaction

## Reading Mode Design

Reading Mode uses the existing Markdown post-processor path.

Implementation shape:

1. Use `MarkdownPostProcessorContext.getSectionInfo()` to get the line range for the rendered section.
2. Use Obsidian `MetadataCache.listItems` to get the list-item line starts for that file section.
3. Match section `li` DOM nodes to cached list items by order.
4. Use `IndexService` source block `startLine` values to determine which `li` elements represent source blocks with active references.
5. Append the same badge element near the source block content host inside the `li`.

Duplicate-source rule:

- badge placement must come from per-file source locations, not from the single canonical UUID record
- this avoids losing badges when backup pages or generated pages contain the same UUID source block

Important limitation:

- the feature should only run on the actual file render path, not on manually rendered embedded content containers

## Popover Design

The popover is shared between Live Preview and Reading Mode.

Behavior:

- click badge to open
- click the same badge again to close
- click outside to close
- press `Escape` to close
- internal popover scrolling must not close the popover
- clicking the popover scrollbar must not close the popover
- viewport scrolling should reposition the popover instead of immediately closing it when possible

Visual structure:

- the header shows the source block summary first
- the UUID is shown in shortened form, with the full UUID available via hover title
- each reference row is split into file name, line number, preview text, and full path
- the file name is primary and the full path is secondary
- single-page results should not render a large footer just to show disabled pagination buttons
- multi-page results should use compact icon pagination controls

List behavior:

- page size: 20 references
- show previous / next controls
- load only the current page's preview lines
- preview text comes from the reference line in the target file

## Jump Behavior

Clicking a reference item should:

1. open the target Markdown file
2. reveal the leaf
3. move the editor cursor to the reference line and character
4. scroll the editor so the target position is visible

## Update Rules

The badge number and list content must refresh after:

- file create
- file modify
- file delete
- file rename
- manual rebuild
- recovery of stale blocks

Live Preview listens to index updates directly.

Reading Mode refreshes through the plugin's existing preview rerender flow after index updates.

## Performance Rules

1. Live Preview only processes visible source blocks plus a small margin.
2. Reading Mode does not pre-render all reference previews.
3. Large reference sets must use pagination.
4. Preview line text can be cached by file path and mtime.
5. Zero-reference source blocks do not create DOM noise.

## Test Checklist

1. Verify badge rendering in Live Preview.
2. Verify badge rendering in Reading Mode.
3. Verify click-to-open popover.
4. Verify pagination when references exceed 20.
5. Verify click-to-jump behavior.
6. Verify counts update after add / modify / delete / rename.
7. Verify manual rebuild refreshes badges.
8. Verify large pages stay responsive.
9. Verify the same UUID source badge appears in every file that contains that source block.
10. Verify long file paths wrap correctly inside the popover.
11. Verify clicking or dragging the popover scrollbar does not dismiss the popover.
