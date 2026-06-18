# Obsidian Community Submission Plan

## Goal

Submit `Block Reference Enhancer` to the official Obsidian community plugin directory without regressing the current UUID block reference and block embed features.

## Current State

- Repository default branch is `main`.
- Plugin repository is `msjsc001/obsidian-block-reference-enhancer`.
- Manifest ID is `block-reference-enhancer`.
- Display name is `Block Reference Enhancer`.
- Current release version is `1.1.1`.
- Release tag `1.1.1` already exists on GitHub.
- GitHub Release `1.1.1` already exists and already includes:
  - `main.js`
  - `manifest.json`
  - `styles.css`
- The submission helper files in this folder are:
  - `community-plugin-entry.block-reference-enhancer.json`
  - `obsidian-community-submission-pr-body-1.1.1.md`

## Current Product Decisions

- `fundingUrl` stays omitted for now.
- The plugin is positioned as a UUID block reference and block embed enhancer for Obsidian.
- Logseq is mentioned only as a compatible outline syntax style in documentation, not as the plugin identity.
- The plugin remains local-first:
  - no telemetry
  - no remote sync
  - no note content upload

## Submission-Oriented Changes Already Applied

- Added a root `LICENSE` file using MIT.
- Removed the empty `fundingUrl` field from `manifest.json`.
- Pinned the Obsidian dev dependency instead of using `latest`.
- Added the missing direct `@codemirror/state` dependency declaration.
- Switched index cache persistence to Obsidian's plugin data storage via `Plugin.loadData()` and `Plugin.saveData()`.
- Removed runtime `console.log` noise.
- Renamed command IDs so they no longer include legacy naming.
- Removed direct `innerHTML` DOM writes from sensitive rendering paths.
- Updated build config so production builds are minified.
- Updated README files so manual install points to GitHub release assets instead of the source tree.
- Added local-only, no-telemetry, and no-network disclosure text to the README files.

## Canonical Release Metadata

Use these values consistently in the release, PR, and community entry:

```json
{
  "id": "block-reference-enhancer",
  "name": "Block Reference Enhancer",
  "author": "msjsc001",
  "description": "Render UUID-based block references and block embeds in Obsidian.",
  "repo": "msjsc001/obsidian-block-reference-enhancer"
}
```

The same JSON is stored in `community-plugin-entry.block-reference-enhancer.json`.

## Verified Release State

The GitHub release is already complete:

- Tag name: `1.1.1`
- Release title: `1.1.1`
- No `v` prefix
- Assets uploaded:
  - `main.js`
  - `manifest.json`
  - `styles.css`

Release URL:

```text
https://github.com/msjsc001/obsidian-block-reference-enhancer/releases/tag/1.1.1
```

## Actual Submission Path To Use

Official documentation currently points users toward the Obsidian community submission flow, but recent real plugin submissions are still being accepted through pull requests to `obsidianmd/obsidian-releases`.

For this plugin, the practical working path is:

1. Fork `obsidianmd/obsidian-releases`
2. Append the plugin entry to `community-plugins.json`
3. Open a PR titled `Add plugin: Block Reference Enhancer`
4. Wait for automated checks and reviewer feedback

## Submission Work Already Completed

The following submission work is already done:

1. Fork prepared:
   - `msjsc001/obsidian-releases`
2. Upstream entry prepared in the fork:
   - `community-plugins.json` already contains the `block-reference-enhancer` entry
3. Entry ordering handled:
   - the plugin entry was appended at the end of the list, matching common submission practice
4. PR body prepared:
   - see `obsidian-community-submission-pr-body-1.1.1.md`

## Current Blocker

The only remaining blocked step is opening the PR on `obsidianmd/obsidian-releases`.

Two creation attempts were already made from this machine:

1. Local saved GitHub credential via GitHub REST API
   - endpoint: `POST /repos/obsidianmd/obsidian-releases/pulls`
   - result: `404 Not Found`
2. Connected GitHub integration in this Codex environment
   - action: create pull request on `obsidianmd/obsidian-releases`
   - result: `403 Resource not accessible by integration`

Interpretation:

- The fork update permissions were sufficient for `msjsc001/obsidian-releases`
- The currently available credentials are not sufficient to create a PR against the upstream `obsidianmd/obsidian-releases` repository
- This is a credential-scope blocker, not a repository-content blocker

## Manual Or Next-Run Completion Path

Once a broader GitHub authentication context is available, open the PR with:

- upstream repo: `obsidianmd/obsidian-releases`
- base branch: `master`
- head branch: `msjsc001:master`
- title: `Add plugin: Block Reference Enhancer`
- body file: `obsidian-community-submission-pr-body-1.1.1.md`

Direct compare URL:

```text
https://github.com/obsidianmd/obsidian-releases/compare/master...msjsc001:master?expand=1
```

## Expected Review Focus

The most likely review surfaces for this plugin are:

- command ID format
- DOM write safety
- plugin data storage approach
- README clarity
- release asset completeness
- mobile compatibility assumptions because `isDesktopOnly` is `false`
- support and maintenance expectations for a community plugin

## If Review Feedback Arrives

Handle reviewer feedback with these priorities:

1. Fix any required issues first
2. Keep `manifest.json`, release assets, and README files synchronized
3. If metadata changes, update both the plugin repo and the submission helper files in `plans/`
4. If mobile support is questioned, either verify it properly or narrow the support claim explicitly

## Non-Goals For This Submission

These are intentionally not part of the first community submission:

- donation links
- a built-in search system for expanded block content
- additional settings UI unrelated to current behavior
- large architectural refactors unrelated to review compliance

## Remaining Actions

1. Open the upstream PR from `msjsc001:master` to `obsidianmd:master`
2. Watch automated checks on that PR
3. Address any reviewer feedback
4. Merge after approval
