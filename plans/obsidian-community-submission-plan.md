# Obsidian Community Submission Plan

## Goal

Prepare `Block Reference Enhancer` for its first submission to the official Obsidian community plugin directory without regressing the current UUID block reference and block embed features.

## Current Product Decisions

- Display name stays `Block Reference Enhancer`.
- Manifest ID stays `logseq-block-ref-enhancer`.
  This legacy ID is intentionally retained for local install compatibility and existing plugin data compatibility.
- Repository is `msjsc001/obsidian-block-reference-enhancer`.
- Current release candidate version is `1.1.0`.
- `fundingUrl` is intentionally omitted for now.
- The plugin is documented as a local-first renderer and indexer for UUID-based block references and block embeds, with compatibility for common Logseq-style outline syntax.

## Submission-Oriented Changes Already Applied

- Added a root `LICENSE` file using MIT.
- Removed the empty `fundingUrl` field from `manifest.json`.
- Pinned the Obsidian dev dependency instead of using `latest`.
- Added the missing direct `@codemirror/state` dependency declaration.
- Switched index cache persistence to Obsidian's plugin data storage via `Plugin.loadData()` / `Plugin.saveData()`.
- Removed runtime `console.log` noise.
- Renamed command IDs so they no longer include the plugin ID.
- Removed direct `innerHTML` DOM writes from source code paths that are likely to be checked by automated review.
- Updated build config so production builds are minified.
- Updated README files so manual install points to GitHub release assets instead of the source tree.
- Added local-only / no-telemetry / no-network disclosure text to the README files.

## Canonical Release Metadata

Use these values consistently in the release, PR, and community entry:

```json
{
  "id": "logseq-block-ref-enhancer",
  "name": "Block Reference Enhancer",
  "author": "msjsc001",
  "description": "Render UUID-based block references and block embeds in Obsidian.",
  "repo": "msjsc001/obsidian-block-reference-enhancer"
}
```

## Release Build Steps

1. Run `npm install` if dependencies changed.
2. Run `npm run build`.
3. Confirm the root release files are up to date:
   - `main.js`
   - `manifest.json`
   - `styles.css`
4. Confirm `manifest.json` version matches `package.json` and `versions.json`.

## GitHub Release Steps

Create a GitHub release with:

- Tag name: `1.1.0`
- Release title: `1.1.0`
- No `v` prefix

Attach these exact files as release assets:

- `main.js`
- `manifest.json`
- `styles.css`

The release assets are what Obsidian installs. The root `manifest.json` and `README.md` are used for directory metadata and details.

## Community Directory Submission Steps

Current practical path:

1. Fork `obsidianmd/obsidian-releases`.
2. Add one entry to `community-plugins.json`:

```json
{
  "id": "logseq-block-ref-enhancer",
  "name": "Block Reference Enhancer",
  "author": "msjsc001",
  "description": "Render UUID-based block references and block embeds in Obsidian.",
  "repo": "msjsc001/obsidian-block-reference-enhancer"
}
```

3. Open a PR against `obsidianmd/obsidian-releases`.
4. Use the official plugin PR template.
5. Keep `Allow edits from maintainers` enabled.

## PR Checklist Draft

Use this checklist body when opening the submission PR:

```md
# I am submitting a new Community Plugin

- [x] I attest that I have done my best to deliver a high-quality plugin, am proud of the code I have written, and would recommend it to others. I commit to maintaining the plugin and being responsive to bug reports. If I am no longer able to maintain it, I will make reasonable efforts to find a successor maintainer or withdraw the plugin from the directory.

## Repo URL

Link to my plugin: https://github.com/msjsc001/obsidian-block-reference-enhancer

## Release Checklist

- [x] I have tested the plugin on
- [x] Windows
- [ ] macOS
- [ ] Linux
- [ ] Android _(if applicable)_
- [ ] iOS _(if applicable)_
- [x] My GitHub release contains all required files (as individual files, not just in the source.zip / source.tar.gz)
- [x] `main.js`
- [x] `manifest.json`
- [x] `styles.css` _(optional)_
- [x] GitHub release name matches the exact version number specified in my manifest.json
- [x] The `id` in my `manifest.json` matches the `id` in the `community-plugins.json` file.
- [x] My README.md describes the plugin's purpose and provides clear usage instructions.
- [x] I have read the developer policies at https://docs.obsidian.md/Developer+policies, and have assessed my plugin's adherence to these policies.
- [x] I have read the tips in https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines and have self-reviewed my plugin to avoid these common pitfalls.
- [x] I have added a license in the LICENSE file.
- [x] My project respects and is compatible with the original license of any code from other plugins that I'm using. I have given proper attribution to these other projects in my `README.md`.
```

## Expected Review Focus

The most likely review surfaces for this plugin are:

- command ID format
- DOM write safety
- plugin data storage approach
- README clarity
- release asset completeness
- mobile compatibility assumptions if `isDesktopOnly` remains `false`

## If Review Feedback Arrives

Handle reviewer feedback with these priorities:

1. Fix any automated "Required" issues first.
2. Push fixes to the same repository and branch; do not open a new submission PR.
3. Keep manifest, README, and release assets synchronized if any visible metadata changes.
4. If reviewers question mobile compatibility, either test and confirm it properly or narrow support explicitly.

## Non-Goals For This Submission

These are intentionally not part of the first community submission:

- donation links
- a built-in search system for expanded block content
- additional settings UI
- large architectural refactors unrelated to review compliance
