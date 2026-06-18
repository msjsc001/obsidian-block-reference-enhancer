# Indexing and Missing Block Recovery Plan

## Purpose

This document records the plan for fixing missing block references and missing block embeds in the Block Reference Enhancer plugin.

The plan is written so that a new chat window or another coding AI can continue the work without needing the original discussion.

## Locked Product Decisions

The following decisions were confirmed after implementation planning and should be treated as fixed unless explicitly changed later:

1. Source block recovery defaults to the dedicated recovery page only.
2. The recovery page path is `pages/Block Recovery.md`.
3. The plugin should not try to restore missing source blocks back into the original file by default.
4. Delete-interception or pre-delete confirmation is out of scope.
5. Protection is handled through stale fallback rendering, review tooling, and recovery.

## Implementation Status Snapshot

Status date:

- 2026-06-18

Already implemented in the current codebase:

1. Automatic indexing on plugin activation.
   - The plugin loads persisted cache on startup.
   - If no usable cache exists, it performs a full rebuild.
   - If cache exists, it reconciles the vault in the background by checking Markdown file metadata.

2. Runtime incremental updates.
   - Markdown create, modify, delete, and rename events are monitored while the plugin is active.
   - Incremental reparse is used for changed files instead of full rebuilds.

3. Manual rebuild with visible progress.
   - `Rebuild block reference index` is exposed as a user-facing command.
   - Rebuild progress is shown in the status bar.
   - Completion notice reports file, block, and reference counts.

4. Reverse reference indexing.
   - The index stores both source blocks and per-UUID reference locations.
   - The plugin can count references to a missing source block and review stale UUIDs safely.

5. Stale block fallback rendering.
   - If a previously indexed source block disappears but references remain, the block is marked `stale`.
   - Inline references render cached summary text instead of immediately degrading to `[missing block]`.
   - Block embeds render cached content with a visible missing-source warning.

6. Recovery workflow aligned to product decision.
   - Missing source recovery goes to `pages/Block Recovery.md` only.
   - The plugin does not try to restore back to original file path and original line number by default.
   - Recovery preserves the original UUID so existing references can resolve again after reindex.

7. Review UI for stale blocks.
   - `Review missing source blocks` is implemented.
   - The dialog supports: recover to recovery page, confirm deletion, ignore for now.

8. Parser behavior remains outline-oriented and UUID-property based.
   - Source blocks are still based on unordered list items.
   - `id:: uuid` is still required as a UUID-style block property under the source block.
   - Parsing was extended to tolerate `id::` within the indented property area instead of requiring it to be only the immediate next line.

9. Documentation has been updated.
   - `README.md` and `README.en.md` now document automatic indexing, manual rebuild, stale fallback, and recovery page behavior.

10. Startup indexing visibility has been improved.
   - Startup now exposes status-bar phases for cache loading, cache-based reconciliation, full rebuild, and ready state.
   - The status bar keeps a ready summary after startup instead of disappearing immediately.

## Background

This plugin is intended to make Obsidian understand a UUID-style outline Markdown workflow that is compatible with common Logseq note structure:

- Logseq pages are mostly outline notes made from unordered list blocks.
- A source block is a list item that looks like `- block content`.
- The block ID is stored as a soft-line block property under that list item, usually `id:: uuid`.
- Inline block references use `((uuid))`.
- Block embeds use `{{embed ((uuid))}}`.
- The plugin should render these references in Obsidian without rewriting the original Markdown.

Sample files used during discussion:

- `logseq笔记样本/pages/Logseq笔记样本.md`
- `D:/8 L-Logseq/l-phone-logseq/pages/Logseq笔记样本.md`

The sample format matches the current parser's basic assumption: source blocks are unordered list items and their UUID is stored under the block as `id:: uuid`.

## Current Problem

In larger vaults, the plugin sometimes renders:

- Inline references as `[missing block]`.
- Block embeds as `Missing block`.

The direct cause is that the renderer calls `indexService.getBlock(uuid)` and the plugin's own block index does not contain that UUID.

This is not an Obsidian core search index problem. The plugin maintains its own block index.

