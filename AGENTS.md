# Contributor and agent guide

Rules for everyone who changes this repository, people and coding agents alike.
`CLAUDE.md` only imports this file.

## Repository

Kanban Tenant Labels is a Hermes Desktop plugin that shows each Kanban card's
tenant as a colored label on the card tile.

- `desktop/plugin.js`: the whole plugin (colors, the Kanban card badge
  contribution and the settings page). Desktop loads it as committed.
- `plugin.yaml`: the Hermes plugin manifest.
- `package.json` and `package-lock.json`: Node metadata and the test script.
  The package has no dependencies.
- `tests/`: suites for `node --test`. `tests/helpers/` maps `@hermes/plugin-sdk`,
  `react` and `react/jsx-runtime` to small stubs.
- `docs/design.md`: how the plugin works and which SDK contract it depends on.
- `docs/media/`: screenshots used by the README and the banner for the plugin
  catalog entry.
- `.github/`: the CI workflow and the bug report template.

## Language

Write everything in English: code, comments, docs, commit messages and pull
requests. Prose uses US spelling, such as "color". Existing identifiers keep
their names even where they use British spelling: `assignColours`,
`tests/colours.test.js` and the settings page id `'colours'` stay as they are.

## Code

- Plain ESM with no build step. Desktop loads `desktop/plugin.js` as is.
- `desktop/plugin.js` may import only `@hermes/plugin-sdk`, `react` and
  `react/jsx-runtime`. It has no runtime dependencies.
- Add a development dependency only when the pull request explains why.
- Stay inside the
  [Desktop plugin SDK](https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk)
  and follow the
  [catalog rules](https://hermes-agent.nousresearch.com/docs/developer-guide/plugins/catalog-submission).
  Cards are labeled only through the `KANBAN_CARD_AREAS.badges` contribution
  described in `docs/design.md`. Do not add DOM reach-in: no selectors for
  Desktop markup, no observers and no reads of the app's internal stores or
  other plugins' query keys.

## Privacy

The plugin makes no network requests and sends no telemetry. Keep it that way.
A change that reads new data or adds a storage key updates "Permissions &
privacy" in `README.md` in the same pull request.

## Setup and checks

Use Node 20.19 or later. Before opening a pull request, run:

```bash
npm ci
node --test
HERMES_HOME="${XDG_CACHE_HOME:-$HOME/.cache}/hermes-kanban-tenant-labels" hermes plugins validate .
```

The validate command keeps its own Hermes home in your cache directory. The
first run installs the Hermes runtime into that home and later runs reuse it.
The validator also scans git-ignored files in the checkout, such as those in
`docs/plans/`, which never reach the repository.

CI runs `node --test` on Node 20, 22 and 24, and
`hermes plugins validate . --install-deps` against Hermes v0.22.2.

## Hermes setup

Never install into or modify the Hermes setup you are running in. Run `hermes`
commands with an isolated `HERMES_HOME`, as in the validate command above. The
README steps for trying a checkout in Desktop change the reader's own Hermes
setup, so coding agents do not run them.

## Releases

A release sets the same version in `plugin.yaml`, `package.json` and the two
root entries of `package-lock.json` (`version` and `packages[""].version`).
`tests/manifest.test.js` fails when `plugin.yaml` and `package.json` differ.
Each release also adds an entry to `CHANGELOG.md`.

## Pull requests

Every change reaches `main` through a pull request. Keep local working files,
such as test plans and review notes, in `docs/plans/`, `docs/qa/` or
`docs/reviews/`. Git ignores these folders.
