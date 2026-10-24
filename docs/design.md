# Design notes

Notes for contributors: how the plugin labels Kanban cards through the card
badge slot, assigns colors and uses the SDK contract. Source links point to
hermes-agent at commit `e04614a`, the merge of
[NousResearch/hermes-agent#143673](https://github.com/NousResearch/hermes-agent/pull/143673),
because no Hermes release includes the slot yet. The contract is defined in
[kanban-card-badges.tsx](https://github.com/NousResearch/hermes-agent/blob/e04614af7bb4e982b76e5256f5ec207198e0641e/apps/desktop/src/contrib/kanban-card-badges.tsx)
and the
[Desktop plugin SDK guide](https://github.com/NousResearch/hermes-agent/blob/e04614af7bb4e982b76e5256f5ec207198e0641e/website/docs/developer-guide/desktop-plugin-sdk.md#kanban-card-badges).

## The card badge slot

The plugin uses one contribution, with the id `'tenant'`, equivalent to:

```js
ctx.register({
  area: KANBAN_CARD_AREAS.badges,
  id: 'tenant',
  data: { decorate }
})
```

Desktop calls `decorate(card, board)` while rendering each card. It passes a
frozen `card` with `{ id, status, tenant, assignee }` and a frozen `board` with
`{ tenants }`. The tenant array is also frozen and is copied for each call.
`board.tenants` is the board's tenant filter list, including tenants from
archived tasks. Board filters do not narrow that list, so filtering does not
change the badge colors.

The decorator returns `{ label, tone, tooltip: 'Tenant: <tenant>' }`, using the
tenant name as the label and an SDK hue as the tone, or `null` for a card
without a tenant. Desktop sanitizes the result, shortens labels longer than 24
characters with an ellipsis and limits the tooltip text to 160 characters. It
adds the plugin's name below that text in the tooltip. The host allows at most
two badges per plugin on each card and orders contributions by plugin id.
Desktop paints the badges as chips in a row above the card title; the plugin
does not write the badge markup or styles.

## Pins and repaint

Registering the same area and id again replaces the contribution and repaints
the board. Each registration gets a new decorator with a snapshot of the
current pins. Picking or clearing a pinned color in Settings stores the pins
through `ctx.storage` under `pins` and registers the badge contribution again.

Disabling or unloading the plugin removes its badges. There is nothing to
clean up in `ctx.onDispose`.

## Tenant list for the settings page

The decorator receives `board.tenants`. When that list changes, the plugin
updates the settings page's tenant store through a 0 ms `ctx.setTimeout`.
Deferring the update keeps it out of the board's render, which is when
`decorate` runs.

The settings page lists the tenants of the last board that rendered at least
one card since the plugin was last loaded (Desktop start, a plugin reload or
switching the plugin back on), plus pinned tenants. With no pinned tenants
and no card rendered yet, it shows "No tenants yet" and:

> Open a Kanban board that shows at least one card; its tenants show up here.

A board with no visible cards does not update the list: no filter matches,
collapsed columns, only archived tasks or an empty board can leave no cards to
render. The host does not call `decorate` in that case, and the slot provides
no other board-level signal. This affects only the settings list. Badge colors
always use the current board's tenant list.

## Older Hermes releases

The plugin imports the SDK as a namespace so it can check for the slot without
failing to load the module on older hosts. If `KANBAN_CARD_AREAS.badges`, a
12-element `KANBAN_CARD_BADGE_HUES`, `atom`, `ctx.register` or `ctx.setTimeout`
is missing, it logs one console warning and registers neither badges nor a
settings page:

```text
[hermes-kanban-tenant-labels] This Hermes Desktop has no Kanban card badge slot (KANBAN_CARD_AREAS.badges); labels are off.
```

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

`PALETTE[i]` maps to `KANBAN_CARD_BADGE_HUES[i]`. The SDK hue order is `'red'`,
`'orange'`, `'yellow'`, `'lime'`, `'green'`, `'mint'`, `'cyan'`, `'sky'`, `'blue'`,
`'violet'`, `'magenta'`, `'pink'`. Desktop paints tone `i` with
`PROFILE_SWATCHES[i]` = `hsl(i×30 68% 58%)` = `PALETTE[i]`, so stored pins keep
their colors.

Within each decorator, the color assignment is recomputed only when the
board's tenant list changes, not for every card. The host supplies a new array
on each call, so the plugin compares the list's values rather than its identity.

## History

Through v0.3.0, the plugin decorated the board's DOM with route polling, a
`MutationObserver`, tile matching and query-cache reads. That design is in the
[v0.3.0 design notes](https://github.com/mszenfeld/hermes-kanban-tenant-labels/blob/v0.3.0/docs/design.md),
and the proposed slot is in the
[v0.3.0 slot proposal](https://github.com/mszenfeld/hermes-kanban-tenant-labels/blob/v0.3.0/docs/sdk-slot-proposal.md).
Upstream implemented the slot in
[NousResearch/hermes-agent#143673](https://github.com/NousResearch/hermes-agent/pull/143673).