## Current Code Facts

Important current files:

- `src/main.ts`
  - Registers rebuild and stale-block review commands.
  - Registers Reading Mode Markdown post processor.
  - Registers Live Preview CodeMirror renderer.
  - Registers vault file listeners for create, modify, delete, and rename.
  - Shows rebuild progress in the status bar.
  - Refreshes open Markdown views after index updates.
- `src/services/IndexService.ts`
  - Maintains block records, reverse references, and per-file metadata.
  - Loads `block-cache.json` on startup.
  - Rebuilds when cache is missing or incompatible.
  - Reconciles vault changes in the background after startup.
  - Marks previously indexed missing-but-still-referenced blocks as `stale`.
  - Restores stale blocks to the recovery page.
- `src/services/BlockParser.ts`
  - Parses UUID-style unordered list blocks.
  - Parses inline references and embeds for reverse reference tracking.
  - Accepts `id:: uuid` within the indented property area under a source block.
- `src/editor/AsyncBlockRendererPlugin.ts`
  - Scans Live Preview text for references and embeds.
  - Replaces references with CodeMirror decorations.
  - Includes index revision in rerender decisions so rebuilds and stale-state changes propagate to visible editors.
- `src/ui/StaleBlockReviewModal.ts`
  - Lists stale blocks that still have active references.
  - Exposes review actions for recovery and deletion confirmation.

## Working Diagnosis

The strongest suspected causes are:

1. The plugin trusts a stale cache too much.
   If `block-cache.json` can be read, the plugin uses it without checking whether Markdown files changed while the plugin was not running.

2. File watchers only handle runtime changes.
   They do not catch changes made by Logseq, sync tools, external editors, git switching, or mobile devices while Obsidian or the plugin was closed.

3. Rebuild does not refresh visible rendering.
   Even if manual rebuild succeeds, already-rendered `[missing block]` widgets may remain until the note or editor is reloaded.

4. There is no stale-source fallback.
   If a previously indexed source block disappears but references still exist, the plugin currently degrades to `Missing block` instead of showing the last known source content.

## Product Goals

1. The plugin should automatically index after installation or activation.
2. The plugin should monitor Markdown file create, modify, delete, and rename events after activation.
3. The plugin should support a manual full rebuild command.
4. First-time indexing and manual rebuild should show progress.
5. Routine file changes should update silently without progress UI.
6. Large vaults with many Markdown files and many UUIDs should remain usable.
7. If a source block disappears but references still exist, the plugin should protect the user's knowledge instead of immediately showing `Missing block`.
8. Source block recovery should restore the source block with its original UUID, not rewrite references into plain text by default.
9. Documentation should explain automatic indexing, manual rebuild, recovery behavior, and expected limitations.

## Non-Goals

1. Do not loosen the parser so broadly that arbitrary Markdown lines become source blocks.
2. Do not depend on Obsidian's own search index for block resolution.
3. Do not automatically rewrite every `((uuid))` reference into plain text.
4. Do not make destructive edits to the user's vault without explicit confirmation.
5. Do not add delete-prevention or pre-delete confirmation to the core design.

## Proposed Index Model

The current `Map<uuid, BlockCache>` should evolve into a cache with metadata and reverse lookup structures.

Suggested in-memory structures:

```ts
interface BlockIndexCache {
  schemaVersion: number;
  builtAt: number;
  files: Record<string, FileIndexMeta>;
  blocks: Record<string, IndexedBlock>;
  refs: Record<string, BlockReferenceLocation[]>;
}

interface FileIndexMeta {
  path: string;
  mtime: number;
  size: number;
  blockIds: string[];
  referencedIds: string[];
}

interface IndexedBlock {
  id: string;
  filePath: string;
  rawContent: string;
  childrenMarkdown: string;
  startLine: number;
  endLine?: number;
  childrenIDs: string[];
  status: "active" | "stale" | "confirmed_deleted";
  firstSeenAt: number;
  lastSeenAt: number;
  lostAt?: number;
  recoveredAt?: number;
}

interface BlockReferenceLocation {
  filePath: string;
  line: number;
  ch: number;
  kind: "inline" | "embed";
}
```

