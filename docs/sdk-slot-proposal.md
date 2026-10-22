# Proposal: a Kanban card badge slot in the Desktop plugin SDK

This plugin labels Kanban cards by decorating the board's DOM, because the
Desktop plugin SDK has no slot for card tiles. This document proposes that
slot. The need is tracked upstream in
[NousResearch/hermes-agent#140026](https://github.com/NousResearch/hermes-agent/issues/140026).

## Summary

Add a contribution area that lets a plugin put a small badge on Kanban card
tiles, shaped like `SESSION_ROW_AREAS` and `MODEL_MENU_ROW_AREA`: the plugin
gets the task and returns a decoration, and core paints it into a fixed slot of
the card.

## Problem

Kanban cards carry data that the tile does not show, the `tenant` in
particular. A user with several projects on one board cannot tell them apart
without opening each card. The detail drawer shows the tenant, the tile does
not.

Today a plugin can only add this by decorating the DOM:

- There is no card contribution area, and `Card` ([apps/desktop/src/plugins/kanban/board.tsx](https://github.com/NousResearch/hermes-agent/blob/v0.22.2/apps/desktop/src/plugins/kanban/board.tsx))
  reads none.
- Tiles carry no `data-*` attribute with the task id, so a plugin has to match
  the visible short id and title against board data.
- A third-party plugin cannot reach the board data through `ctx.rest` (it is
  namespace-scoped to the calling plugin) or `host.request` (no `kanban.*`
  methods). It has to read the Kanban plugin's private React Query keys.

This plugin does exactly that. It works, but it depends on six internal
details (route, tile selector, page markup, tile text, query keys and task
fields) that any Desktop release can change. It is the kind of DOM reach-in,
with a MutationObserver, that the "Migrating off DOM reach-in" notes in the
[Desktop plugin SDK guide](https://github.com/NousResearch/hermes-agent/blob/v0.22.2/website/docs/developer-guide/desktop-plugin-sdk.md)
replace with sanctioned seams. [design.md](design.md) lists those details.

## Proposal

```ts
import { KANBAN_CARD_AREAS, type KanbanCardDecorator } from '@hermes/plugin-sdk'

// Read-only view of the card being rendered.
interface KanbanCardContext {
  board: string          // board slug
  task: {
    id: string
    title: string
    status: string
    tenant: string | null
    assignee: string | null
    priority?: number
  }
}

interface KanbanCardDecoration {
  /** Short text chip, painted in the card's badge row. */
  label: string
  /** Optional color for the chip; core derives readable fill/text from it. */
  color?: string
  /** Optional tooltip. */
  title?: string
}

interface KanbanCardDecorator {
  decorate: (ctx: KanbanCardContext) => KanbanCardDecoration | KanbanCardDecoration[] | null
}

ctx.register({
  area: KANBAN_CARD_AREAS.badges, // 'kanban.card.badges'
  id: 'tenant',
  data: {
    decorate: ({ task }) => (task.tenant ? { label: task.tenant, color: colourFor(task.tenant) } : null)
  } satisfies KanbanCardDecorator
})
```

### Arbitration

- Every decorator runs, in registry order. Core renders all returned chips side
  by side, so plugins cannot suppress each other.
- `null`, an empty label or a non-string label declines. A decorator that
  throws declines too and is logged once. A broken plugin can never blank a
  card or the board.
- `decorate()` re-runs only when the registry or the task object changes, so
  it should be a pure lookup.
- Core owns the card's layout, drag-and-drop, click and context menu. The
  badge row is a fixed slot, for example above the title, with a capped height
  so a decoration cannot reflow the board.

### Teardown

The decoration is an ordinary data contribution. The `ctx.register` disposer
(and plugin disable or reload) removes it, and the cards repaint without it.
Nothing to undo in `ctx.onDispose`.

## Smaller alternatives

Any one of these would remove most of the fragility:

1. Render `data-kanban-task-id="<id>"` on each card tile and document it as a
   stable hook. This is the same kind of contract as `data-session-switching`.
2. Expose read-only board data through the SDK, for example
   `host.kanban.board(slug?)` plus a change event, instead of plugins reading
   another plugin's query keys.
3. Optionally show the tenant on the tile in core, using the app's
   deterministic identity colors (`profileColor`).

## Migration for this plugin

With `KANBAN_CARD_AREAS.badges`, the plugin keeps its color function and its
settings page (pinned colors in `ctx.storage`). It drops the route polling,
the MutationObserver, the tile matching, the badge DOM and the query-cache
reads. The whole decoration becomes one `ctx.register` call.
