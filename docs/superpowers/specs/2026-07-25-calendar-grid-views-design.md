# Calendar Week/Month Grid Views — Design

## Context

The Calendar page (`app/(app)/calendar/page.tsx`) currently only offers a single chronological Agenda (list) view (`src/components/calendar/AgendaView.tsx`), grouping upcoming events by day. The user wants Google/Outlook-style week and month grid views added alongside it, with a toggle to switch between all three, while keeping Agenda as the default view on page load.

## Requirements (confirmed with the user)

1. Default view on page load: **Agenda** (unchanged behavior).
2. Both **Week** and **Month** grid views are needed, switchable via a toggle alongside Agenda.
3. Full prev/next navigation between periods (weeks/months), not just "current period only" — matching the feel of Google Calendar/Outlook.
4. **Navigation is clamped to the existing calendar-sync window**: the backend (`functions/src/calendar/sync.ts`) only caches events from **yesterday to +30 days** (`WINDOW_PAST_MS`/`WINDOW_FUTURE_MS`). Rather than extending that sync window (more Google/Microsoft API calls per 10-minute sync tick) or silently showing an empty grid for uncached periods, the prev/next arrows simply disable once navigating further would leave the cached window — an honest, zero-backend-change constraint.
5. **Interaction model**: clicking any event in Week or Month view opens a shared detail popup/modal (title, time, location, join link, and the same "הוסף לתזכורות" reminder button already used in Agenda), rather than reimplementing the reminder flow per view.
6. Architecture: hand-built components (no calendar UI library) — consistent with the rest of the app, which has no UI component library dependency beyond `lucide-react` icons and Tailwind, and avoids fighting a third-party library's styling/RTL assumptions.

## Design

### Page state & data querying

`CalendarPage` gains two pieces of state:
- `view: "agenda" | "week" | "month"`, defaulting to `"agenda"`.
- `anchorDate: Date`, defaulting to today — the reference date whose containing week/month is displayed.

Switching to Week or Month re-queries the `events` collection bounded to the visible range:
```ts
where("uid", "==", user.uid)
where("start", ">=", Timestamp.fromDate(rangeStart))
where("start", "<", Timestamp.fromDate(rangeEnd))
```
(`rangeStart`/`rangeEnd` computed from `anchorDate` + `view`: start/end of the Sunday–Saturday week or calendar month containing `anchorDate` — Sunday-based to match the Israeli week convention already used elsewhere, e.g. the digest's `isIsraeliWorkday` logic). This reuses the existing `(uid, start)` composite index already deployed for the Agenda view — no new index needed. The Agenda view's own query (uid + `start >= today`, unbounded upper end) is untouched.

### Components

- **`CalendarViewToggle.tsx`** — new. A segmented control (רשימה | שבוע | חודש) plus prev/next arrows and a "היום" (today) button that resets `anchorDate` to today. Rendered above whichever view is active. Owns the clamping logic: computes whether the *next* prev/next step would move the visible range outside `[yesterday, today+30d]` and disables the corresponding arrow — a plain date comparison, no extra Firestore reads.
- **`WeekView.tsx`** — new. Seven day-columns, Sunday–Saturday (matching the Israeli-week convention already used for the digest's `isIsraeliWorkday` logic), each column stacking that day's events as color-coded chips (time + title, sorted by start time).
- **`MonthView.tsx`** — new. A 7×5–6 day-cell grid (standard month calendar layout). Each cell shows up to ~3 truncated event chips (colored by source account) plus a "+N more" overflow indicator when a day has more events than fit.
- **`EventDetailModal.tsx`** — new, shared by `WeekView` and `MonthView`. Clicking an event opens this popup: title, time, location, join-link button, and the "הוסף לתזכורות" button — reusing the existing `AddReminderModal` exactly as `AgendaView`'s row button already does, so the reminder feature behaves identically across all three views rather than being reimplemented per view.

### Error handling

No new error paths: the bounded week/month query reuses `CalendarPage`'s existing `onSnapshot` error-surfacing (red banner shown on any Firestore error, e.g. permission-denied), already wired for the Agenda query.

### Verification plan

- `npm run build && npm run lint` stay clean (project's established bar for every change).
- Manually: open Calendar, confirm Agenda is still the default and unchanged; switch to Week, then Month; confirm today's real events render in both; use prev/next to navigate and confirm arrows disable exactly at the yesterday/+30-day edges; click an event in each grid view and confirm the detail popup opens and its "הוסף לתזכורות" button opens `AddReminderModal` prefilled the same way Agenda's does.

## Explicitly out of scope

- Extending the backend sync window (stays at yesterday/+30 days) — a separate decision if ever needed later.
- Drag-and-drop event editing, event creation, or any write capability — this app remains a read-only aggregator.
- Day view (single-day grid) — not requested.