Implementation can keep using `Map` internally, but the persisted cache should include enough metadata to detect stale files and missing source blocks.

## Startup Index Strategy

Recommended startup flow:

1. Load the persisted cache quickly if available.
2. Make the UI usable immediately using the loaded cache.
3. In the background, compare current Markdown files with cached `FileIndexMeta`.
4. Parse only files that are new or whose `mtime` or `size` changed.
5. Remove index entries for files that no longer exist.
6. Detect source UUIDs that disappeared from changed/deleted files.
7. If disappeared UUIDs are still referenced, mark them as `stale` and keep their last known block content.
8. Save the updated cache.
9. Notify renderers to refresh currently visible references and embeds.

This avoids full scans on every startup while still recovering from changes made while the plugin was closed.

## Manual Rebuild Strategy

The command should remain available but become user-facing.

Command name:

- `Rebuild block reference index`

Expected behavior:

1. Clear active index structures.
2. Parse all Markdown files in batches.
3. Show progress during the full rebuild.
4. Save the new cache.
5. Show a completion notice with file count and block count.
6. Trigger a rerender of open Markdown views.

Progress UI can start simple:

- Use an Obsidian `Notice` at the beginning.
- For a better implementation, create a small status bar item or modal with processed file count.
- Avoid one notice per file.

Suggested progress text:

- `Building block index: 120 / 2400 files`
- `Block index rebuilt: 2400 files, 185000 blocks`

## Runtime Watch Strategy

For routine file changes while the plugin is active:

1. On Markdown create or modify:
   - Reparse only that file.
   - Update `blocks`.
   - Update `files[filePath]`.
   - Update reverse references from that file.
   - Detect source blocks removed from that file.
   - Save cache with debounce.
2. On Markdown delete:
   - Remove the file's active source blocks from active lookup.
   - Mark removed blocks as `stale` when they are still referenced.
   - Remove references originating from that file.
   - Save cache with debounce.
3. On Markdown rename:
   - Update `filePath` for blocks and file metadata.
   - Update reference locations from old path to new path.
   - Save cache with debounce.

Routine updates should not show progress UI unless there is an error or a stale block requiring user attention.

## Stale Block Behavior

When a UUID source block was previously indexed but no longer exists:

1. If no references remain:
   - It may be marked `confirmed_deleted` or eventually pruned.
2. If references still exist:
   - Mark it as `stale`.
   - Keep the last known `rawContent`, `childrenMarkdown`, original `filePath`, and original line range.
   - Render inline references using the last known summary.
   - Render block embeds using the last known full block content.
   - Visually indicate that the source block is missing and cached content is being shown.

Suggested display labels:

- Inline: show the cached summary plus a subtle stale marker.
- Embed: show cached content and a small warning line such as `Source block missing. Showing cached content.`

This prevents immediate knowledge loss while avoiding automatic bulk edits.

## Recovery Strategy

When a stale block is detected, recovery should restore a UUID-style source block with the original UUID.

Do not default to restoring the source block at the reference location. A source UUID may be referenced by many notes, and restoring it near one reference would change the knowledge structure.

Recommended recovery behavior:

1. Restore to a dedicated recovery page.
   - Use an English page name for international compatibility.
   - Recommended page path: `pages/Block Recovery.md`.
   - Insert recovered blocks under a clear heading or top-level list section.
   - Preserve the original UUID.

2. Do not restore to the original file path and line number by default.
   - In large vaults this is too easy to get wrong semantically.
   - Predictable recovery is more important than trying to guess the old location.

3. Do not offer "restore near current reference" in the core workflow.
   - It changes note structure and can place the source block in an arbitrary reference context.

Suggested recovery block format:

```md
- Original block content
  id:: original-uuid
  recovered-from:: original/file/path.md
  recovered-at:: 2026-06-18T00:00:00.000Z
```

If `childrenMarkdown` is available, append the cached child lines under the recovered block.

Important rule:

- Recovery should restore a source block with the same UUID.
- It should not replace references with plain text unless the user explicitly chooses an export/flatten operation in the future.

