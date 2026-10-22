# Kanban Tenant Labels

Kanban Tenant Labels is a Hermes Desktop plugin that shows each Kanban card's
tenant as a small colored label on the card. Every tenant gets its own color,
and you can pin colors in the plugin's settings. Cards without a tenant get no
label, and card titles stay as they are.

![Kanban board with tenant labels, light theme](docs/media/board-light.png)

![Kanban board with tenant labels, dark theme](docs/media/board-dark.png)

## Requirements

- Hermes v0.22.0 or later.
- The bundled Kanban plugin, enabled in Capabilities → Plugins → Kanban.
- Kanban cards with a tenant.

Tested with Hermes v0.22.2 on macOS.

## Install

### From Hermes Desktop

This is the recommended way to install. Open Capabilities → Plugins → Install
from Git, enter `https://github.com/mszenfeld/hermes-kanban-tenant-labels`,
choose Review repository, then Install. The dialog marks the repository
Unverified because the plugin is not in the catalog.

Desktop installs only the `desktop/` folder, as a desktop plugin named
`hermes-kanban-tenant-labels`. The plugin is on right away and has no Agent
half to switch.

### From the command line

```bash
hermes plugins install mszenfeld/hermes-kanban-tenant-labels --no-enable
```

This installs the whole package into `~/.hermes/plugins/` without turning
anything on. In Desktop, open Capabilities → Plugins → Rescan, then switch
Desktop on for the package. Leave its Agent switch off and do not run
`hermes plugins enable` for it, because the package has no Agent code (see
[Known issues](#known-issues)).

If you enable it anyway and the CLI asks to install Node dependencies, answer N.
The only dependency in `package.json` is `linkedom`, which the tests use.

### With an install link

```text
hermes://plugin/install?repo=mszenfeld/hermes-kanban-tenant-labels
```

Paste this into a browser's address bar. Desktop opens the same review dialog as
Install from Git and installs nothing until you confirm.

## Colors and pins

The palette has 12 hues in 30° steps, `hsl(0…330 68% 58%)`, matching the SDK's
`PROFILE_SWATCHES`. A hash of the tenant name picks each tenant's preferred hue.
If two tenants want the same hue, the one later in name order takes the next
free hue. The tenants that count are those on the board on screen, archived
cards included.

With up to 12 tenants, each gets its own color unless pins reserve too many hues
or two tenants are pinned to the same hue. With more than 12, the extra tenants
share hues. Colors can shift when tenants are added or removed, or when you
switch boards, because a new tenant earlier in name order can take another
tenant's hue.

To keep a color fixed, open Settings → Plugins → Kanban Tenant Labels and pick a
color for the tenant. Choose Automatic color to unpin it. A pinned color stays
reserved even when its tenant is not on the board, and other tenants avoid
pinned colors unless all 12 hues are pinned.

The label's background and outline are tints of the tenant's hue. Its text is
the theme's text color, `--ui-text-primary`, with 40% of the hue mixed in OKLab.

![Settings page with tenant colors](docs/media/settings.png)

## Permissions & privacy

The plugin reads board data that Desktop already holds in its shared query
cache (task ids, titles and tenants) and keeps its task index in memory. It
makes no network requests and runs no backend, Python or shell commands. There
is no telemetry.

It stores only pinned colors, through `ctx.storage` under the key `pins`
(`hermes.plugin.hermes-kanban-tenant-labels.*`). Each labeled card tile gets one
extra `<span>`.

While it runs, the plugin checks the route every 750 ms and subscribes to the
query cache. While `#/kanban` is open, a `MutationObserver` watches the Kanban
page. Console warnings report markup or data mismatches, missing host APIs and
failures in host callbacks.

## How it works

The bundled Kanban plugin keeps board snapshots in the app's shared React Query
cache, which the SDK exports as `queryClient`. While `#/kanban` is open, the
plugin reads the snapshots of the boards on screen, matches each card tile to
its task by the short id and title the tile shows, and inserts the label as the
tile's first child. It makes no extra requests. A `MutationObserver` labels new
tiles before they are painted. Switching the plugin off, reloading or removing
it removes every label and stops its observer, timers and listeners.
[docs/design.md](docs/design.md) has the details.

## Limitations

The Desktop SDK has no slot for Kanban cards, so the plugin relies on Desktop
internals that are not public contracts: the `#/kanban` route, the card tile
markup and the Kanban plugin's query keys. Any Desktop release can change them.
If the markup or data changes, cards stop getting new labels and the console
shows a `[hermes-kanban-tenant-labels]` warning. If the route changes, the
plugin stays inactive without a warning. In both cases the board keeps working.
If one of the plugin's host callbacks throws, the plugin removes its labels and
stays off until you reload it.

Labels appear only while the main route is `#/kanban`. A board in a split tile
gets labels next to the main board, but not next to a chat. Each labeled card is
one line taller. [docs/design.md](docs/design.md) lists the exact selectors and
failure cases.

## Known issues

- If the Agent half is enabled after a command-line install,
  `~/.hermes/logs/agent.log` shows
  `Failed to load plugin 'hermes-kanban-tenant-labels': No __init__.py in …` on
  every start. This is upstream bug
  [NousResearch/hermes-agent#132741](https://github.com/NousResearch/hermes-agent/issues/132741).
  The plugin works anyway. To silence the message, switch the Agent half off or
  run `hermes plugins disable hermes-kanban-tenant-labels`. The package has no
  Python code and does not ship an `__init__.py`. Installs from Hermes Desktop
  are not affected.
- After a Desktop update, cards can stop getting labels. The console then shows
  a `[hermes-kanban-tenant-labels]` warning. See [Limitations](#limitations).

## Catalog status

This plugin is not in the Hermes plugin catalog. The
[catalog rules](https://hermes-agent.nousresearch.com/docs/developer-guide/plugins/catalog-submission)
admit only desktop plugins that stay inside the SDK, and this plugin reads the
board's markup and the Kanban plugin's query cache because the SDK has no
Kanban card slot. The slot is requested in
[NousResearch/hermes-agent#140026](https://github.com/NousResearch/hermes-agent/issues/140026).
[docs/sdk-slot-proposal.md](docs/sdk-slot-proposal.md) describes the slot this
plugin would use.

## Uninstall

Switching the plugin off in Capabilities → Plugins removes every label at once.

- Installed from Desktop: open Capabilities → Plugins and choose Uninstall on
  the plugin's row.
- Installed from the command line: run
  `hermes plugins remove hermes-kanban-tenant-labels`, then Rescan (or restart)
  so Desktop drops its copy.
- Copied by hand: delete
  `~/.hermes/desktop-plugins/hermes-kanban-tenant-labels` and run
  ⌘K → Reload desktop plugins.

## Development

Use Node 20.19 or later:

```bash
npm ci
node --test
```

To try a checkout in Desktop, link it into your plugins folder as a unified
package:

```bash
ln -s "$PWD" ~/.hermes/plugins/hermes-kanban-tenant-labels
```

Then open Capabilities → Plugins → Rescan and switch Desktop on for the package,
leaving Agent off. Every save re-syncs and reloads the Desktop copy.
Alternatively, copy `desktop/plugin.js` into
`~/.hermes/desktop-plugins/hermes-kanban-tenant-labels/plugin.js` and run
⌘K → Reload desktop plugins.

[AGENTS.md](AGENTS.md) has the rules for contributors and coding agents,
including the checks to run before a pull request.

## License

MIT. See [LICENSE](LICENSE).
