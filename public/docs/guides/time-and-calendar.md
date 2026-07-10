# Time & the intention clock

The graph has **two clocks**. *Record time* it gets for free — every node
carries `created_at`, and superseded facts keep their `valid_until` history.
*Intention time* is the layer you write: what's **due**, what's worth
**revisiting**, what a goal is **aiming at**. The Time lens and its readers
are all views over those same few date properties — set a date once, and every
surface that cares picks it up.

## Writing time: the Schedule control

Any node's inspector has a Schedule section: set a **due date** (`due_at`), a
**revisit date** (`review_at`), or a goal's **target date**. Dates can carry a
**recurrence** (daily / weekly / biweekly / monthly / quarterly / yearly) —
recurring items roll forward to their next occurrence instead of sitting
overdue forever, so the agenda never runs dry and never nags about the past.

## Reading time: same data, different zoom

- **Agenda** — what needs you now: overdue, due this week, to revisit. The
  triage list; the dock's *Due/Overdue* rail is its always-visible summary.
- **Quarters** — goals at altitude: a quarter-by-quarter roadmap of goal
  target dates, so "what is this month actually for?" has an answer.
- **Activity** — the record-time heatmap: which days the graph was touched,
  and what changed. Useful for "what was I doing two Tuesdays ago?"
- **Time travel** — scrub the constellation to a past date and see the graph
  as it stood then. Bi-temporal history makes this honest: superseded facts
  come back for the ride.
- **Daily Brief** — the return moment: what changed since your last visit,
  what's due, what wants review — composed on open, no configuration.

## Beyond the window

The same queries run **out-of-band**: a digest command prints what's overdue /
due this week / worth revisiting, so the intention clock can find you from a
cron job or a shell session without the Studio open.

## The design rule

Time features are **writers** (the Schedule control), **readers** (agenda,
quarters, activity, time-travel, brief — one query each), or **pushers** (the
digest). No separate calendar database, no event objects to sync — a date is
just a property on the node it belongs to, which is why setting one pays off
in five places at once.