## User Confirmation Strategy

Delete interception is intentionally out of scope.

Recommended behavior:

1. For external or already-applied changes:
   - Detect the missing source after the file event or startup scan.
   - Keep cached rendering.
   - Notify the user that referenced source blocks disappeared.
   - Offer actions: `Review`, `Recover`, `Confirm deletion`, `Ignore for now`.

2. Do not add editor-level pre-delete interception.
   - Recovery and stale fallback are the chosen protection path.

## Reference Indexing

To support stale detection and recovery prompts, the plugin should index references as well as source blocks.

The parser or index service should detect:

- `((uuid))`
- Full-width `（（uuid））`
- `{{embed ((uuid))}}`

For each Markdown file, store referenced UUIDs and locations.

This allows the plugin to answer:

- Is this missing source still referenced?
- Which files reference it?
- How many references will be affected?
- Can it be safely pruned?

## Rendering Refresh Plan

After index changes, open Markdown views should refresh.

Required cases:

- Manual rebuild finished.
- Startup background reconciliation found new or changed blocks.
- A stale block was restored.
- A stale block was confirmed deleted.

Possible implementation approaches:

1. Add an index revision number to `IndexService`.
2. Increment revision after meaningful index updates.
3. Let Live Preview renderer include index revision in its scan fingerprint.
4. For Reading Mode, trigger a Markdown view rerender or expose a small plugin-level event that post processors can react to.

The simplest first implementation can refresh open Markdown leaves after rebuild and recovery.

## Documentation Updates

Update both `README.md` and `README.en.md`.

Required documentation additions:

1. Explain automatic indexing.
2. Explain that the plugin uses its own block index, not Obsidian's search index.
3. Document `Rebuild block reference index`.
4. Explain when to run manual rebuild.
5. Explain large-vault behavior.
6. Explain stale source fallback and recovery page.
7. Mention the dedicated recovery page: `pages/Block Recovery.md`.
8. Explain that recovery defaults to the recovery page rather than original location restoration.

## Implementation Phases

### Phase 1: User-visible rebuild and documentation

Goal:

- Make the existing rebuild command discoverable and less confusing.

Tasks:

1. Add README documentation for `Rebuild block reference index`.
2. Add a start notice and completion notice to manual rebuild.
3. Include processed file count and block count.
4. Trigger a basic rerender of open Markdown views after rebuild.

Validation:

- Run `npm run build`.
- In Obsidian, execute the rebuild command from the command palette.
- Confirm that the user sees start and completion feedback.
- Confirm that existing missing references refresh after reopening or rerender.

### Phase 2: Cache freshness and incremental startup reconciliation

Goal:

- Stop trusting stale cache blindly.

Tasks:

1. Add cache schema version.
2. Store file metadata: path, size, mtime, block IDs, referenced IDs.
3. On startup, load cache and then reconcile Markdown files in the background.
4. Reparse only files that changed while the plugin was closed.
5. Detect deleted files and update affected source blocks.

Validation:

- Build a small test vault.
- Index it.
- Close Obsidian or simulate stale cache.
- Modify a source file externally.
- Restart plugin and confirm the changed block is detected without manual rebuild.

### Phase 3: Reverse reference index

Goal:

- Know which UUIDs are still referenced.

Tasks:

1. Parse references from each Markdown file.
2. Store `refsById` and per-file referenced IDs.
3. Update references incrementally on file changes.
4. Expose helper methods:
   - `getReferencesToBlock(id)`
   - `hasReferencesToBlock(id)`
   - `getReferenceCount(id)`

Validation:

- Source blocks and references from sample files are indexed correctly.
- Removing a reference updates the reference count.
- Deleting a file removes references from that file.

### Phase 4: Stale block fallback rendering

Goal:

- Replace `Missing block` with cached content when the source block used to exist.

Tasks:

1. Add `status` to indexed blocks.
2. Preserve last known source content for missing but referenced blocks.
3. Update inline rendering:
   - Active block: normal summary.
   - Stale block: cached summary with stale state.
   - Never-seen UUID: `[missing block]`.
