---
name: UI Connection Management Architecture
description: How connections are selected, edited, and visually reflected across App.jsx, Sidebar, and ConnectionView — decisions made during 2026-03-18 UX audit
type: project
---

## Connection state split: activeConnId vs editingConnId

App.jsx maintains two distinct connection identifiers:
- `activeConnId` — the connection selected for watcher/uploads; persisted to config as `activeConnectionId`
- `editingConnId` — derived from `connEdit.conn?.id`; the connection whose form is currently open

Both can be the same connection (when editing the active one) or different connections.

**Why:** These concepts are separate. Opening a connection's form to edit it should not always change which connection is "active" for file watching. But clicking a different connection DOES make it active (openConnEdit sets activeConnectionId before setting connEdit).

**How to apply:** When adding any feature that interacts with "which connection is being used for X", distinguish between the config-level `activeConnectionId` and the UI-level `connEdit` state.

## ConnectionView keying

`ConnectionView` is given `key={connEdit.conn?.id ?? 'new'}` in App.jsx. This forces React to unmount and remount the form component when switching between connections. Without this, `useState(() => makeDefault(existing))` only runs once on mount, so the form would show the first connection's data even after switching to a different connection.

**Why:** The component's local state was stale when `existing` prop changed.

## Sidebar active state when editing

When `connEdit !== null`, App.jsx passes `activeView={null}` to Sidebar. This de-highlights all nav items during connection editing. The connection being edited gets `connEditing` class (accentted left border). The active connection (for watcher) may simultaneously show `connActive` if it's a different connection.

**How to apply:** When adding new views or nav items, this pattern means no nav item highlights during connection editing mode — preserve this behavior.

## connItem border design

`.connItem` in Sidebar.module.css always has `border-left: 2px solid transparent` and `padding-left: calc(var(--space-3) - 2px)`. This ensures no layout shift when `.connEditing` applies `border-color: var(--accent)`. The content position is stable regardless of border visibility.
