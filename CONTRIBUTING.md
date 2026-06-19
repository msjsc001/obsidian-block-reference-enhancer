# Contributing

## Development setup

1. Install dependencies with `npm install`.
2. Run `npm run build` to verify the plugin builds cleanly.
3. Copy the generated files into your test vault's plugin folder before manual testing.

## Before opening a change

1. Keep changes focused and avoid unrelated formatting churn.
2. Preserve compatibility with existing UUID-based block reference and embed behavior.
3. Test both Live Preview and Reading Mode when touching rendering logic.
4. Test large-vault indexing paths when touching index or cache behavior.

## Release expectations

1. Update the plugin version consistently across release metadata.
2. Include release notes for each GitHub release so Community review has change context.


## Support flow

1. Usage questions and reproducible bugs should go through the GitHub issue forms.
2. Bug reports should include plugin version, Obsidian version, mode, steps, and a minimal Markdown sample.
3. Please read SUPPORT.md before opening a new issue.