4. Update embed rendering:
   - Active block: normal embed.
   - Stale block: cached embed with warning.
   - Never-seen UUID: `Missing block`.
5. Add CSS for stale block markers.

Validation:

- Delete a source block that is still referenced.
- Confirm inline and embed references show cached content.
- Confirm a truly unknown UUID still shows missing.

### Phase 5: Recovery actions

Goal:

- Let users restore missing source blocks safely.

Tasks:

1. Add recovery method in `IndexService` or a dedicated service:
   - `recoverBlockToRecoveryPage(id)`
2. Use `pages/Block Recovery.md` as the default recovery page.
3. Restore the source block with original UUID.
4. Preserve metadata:
   - `recovered-from::`
   - `recovered-at::`
5. Reindex after recovery.
6. Rerender open views.

Validation:

- Delete a source block.
- Recover it to recovery page.
- Confirm all references resolve using the original UUID.

### Phase 6: Review UI for stale blocks

Goal:

- Give users a manageable way to handle stale blocks in large vaults.

Tasks:

1. Add command: `Review missing source blocks`.
2. Show stale block list with:
   - UUID
   - Cached summary
   - Original file path
   - Reference count
   - Actions: recover, confirm deletion, ignore
3. Avoid showing repeated notices for the same stale block.

Validation:

- Create multiple stale blocks.
- Confirm review command lists them.
- Confirm actions update cache and rendering.

## Performance Considerations

Large vault support requires avoiding unnecessary full scans.

Guidelines:

1. Use per-file metadata to detect changes.
2. Reparse only changed files during startup reconciliation.
3. Batch long-running scans and yield to the UI thread.
4. Debounce cache writes.
5. Avoid scanning rendered DOM when a text-level scan is enough.
6. Keep reverse reference structures compact.
7. Consider limiting expensive UI updates during bulk indexing.

Potential future optimization:

- Use content hash only when `mtime` or `size` is unreliable.
- Use separate cache files if `block-cache.json` becomes too large.
- Add lightweight telemetry counters in development logs, not user-facing logs.

## Safety Considerations

1. Never auto-delete cached blocks just because the source disappeared once.
2. Never bulk-rewrite references into plain text by default.
3. Before writing recovery content, check that the target file path is inside the vault.
4. Do not overwrite existing recovery page content.
5. Use append-only recovery insertion unless the user explicitly chooses a precise original-location recovery.
6. Preserve the original UUID during recovery.
7. Show clear user confirmation for destructive actions such as confirming deletion of a stale block.

## Remaining Risks And Follow-up Checks

These are the main remaining areas worth validating in a real large vault:

1. Large-vault startup cost.
   - Background reconciliation is incremental, but the user should still verify the first startup experience in a vault with many Markdown files and many UUIDs.

2. Cache file growth.
   - `block-cache.json` now stores file metadata, source blocks, and reverse references.
   - If the vault is extremely large, cache size and save frequency may need another optimization pass later.

3. Recovery page organization.
   - The current design intentionally favors safety and predictability over perfect information architecture.
   - If the recovery page becomes crowded, future work may group recovered entries by date or original file path.

4. Stale retention policy.
   - `confirmed_deleted` records currently remain in cache.
   - A future pruning policy may be useful, but it should be added carefully to avoid accidental data loss.

5. Parser boundary discipline.
   - The parser must stay strict enough to match the supported UUID-style outline blocks and avoid over-parsing arbitrary Markdown.
   - Any future syntax expansion should be tested against real Logseq notes first.

## Recommended Next Validation

The next practical validation target is a real large Logseq-origin or UUID-outline vault:

1. Enable the plugin and let startup indexing or reconciliation finish.
2. Verify that existing `((uuid))` and `{{embed ((uuid))}}` references resolve without a manual rebuild.
3. Externally modify or delete a source block, then reopen or rescan the vault.
4. Confirm that:
   - stale fallback rendering appears instead of immediate missing output
   - `Review missing source blocks` lists the affected UUID
   - recovery to `pages/Block Recovery.md` restores reference resolution
