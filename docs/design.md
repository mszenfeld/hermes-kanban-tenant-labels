# Design notes

Notes for contributors: how the plugin finds and labels Kanban card tiles,
which Desktop internals it depends on, and why it works this way. Source links
point to [hermes-agent](https://github.com/NousResearch/hermes-agent/tree/v0.22.2)
at the `v0.22.2` tag. Hermes Desktop v0.22.2 renders the same markup and uses the same
query keys.

## SDK seams for card tiles

| Seam | Result |
|------|--------|
| Contribution areas ([desktop-plugin-sdk.md](https://github.com/NousResearch/hermes-agent/blob/v0.22.2/website/docs/developer-guide/desktop-plugin-sdk.md), [apps/desktop/src/sdk/index.ts](https://github.com/NousResearch/hermes-agent/blob/v0.22.2/apps/desktop/src/sdk/index.ts)) | Panes, routes, sidebar nav and its preferences, status bar, title bar, page header, palette, keybinds, themes, composer, model menu rows, session rows, appearance, settings pages, transcript directives, chat empty state and layouts. None of them covers Kanban cards. `SESSION_ROW_AREAS` and `MODEL_MENU_ROW_AREA` have the shape a card badge would need, but they decorate only those two lists. |
| Kanban-specific contribution | The board is the bundled desktop plugin `kanban` ([apps/desktop/src/plugins/kanban/](https://github.com/NousResearch/hermes-agent/tree/v0.22.2/apps/desktop/src/plugins/kanban)). Its `Card` component renders a fixed tree and reads no contribution area. |
| Theme and CSS hooks | The only Kanban CSS hooks are `.kanban-arc` and the `--kanban-tone` custom property (the status color). Neither carries the task or the tenant, and CSS alone cannot read the tenant. |
| `ctx.rest` | Scoped to the calling plugin's own `/api/plugins/<id>` namespace, and `..` segments are rejected ([apps/desktop/src/api/plugins.ts](https://github.com/NousResearch/hermes-agent/blob/v0.22.2/apps/desktop/src/api/plugins.ts)). A third-party plugin cannot call `/api/plugins/kanban/*`. |
| `host.request` (gateway JSON-RPC) | The SDK guide lists "kanban" among the methods, but [tui_gateway/](https://github.com/NousResearch/hermes-agent/tree/v0.22.2/tui_gateway) registers no `kanban.*` method. |
| Shared React Query cache | The Kanban plugin fetches `/api/plugins/kanban/board?board=<slug>` into the app's single `QueryClient` under `['kanban', 'board', connectionScope, boardSlug, includeArchived]`, and the SDK exports that client as `queryClient`. The plugin uses this cache as its data source: it already holds the boards on screen, and reading it needs no backend, no extra request and no configuration. |
| Own `plugin_api.py` | Possible (reading [hermes_cli/kanban_db.py](https://github.com/NousResearch/hermes-agent/blob/v0.22.2/hermes_cli/kanban_db.py) read-only), but it needs `plugins.enabled` in `config.yaml`, a gateway restart and polling, and it cannot see which board the user selected. The plugin does not use it for those reasons. |

## How a tile maps to its task

[`Card`](https://github.com/NousResearch/hermes-agent/blob/v0.22.2/apps/desktop/src/plugins/kanban/board.tsx) in `board.tsx` renders:

```html
<div draggable="true" style="--kanban-tone: …; border-left-color: …" class="group relative flex cursor-grab flex-col gap-2 …">
  <span class="kanban-arc" aria-hidden="true"></span>        <!-- only while running/stale -->
  <span class="line-clamp-2 …">{task.title || task.id}</span>
  <span class="line-clamp-2 …">{summary}</span>               <!-- optional -->
  <div class="flex items-center gap-2 whitespace-nowrap …">  <!-- CardFooter -->
    …
    <div class="ml-auto flex min-w-0 shrink items-center gap-2">
      …
      <span class="min-w-0 truncate font-mono …">{shortId(task.id)}</span>
    </div>
  </div>
</div>
```

- No `data-*` attribute carries the task id or tenant. The tenant is rendered
  only in the detail drawer (`metaTenant`).
- `shortId(id) = id.replace(/^t_/, '').slice(0, 6)` is visible on every tile.
- The title is `task.title || task.id`.
- Tiles are keyed by `task.id`, so a tile element always shows the same task.

The plugin matches a tile to a task when one of the tile's leaf elements shows
the task's short id and another shows its title. If two tasks would match
the same tile, the tile is left alone.

React fiber props (`__reactFiber$…`) would give the task object directly, but
the SDK guide names fiber walks as the anti-pattern to migrate away from, so
the plugin does not use them.

## Desktop internals the plugin depends on

All of these are internal to Desktop and can change in any release.

| Relied on | Current value |
|-----------|---------------|
| Kanban route | `location.hash` is `#/kanban` (Desktop uses a HashRouter) |
| Card tile | `[draggable="true"][style*="--kanban-tone"]` |
| Page root | the nearest ancestor of a tile with a direct `<header>` child that contains an `<h1>`; column headers have no `<h1>` |
| Tile text | leaf elements showing `shortId(task.id)` and `task.title \|\| task.id` |
| Board data | `queryClient` entries keyed `['kanban', 'board', scope, slug, archived]`, with data `{ columns: [{ name, tasks: [{ id, title, tenant, … }] }], tenants: [] }` |
| Task fields | `id`, `title` and `tenant` on each task of the snapshot |

When the cache reports observers (`query.getObserversCount()`), only the
observed snapshots count: the board the page and its status-bar count show. A
task id that carries different tenants on two counted boards, for example an
imported copy of a board, gets no label.

## When Desktop changes

The board itself keeps working in every case below.

- A markup or data mismatch logs one `[hermes-kanban-tenant-labels]` console
  warning per kind of mismatch, each under its own `warnOnce` key: `data` (tiles
  on screen but no board data in the cache), `fields` (no task has a `tenant`
  field), `match` (no tile matches a task), `root` (no page root around the
  tiles) and `tiles` (board data but no tile). Cards the plugin cannot match get
  no new labels. A mismatch does not necessarily remove existing labels.
- The `tiles` warning waits for eight route ticks (`MISSING_TILE_TICKS`) with
  board tasks in the cache. Ticks before the data arrives do not count.
- If the route changes, the plugin never activates and logs nothing.
- An exception in a host callback shuts the labeler down. It removes its
  badges, stops its listeners and timers, and logs once under the `error` key
  without throwing into the board. Reloading the plugin turns labels back on.
- If the SDK's query cache, `MutationObserver` or the tracked timers are missing
  at startup, the plugin logs one warning and does not start.

`tests/labeler.test.js` covers all five markup and data warnings, including late
board data and tile text with unrecognized short ids, plus host-callback
exception isolation and teardown.

## Scope of the DOM work

- Route gate: a 750 ms `ctx.setInterval` reads `location.hash`, plus
  `hashchange`/`popstate` listeners through `ctx.addEventListener`, plus every
  board-data change in the cache. Polling is needed because the sidebar
  navigates with `history.pushState`, which fires neither event. The gate is
  open on `#/kanban` and on its subpaths and query strings.
- One `MutationObserver` on the page root of each board on screen
  (`childList`, `subtree`, `characterData`). That is the main page, plus a
  board in a split route tile while the main route is the board. It is created
  only while the route is active and disconnected when the route is left. A
  board stays observed while it is mounted, even when every card is filtered
  out. Records caused by the plugin's own badge are ignored. A board in a split
  tile next to a chat is not observed.
- The observer callback runs the pass directly. The callback is a microtask
  after React's commit, so a new tile gets its label before the next paint.
- A query-cache subscription runs a coalesced pass 50 ms after board data
  changes.
- The badge is inserted as the tile's first child. It is the only node the
  plugin writes, and a pass that finds nothing to change writes nothing.
- Each labeled card is one line taller. The badge sits in React-owned markup,
  an approach the SDK discourages where a supported slot exists.
- Disabling, reloading or removing the plugin removes every label and stops the
  observer, the cache subscription, the timers and the listeners.

## Colors

`PALETTE` has 12 hues in 30° steps, `hsl(0…330 68% 58%)`, at the saturation and
lightness of the SDK's `PROFILE_SWATCHES`. `hashTenant` is 32-bit FNV-1a over
UTF-16 code units, and `preferredColour` takes that hash modulo 12.
`assignColours` gives pinned tenants their pins and reserves every pinned color.
It then walks the other tenants in name order, and each one takes its preferred
hue or the next free hue after it. With more tenants than hues, the overflow
shares the first unpinned hue from its preferred one, or its preferred hue if
every hue is pinned. Changing the hash would recolor every tenant for every
user, so `tests/colours.test.js` checks it against published FNV-1a vectors.

The badge is styled inline, so it needs no injected stylesheet and leaves
nothing behind when removed. Its background is a 16% tint of the hue, its ring
a 45% tint, and its text mixes 40% of the hue into `--ui-text-primary` in OKLab.
