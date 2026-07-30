# Trase Agents — Design Spec

**Date:** 2026-07-29
**Status:** Revised after review
**Context:** Take-home exercise for Trase AI

---

## 1. What we're building

A full-stack web application to manage **Agents**, create **Tasks** assigned to them, and **run** those
tasks with live streaming feedback.

- An **Agent** is a runnable capability. In this exercise its execution is simulated.
- A **Task** is a concrete job instance: what to do, and which agent should do it.
- A **Run** is one execution attempt of a task. A task may have many runs.

### Required (from the brief)

**Agents** — `GET /agents`, `POST /agents`, `GET /agents/{id}`
**Tasks** — `GET /tasks`, `POST /tasks` (400 if agent doesn't exist), `GET /tasks/{id}` incl. run history
**Execution** — `POST /tasks/{id}/run`: simulates work over several seconds, emits progress events
(`queued → running → log output → completed | failed`), fails randomly sometimes, persists each run.

**Frontend** — agent list with type-ahead filter on name/description; clicking an agent shows its tasks;
task list with status and assigned agent; create task with agent picker; Run button with inline live
progress/logs; clear status indicators; retry on failure; responsive; empty/loading/error states.

**Testing** — API tests for task-creation validation and the run lifecycle; frontend tests for filter
behaviour and run status display.

**Bonus** — public URL, cancel an in-progress run, stats panel.

### Explicit non-goals

Authentication, multi-tenancy, real agent execution, horizontal scale, rate limiting, observability
tooling, i18n. Each is addressed in §12 as a documented future step rather than built.

---

## 2. Governing principles

1. **Trivial local setup.** `pnpm install && pnpm dev`, then open a browser. No Docker, no database
   install, no `.env` to populate, no credentials, and **nothing that compiles on install**. A reviewer
   is running the app in under two minutes or the setup is wrong.
2. **Build incrementally.** Every rung is runnable and demoable on its own.
3. **Seams where they earn their place.** Three interfaces exist because production would need something
   different behind them. Not five — an interface with one implementation and no plausible second one is
   ceremony, and reads as such.
4. **Claim only what is true.** Every architectural claim in this document should survive an interviewer
   tracing the mechanism. Overstating a good decision makes it weaker, not stronger.

---

## 3. Decisions and rationale

| Decision | Choice | Rationale | Rejected |
|---|---|---|---|
| Hosting model | Single long-lived Node process | Background work and an in-process bus just work | Serverless — forces a `waitUntil` redesign for no benefit |
| Repo layout | pnpm workspace: `core`, `server`, `web` | `core` declares zero dependencies — "the domain has no I/O" is verifiable by opening one file | Single package (weaker claim); four packages (plumbing) |
| Backend framework | Hono | See §3a | Express, Fastify, NestJS — see §3a |
| Database | SQLite | Zero setup — the dominant constraint | Postgres + Docker (Docker becomes a prerequisite) |
| SQLite driver | **`@libsql/client`** | Ships prebuilt binaries as ordinary npm optional deps — never compiles, no C++ toolchain, N-API so one binary spans Node versions | `better-sqlite3@13` (**0 prebuilds** — falls back to node-gyp, fails without Build Tools); `node:sqlite` (no stable Drizzle export; drizzle-kit can't connect) |
| DB access | Drizzle (`drizzle-orm/libsql`) | Schema declared once; types and migrations derived from it; thin enough to drop to raw SQL | Raw SQL (types are a promise); Prisma (codegen, abstracts SQL away) |
| Request validation | Hand-rolled helper | ~4 fields across 2 endpoints; the graded check (agent exists) is a DB lookup no schema validator can do | Zod — revisit at the third non-trivial body |
| Run execution | Fire-and-forget async in-process | Execution outlives the request, which is what buys tab-close and refresh survival | Run inside the POST stream; real queue (vendor setup for an 8s simulation) |
| Live updates | SSE | Plain HTTP; `EventSource` is built in, auto-reconnects, and carries `Last-Event-ID` | WebSockets (bidirectional we don't need); polling (not live) |
| Event bus | **Wakeup-only** — publishes `{runId}`, carries no payload | Makes event loss structurally impossible (§7); demotes the bus to a latency optimisation | Payload-carrying bus — introduces a lost-event race |
| Stream topology | One `EventSource` per running task | Simplest correct thing; limitation documented and moot over HTTP/2 | Multiplexed stream — the fix, deferred behind one hook |
| Frontend data | React + Vite + TanStack Query | Loading/error/empty/refetch for free, and all four are graded | Plain hooks — reimplements the same thing worse |
| Styling | Tailwind v4 | Responsive layout, status pills and skeletons are three graded requirements it makes fast; v4 is one dev dep + one import, no PostCSS config | CSS Modules — hand-writing things nobody is grading |
| Rendering | Client-rendered SPA | Nothing to index, and it's behind a login in any real deployment — server rendering would be paid for and unused | Next.js SSR — better on slow connections and required for SEO, neither of which applies |
| Routing | **React Router** | Two real views (`/agents/:id`, `/tasks`); back/forward must work on selection; route-level error and loading boundaries are graded requirements | Hand-rolled `history.pushState` + `popstate` — see below |
| Tests | Vitest + Testing Library | Shares Vite config; fast | |

**Seven load-bearing choices:** Hono, Drizzle + libSQL, React, Vite, TanStack Query, Tailwind, Vitest.
(The installed dependency count will be higher — this is a statement about decisions, not a `package.json`
line count.)

---

## 3a. Why Hono over Express, Fastify or NestJS

| | Express | Fastify | NestJS | Hono |
|---|---|---|---|---|
| Test without binding a port | ❌ needs supertest | ✅ `inject()` | ✅ testing module | ✅ `app.request()` |
| SSE first-class | ❌ manual headers + `res.write` | ⚠️ via plugin | ⚠️ | ✅ `streamSSE` |
| Runs unchanged on serverless | ❌ | ❌ | ❌ | ✅ Web Standard |
| Reviewer reads it cold | ✅✅ | ✅ | ⚠️ heavy | ✅ |

**Port-free testing** — `app.request('/tasks')` is a function call: no server, no port, no cleanup, no
"address already in use" when test files run in parallel. The difference between fast deterministic API
tests and slow occasionally-flaky ones.

**SSE built in** — the decisive one, because SSE *is* the interesting part of this project. `writeSSE`
takes `id`/`event`/`data` as fields rather than requiring hand-formatted wire protocol, and
`stream.onAbort` / `stream.aborted` handle client disconnect. In Express all of that is hand-rolled.

**Portability is the weakest of the three reasons** and shouldn't be led with. We deploy one Node process;
"runs on Cloudflare Workers" buys nothing today and only pays off along the §12a path.

**Honest ranking:** Fastify is a close second and equally defensible — it matches on port-free testing,
and loses only on SSE being a plugin rather than a helper. Express is the safest choice for reviewer
familiarity, and "boring technology" is a real virtue; it loses on both of the things this project
actually needs. If the app grew heavy request-body validation across many endpoints, Fastify's built-in
JSON Schema story would start to win.

---

## 4. Architecture

```
   Browser (React SPA)
        │  REST + SSE
        ▼
   API service (Hono) ──triggers──▶ Run engine
        │                              │
        │ reads                        │ writes events
        ▼                              ▼
        └──────────  Store (SQLite)  ◀─┘
                          │
                    wakeup only
                          ▼
              Event bus ──▶ SSE handlers ──▶ re-read the store
```

**The load-bearing property, stated precisely:** the API *triggers* the engine, but never *reads* from
it. Every byte the browser sees came out of the store. The bus only ever says "something changed for run
X" — never what changed.

Two consequences, attributed honestly, because they come from two different decisions:

- **Execution outliving the request** (fire-and-forget, not streaming from POST) is what makes a run
  survive the user closing the tab or refreshing mid-run.
- **Persisting every event with a monotonic `seq`** is what makes run history, multiple simultaneous
  viewers, and resume-after-disconnect possible. This would be true even if the engine ran inline.

Neither is "free" — each is a specific decision with a specific cost. Bundling them under one label
invites the question "free from *what*, exactly?"

### Layers

- `core/` — run engine and state machine. **No HTTP, no database, no dependencies.** Pure functions over
  injected dependencies. Enforced by `package.json` having an empty `dependencies` block.
- `server/store/` — repositories over Drizzle. The only place SQL lives.
- `server/http/` — Hono route handlers. Translate HTTP to repository and engine calls. No business logic.
- `server/bus/` — wakeup bus. Publish and subscribe, in-process.

---

## 5. Data model

```sql
agents      id, name, description, simulation_profile (json), created_at
tasks       id, title, description, agent_id → agents.id, created_at
runs        id, task_id → tasks.id, status, started_at, finished_at, error, cancel_requested
run_events  id, run_id → runs.id, seq, ts, type, message
```

`run_status` ∈ `queued | running | completed | failed | cancelled`
`event_type` ∈ `status | log | error`

### Decisions embedded here

**Tasks have no status column.** A task's status is derived from its most recent run, or `never_run` if
there isn't one. A denormalised column creates two places that can disagree, and that disagreement is
always found by a user rather than a test. Cost: one join.

**"Most recent" is ordered by `(started_at DESC, id DESC)`.** Two runs created in the same millisecond —
reachable by double-clicking Run — would otherwise pick an arbitrary winner. `id` is monotonic and breaks
the tie deterministically.

**Retry is a new `runs` row, not a state transition.** This collapses three requirements into one design:
retry, run history, and "some runs fail randomly" are the same feature from different angles. Run history
is `SELECT * FROM runs WHERE task_id = ?`.

**`run_events.seq` is monotonic per run,** with `UNIQUE (run_id, seq)`. This is what makes resumable
streaming possible: a client holding `seq = 7` asks for `8+`, replay is idempotent, and duplicate
delivery is harmless.

### Indexes

`tasks(agent_id)`, `runs(task_id, started_at DESC, id DESC)`, `run_events(run_id, seq)`.

---

## 6. API surface

```
GET    /agents                 list (id, name, description)
POST   /agents                 create
GET    /agents/:id             detail

GET    /tasks[?agent_id=]      list with agent + derived status
POST   /tasks                  create — 400 if agent_id does not exist
GET    /tasks/:id              detail + run history

POST   /tasks/:id/run          → 202 { runId }   (retry = call again)
                               → 409 if a non-terminal run already exists
GET    /runs/:id               run detail + events
GET    /runs/:id/events        SSE — see §7
POST   /runs/:id/cancel        → 202

GET    /stats                  counts: agents, tasks, runs by status
```

One error shape everywhere, so the frontend has exactly one thing to render:

```json
{ "error": { "code": "AGENT_NOT_FOUND", "message": "No agent with id abc", "details": {} } }
```

### Why 202 + a separate stream, rather than streaming from POST

Not primarily about status-code correctness. Two concrete reasons:

1. **`EventSource` is GET-only.** Streaming from POST means abandoning it for `fetch` plus manual
   `ReadableStream` parsing plus hand-rolled reconnect and resume — reimplementing, worse, what the
   browser already does.
2. **"Watch a run that's already in progress" needs a GET endpoint anyway** — a second viewer, or the
   same user after a refresh. So POST-streaming means building both, not one.

`409` on a second concurrent run prevents the double-click case where two runs interleave their logs into
one pane and the derived status flickers between them. The UI also disables the button — the client guard
is what a reviewer sees, the server guard is what makes it correct.

---

## 7. Streaming design

This is the part most likely to be wrong in a subtle way, so it's specified precisely.

### Write order

The engine's sink **writes the event to the store, then publishes a wakeup.** Never the reverse —
publishing first means a subscriber can be told about an event that a concurrent reader can't yet
`SELECT`.

### The bus carries no payload

`bus.publish(runId)` — that's the entire message. Handlers respond by re-querying the store.

**Why:** the obvious design (replay from the DB, then subscribe to a payload-carrying bus) has a race.
An event emitted between the `SELECT` returning and the subscription registering lands in the database
after the query snapshot and on the bus before the subscriber exists. It is lost permanently, and the
client never notices the gap — it just receives `seq` 13 after 11 and carries on.

With a wakeup-only bus the handler always re-queries `WHERE seq > lastSent`, so a missed wakeup costs
latency, never data. It also means moving the engine to a separate worker process later requires only
that the wakeup crosses the process boundary — not ordered, exactly-once delivery of payloads.

### The SSE handler

```ts
app.get("/api/runs/:id/events", (c) =>
  streamSSE(c, async (stream) => {
    let lastSent = Number(c.req.query("since") ?? c.req.header("Last-Event-ID") ?? 0);
    const wake = bus.subscribe(runId);        // subscribe BEFORE the first read
    stream.onAbort(() => wake.close());       // client left — unsubscribe or leak

    while (!stream.aborted) {
      for (const e of await store.eventsAfter(runId, lastSent)) {
        await stream.writeSSE({ id: String(e.seq), event: e.type, data: JSON.stringify(e) });
        lastSent = e.seq;
      }
      if (await store.isTerminal(runId)) {
        await stream.writeSSE({ event: "done", data: "{}" });
        break;
      }
      await wake.next({ timeoutMs: 15_000 }); // timeout doubles as heartbeat + self-heal
    }
  })
);
```

### Five things that are easy to get wrong

**`?since=` is required, not just `Last-Event-ID`.** The browser echoes `Last-Event-ID` only on its *own*
automatic reconnect. A user hard-refreshing mid-run opens a brand-new `EventSource` with no header at all
— so refresh-mid-run, which we claim as a feature, would replay from zero. The hook already knows
`lastSeq` from the REST snapshot; it passes it as `?since=`. Precedence: `since` → `Last-Event-ID` → 0.

**Terminal runs must send `event: done` and be closed by the client.** If the server just closes the
connection, `EventSource` treats it as a network failure and reconnects — forever, once per finished run.
The client calls `es.close()` on `done`. The same path handles attaching to an already-finished run:
replay everything, send `done`, close.

**Headers:** `Cache-Control: no-cache`, `X-Accel-Buffering: no`, and the 15s heartbeat above. Proxy
response buffering is the standard "works locally, dead once deployed" failure.

**Unsubscribe on abort, or leak.** A user closing the tab or navigating away aborts the stream, but the
bus subscription outlives it unless explicitly closed. `stream.onAbort(() => wake.close())`. One line,
and without it every abandoned stream leaks a subscription — invisible in a demo, fatal over days.

**Client-side gap detection:** if an arriving event has `seq > lastSeq + 1`, refetch `GET /runs/:id`.
Two lines, and it makes the system self-healing rather than merely correct.

### The `queued` event

The brief names `queued` in the event sequence. The run *row* is created as `queued`, but a row is not an
event — a client attaching to the stream would never see it. So `POST /tasks/:id/run` writes
`{seq: 1, type: "status", message: "queued"}` **in the same transaction as the run insert**, before
returning 202. This also guarantees at least one event exists before any client can connect, removing an
empty-replay edge case and the dead window where the UI has a `runId` and nothing to display.

---

## 8. The run engine

Each agent carries a **simulation profile** — steps, duration ranges, failure rates:

```ts
{
  name: "Invoice Parser",
  steps: [
    { label: "Fetching document", minMs: 600,  maxMs: 1200, failureRate: 0.02 },
    { label: "Extracting fields", minMs: 1200, maxMs: 2600, failureRate: 0.10 },
    { label: "Validating totals", minMs: 400,  maxMs: 900,  failureRate: 0.05 },
    { label: "Writing results",   minMs: 300,  maxMs: 600,  failureRate: 0.01 },
  ]
}
```

```ts
async function execute(profile, sink, { clock, rng }) {
  if (await sink.isCancelRequested()) { await sink.emit("status", "cancelled"); return; }
  await sink.emit("status", "running");

  for (const step of profile.steps) {
    if (await sink.isCancelRequested()) { await sink.emit("status", "cancelled"); return; }
    await sink.emit("log", `${step.label}…`);
    await clock.sleep(rng.intBetween(step.minMs, step.maxMs));
    if (rng.float() < step.failureRate) {
      await sink.emit("error", `${step.label} failed`);
      await sink.emit("status", "failed");
      return;
    }
    await sink.emit("log", `${step.label} — done`);
  }
  await sink.emit("status", "completed");
}
```

### Why the injection matters

Three dependencies are injected: `clock`, `rng` (random number generator), and `sink`.

- **In the app:** real clock, real randomness, events written to SQLite then a wakeup published.
- **In tests:** a fake clock that advances instantly, a **seeded** RNG, an in-memory sink.

A seeded RNG produces the same sequence every time for a given seed. So
`test("emits failed when extraction fails")` is deterministic and runs in ~2ms — on a system whose entire
premise is multi-second nondeterminism. Without it, tests would sleep for real and assert on
probabilistic outcomes: flaky tests, therefore ignored tests.

Roughly fifteen lines, and the highest-leverage decision in the project.

### Cancellation is cooperative

The cancel check sits **between** steps. Work in flight cannot be interrupted — only asked to stop and
allowed to notice at the next checkpoint. Not a shortcut: this is how Kubernetes, every job queue, and
every well-behaved worker operates. `POST /runs/:id/cancel` sets `cancel_requested`; the engine observes
it at the next boundary.

### Failure containment

The fire-and-forget call is wrapped: `void executeRun(id).catch(markFailed)`. An unhandled rejection
would otherwise leave the run at `running` forever, recoverable only on the next restart.

### Orphan recovery

If the process restarts mid-run, that run is stuck at `running`. On boot, mark anything left in `queued`
or `running` as `failed` with `error = "interrupted by restart"`. ~10 lines. **Note:** this is exactly
the code that becomes wrong under horizontal scaling — see §12.

---

## 9. Frontend

### How rendering actually works

A **client-rendered SPA**. The server never builds HTML for a page. One port, two jobs, decided by a
single rule:

| Request | Server does |
|---|---|
| `/api/**` | Runs the route handler — JSON, or a held-open SSE stream |
| `/assets/**` | Returns the built file from disk |
| **anything else** | **Returns `index.html`** — the catch-all |

First load of a deep link like `/tasks`: browser requests it → Hono matches no API route and returns
`index.html` → the bundle downloads and React boots → **React Router** reads the URL and renders the
shell with skeletons → TanStack Query fetches from `/api`, and any live run opens its stream.

Two consequences: the server returns the *same* `index.html` regardless of path — it doesn't know the
route table, which is why the catch-all is mandatory (§11a). And after that first load, navigation costs
nothing: it's a local component swap, with only data crossing the network.

The cost is a blank screen until the JavaScript executes. Server rendering would fix that, and would be
right for a public, indexable, slow-connection-facing site. This is none of those.

### Routes and layout

```
/                 → redirect to /agents
/agents           → agents grid, filter
/agents/:agentId  → agent selected, its tasks alongside
/tasks            → all tasks, with the agent column
```

Two panes on desktop, stacked on mobile.

**Why React Router rather than URL-as-state.** The original call was `?agent=&task=` via
`history.replaceState` — ~15 lines, no dependency, on the reasoning that selecting an agent filters a
pane rather than navigating. Three things overturned it:

1. **There are genuinely two views.** The all-tasks view (below) is a separate screen, so the
   one-screen premise is false.
2. **`replaceState` doesn't create history entries**, so back after selecting agent A then B would leave
   the app rather than return to A. Users expect back to undo a selection — Gmail, Slack and Linear all
   push. Fixing that means `pushState` plus a `popstate` listener plus syncing into React state, which is
   writing a small worse router.
3. **Route-level error and loading boundaries are graded**, and a router gives them a declarative home.

Not TanStack Router: better designed and fully type-safe, but React Router is what a reviewer reads
without pausing, and §2 says easy to explain.

**Agents pane** — filter input matching name **and** description as the user types. Client-side: the
dataset is small, and a debounced round-trip would be slower and worse.

**Tasks pane** — two modes: tasks for the selected agent, and an **all-tasks view**. The all-tasks view
exists because the brief asks for a list showing status *and assigned agent* — inside a selected agent
the agent is implicit, so that column would have nothing to show. Every task row displays the agent name
regardless.

**Create task** — a real, changeable agent picker, not a fixed label pre-filled from selection. This is
also what makes the "400 for a nonexistent agent" path reachable from the UI.

**Run** — inline expanding log pane, live. Retry on failure, cancel while running.

### The one hook that matters

`useRunStream(runId)` opens an `EventSource` with `?since=lastSeq`, applies only events with
`seq > lastSeq`, refetches on a detected gap, closes on `done`, and patches the TanStack Query cache so
the task list and the log pane never disagree. All reconciliation between the REST snapshot and the live
stream lives in this one file — which is why swapping per-run connections for one multiplexed stream
later means changing this hook and nothing else.

### States

- **Loading** — skeletons, not spinners, so layout doesn't jump.
- **Empty** — "No agents yet" with a create affordance. Never a blank pane.
- **Error** — inline, with retry. An error boundary catches the rest.
- **Disconnected** — visible indicator; `EventSource` reconnects on its own and resumes from `lastSeq`.

### Stats footer (bonus)

Total agents, total tasks, runs by status, from `GET /stats`.

---

## 10. Testing

**Engine** (`core/`) — pure, seeded, fake-clocked, millisecond-fast:
- happy path emits the expected event sequence in order
- seeded failure produces `failed` and stops at the right step
- cancel before start, and cancel between steps, both produce `cancelled`
- `seq` is strictly monotonic

**API** (Hono test client — no port binding):
- `POST /tasks` with a nonexistent `agent_id` → 400 with the right code
- `POST /tasks` with a missing title → 400
- full run lifecycle: start → terminal state → run appears in task history
- second `POST /run` while one is active → 409
- `POST /runs/:id/cancel` → run reaches `cancelled`
- SSE with `?since=3` **against an already-terminal run** replays only `seq > 3`, sends `done`, and
  closes. Asserting against a live run means asserting against a stream that doesn't end — the fastest
  way to hang CI. `AbortController` as a backstop regardless.

**Frontend** (Testing Library):
- filter narrows on name and on description; no-match shows an empty state
- status indicators render for running, success, failed
- a mocked event source driving running → completed updates the UI
- a failed run exposes a retry control

---

## 11. Local development

```bash
npm i -g pnpm      # corepack is being unbundled from Node; don't assume pnpm exists
pnpm install
pnpm dev           # API + web, migrated and seeded automatically on first boot
```

No Docker, no database install, no `.env`, no credentials, **and nothing that compiles during install**.

**Migrations run programmatically on server boot**, not as a separate CLI step — otherwise `pnpm dev`
isn't really one command. On open: `mkdir -p` the data directory, `PRAGMA journal_mode = WAL`, and set a
`busy_timeout`. `.nvmrc` and `engines.node` pin the Node version. The SQLite file is gitignored and
recreated with seed data if absent.

### Process topology: two in dev, one deployed

```
Local dev                              Deployed
  Vite  :5173   React, HMR               Hono :3000
  Hono  :3000   API                        ├─ /api/*  → routes
  Vite proxies /api → :3000                └─ /*      → built React files
```

**Two locally** because Vite's dev server is what provides hot module reload and on-the-fly
transpilation; a static file server can't. The browser talks only to `:5173`, so there's no CORS in dev
either. `pnpm dev` runs both in parallel — still one command.

**One deployed** because `vite build` emits static files that Hono serves alongside the API. One process,
one port, one URL, no CORS, no second deployment, no sleeping backend.

Rejected: Vite in middleware mode inside Hono for a single dev process. It works, but couples the API
server to a build tool for no real gain.

**The cost** is a dev/prod divergence, and it sits exactly where the SSE bug lives: Vite's proxy buffers
streams unless configured otherwise (`changeOrigin`, compression off). Mitigation — **`pnpm start`**
builds and runs the single-process production mode locally, so the shipped configuration is verifiable
rather than assumed. Verify at rung 4, not at the end.

Seed data is ~6 agents with deliberately different personalities — one fast and reliable, one slow, one
failing ~30% of the time — so every code path is reachable by clicking rather than by waiting for luck.

Also available: `pnpm test`, `pnpm seed --reset`, and `pnpm demo:run <agent>` (§13).

---

## 11a. Deployment

**Render**, paid starter tier, one instance, one persistent disk. Deployed at rung 1, before there is
anything on top of it to confuse a failure.

Three requirements drive the choice of *host type*: a **long-lived process** (execution outlives the
request), a **disk** (SQLite), and **exactly one instance** (in-process bus). Render, Fly and Railway all
satisfy those; the choice between them is about operator experience, not architecture.

### Why Render over Fly

Fly was the original call, on one strong argument: `fly ssh sftp get /data/app.db` pulls the production
database onto a laptop in one command, which for an app whose entire state is one file is the best
debugging move available.

**Reversed on time-box risk.** Deployment is a *bonus* item, and Fly means learning a CLI, `fly.toml` and
volumes on a deadline. Render is connect-the-repo-and-click — the same shape as the Vercel workflow
already familiar from other projects — plus one-click rollback to any previous deploy and a searchable
log dashboard. Auto-deploy on push is built in, so no GitHub Action is needed either.

Nothing about the design changes: both run a long-lived Node process from the same Dockerfile, so
switching hosts later is an afternoon.

Render's **free** tier is ruled out regardless — a 30–60 second cold start reads as a broken link.

*Pricing, disk availability and shell-access tiers move; verify at rung 1 rather than trusting this
document.*

### Why not Vercel — stated accurately

The *serving* shape — static bundle plus API — is exactly what Vercel is best at, and nine of our ten
endpoints would be at home there. Only `POST /tasks/:id/run` and its streaming counterpart aren't: one
returns immediately then works for fifteen seconds, the other holds a connection open.

And it is genuinely **feasible**: swap SQLite for Neon Postgres, swap the in-process bus for Upstash
Redis, trigger runs with `waitUntil` or QStash. Two swaps and two vendors — not a rewrite.

It's rejected on **one requirement**. Both managed services need connection strings, so "clone it and run
it, no credentials" is gone — the constraint §2 puts above everything else. Secondarily, `vercel dev`
only approximates the serverless runtime, whereas `pnpm start` here *is* the deployed artifact.

For a production SaaS the Vercel path may well be the better one: managed everything, no server to patch,
preview deploys per PR. That is the position the README should take (§14) — the in-process choices are
for local runnability, and production would go the other way.

### Dockerfile, not a buildpack

Multi-stage: build (`pnpm install`, build web + server) → runtime (`node:24-slim`, dist + prod deps,
non-root user). Written by hand rather than generated.

The reason is debugging, not portability: `docker build && docker run` locally reproduces the **exact**
production runtime — same Node, same OS libraries, same layout. A buildpack builds in the host's
environment, which cannot be reproduced locally, so a prod-only failure has no bisect path. Portability
across hosts is a secondary benefit.

### Instance count is an architectural invariant, not a cost setting

**Instance count must stay at 1.** The event bus is in-process and the database is a file on one disk; a
second instance would see neither. It would scale up under load and appear healthy while dropping every
event for half of all users.

Record this in `render.yaml` with a comment, and note that raising it requires §12's store and bus swaps
*first*.

Helpfully, attaching a persistent disk generally constrains a service to a single instance and changes
deploys from rolling to stop-then-start — so the infrastructure enforces what the design already
requires, and there is no window where two instances overlap mid-deploy. **Verify this behaviour at
rung 1**; if the platform does roll instead, two instances briefly coexist during every deploy and the
in-process bus is wrong for that window.

### Setup sequence

1. New Web Service → connect the GitHub repo → **Docker** as the runtime.
2. Add a persistent disk, mounted at `/data`.
3. Environment: `DATABASE_URL=file:/data/app.db`, `NODE_ENV=production`.
4. Health check path → `/health`.
5. Instance count → **1** (see above).
6. Deploy. Auto-deploy on push to `main` is on by default — no CI workflow needed.
7. Custom domain → add `agents.<domain>`, point the CNAME, certificate issues automatically. **Only after
   the `.onrender.com` URL is confirmed working.**

### Built at rung 1, because they are useless retrofitted

- **Source maps in production.** Without them every stack trace points at line 1 of a bundle.
- **A real `/health`** returning commit SHA, Node version, and whether the database opened. The first
  question during any incident is "is what I'm looking at what I deployed?"
- **Structured JSON logs with a request id**, echoed in every error response. "It broke" plus a
  screenshot becomes one grep.
- **`pnpm start`** — production mode locally (§11).

### Deployment-specific gotchas

- **SPA catch-all.** Client-side routing means a deep link like `/tasks` reaches the *server* with that
  path. Without a catch-all serving `index.html` for every non-`/api`, non-asset path, a link that works
  inside the app 404s when pasted into Slack. Three lines in Hono, and it only ever shows up once
  deployed — another reason deploy is rung 1. Order matters: API routes and static assets are matched
  first, catch-all last.
- **SSE buffering** — same class as the Vite proxy. `Cache-Control: no-cache` plus the 15s heartbeat.
  Finding this at rung 1 with only `/health` deployed is the entire reason deploy comes first.
- **Health check must not point at a streaming endpoint** — the instance gets killed as unhealthy.
- **`SIGTERM` on deploy** kills in-flight runs. Boot-time orphan recovery catches them, but handling
  `SIGTERM` directly — stop accepting new runs, mark in-flight as interrupted — turns "the run vanished"
  into "interrupted by deploy." ~15 lines.
- **Debugging without `ssh sftp`.** Fly's one-command database download isn't available here, so build
  the replacement in: an authenticated `GET /admin/db` that streams the SQLite file, or a `/health`
  detailed enough to answer most questions without one. Decide at rung 1 — this was Fly's single
  advantage and it should be consciously replaced rather than quietly lost.

### Branch strategy

`main` is the deliverable: one service, SQLite, simple to run.

**After `main` is working and shipped**, a `postgres-store` branch swaps only `RunStore` — roughly a day.
The value is the diff: ~40 lines changed, `core/` untouched, every engine test passing unmodified. That
converts this document's central claim from an assertion into something verifiable by reading a diff,
which is stronger evidence than a working queue would be — the question being tested is whether the
boundaries are real, not whether SQS can be wired up.

Explicitly **not** built: the full queue + worker + Redis + Postgres topology. Four deployables,
~$15–30/month, ~a week dominated by lease semantics and retry classification. It competes with the main
deliverable, and a branch that half-works costs more than no branch. It stays a costed design (§12a,
§12b), which is what the question actually asks for.

---

## 12. Seams, and what changes at scale

Three interfaces, because production genuinely needs something different behind each:

| Seam | Now | Later |
|---|---|---|
| `RunStore` | SQLite via libSQL | Postgres |
| `EventBus` | In-process wakeup | Redis pub/sub or Postgres `LISTEN/NOTIFY` |
| `useRunStream` | One `EventSource` per run | One multiplexed stream |

Starting a run is a single function call in the HTTP layer. Pointing it at a durable queue means changing
that call site and deploying a worker — deliberately *not* wrapped in a `Dispatcher` interface, because a
one-implementation indirection over one function call is ceremony.

### Limitations, honestly rated

| Limitation | Why accepted | Fix | Rating |
|---|---|---|---|
| Restart orphans in-flight runs | Rare locally | Mark stale runs failed on boot (built, §8) | 🟢 |
| In-process bus doesn't cross instances | Single process | Redis behind `EventBus`; wakeup-only semantics make this a true swap | 🟢 |
| Six concurrent SSE streams (HTTP/1.1) | Demos won't reach it; **moot over HTTP/2**, which every managed host terminates | Multiplex behind `useRunStream` | 🟢 |
| SQLite → Postgres | Single process | Types survive; the **schema file is rewritten** — Drizzle schemas are dialect-specific (`sqlite-core` vs `pg-core`), and date storage and concurrency semantics differ | 🟡 |
| Running more than one instance | Not needed | Not just a store+bus swap: orphan-recovery-on-boot becomes *actively wrong*, since instance B would mark instance A's live runs as failed. Needs leases or heartbeats | 🟡 |
| Client-side filtering | Six agents | Server-side search + pagination | 🟡 |
| Runs don't survive a deploy | Nothing is running during a take-home deploy | Durable queue + separate worker process | 🔴 |
| No auth | Out of scope | New concern, touches every endpoint | 🔴 |

🟢 swap an implementation · 🟡 contained but real change · 🔴 genuinely new architecture

The two yellows that look like they should be green are the interesting ones, and noticing them is worth
more than the green dots would be.

---

## 12a. Migration path: single server → serverless + queue

We considered serverless with a durable queue and chose a single long-lived process. This section records
what reversing that would cost, since it is the most likely question about the architecture.

**Estimated total: ~1 week of focused work, roughly 70% operational rather than code.**

### Unchanged

`core/` (the engine) · the repository *interfaces* · the HTTP handlers · the API contract · event-log
semantics (`seq`, replay, `?since=`, resume) · every engine test. SSE reconnect keeps working across the
migration without modification.

If any of those required a rewrite, this design would be wrong. They don't.

### Changed

| Component | Now | Target | Cost |
|---|---|---|---|
| Store | SQLite | Postgres | ~0.5d — rewrite schema file (`sqlite-core` → `pg-core`), swap driver, fix date handling |
| Event bus | In-process wakeup | Redis pub/sub or `LISTEN/NOTIFY` | ~2h — publishing a `runId` to a channel is the whole change. This is the payoff of the wakeup-only decision |
| Execution trigger | `executeRun(id)` | `queue.send({runId})` | One line |
| **Worker** | — | New deployable | 1–2d — see below |
| Orphan recovery | Mark stale runs failed on boot | Lease-expiry sweeper | ~0.5d — the current version becomes actively wrong |
| **Streaming tier** | Same process | Needs a decision | 1–3d — see below |
| Infra | `git push` | IaC, secrets, two pipelines, queue config, monitoring | 1–2d |

### The worker is delivery semantics, not execution logic

The engine already exists and is pure. What you write is everything surrounding *at-least-once delivery*:

- **Idempotent claiming** — `UPDATE runs SET status='running', worker_id=?, lease_until=? WHERE id=? AND
  status='queued'`, bail on zero rows affected. The queue will deliver the same message twice.
- **Lease renewal** — a run outliving the visibility timeout makes the message reappear and a second
  worker start the same run. Heartbeat to extend while working.
- **Retry classification** — "the agent failed" and "the worker crashed" are currently the same thing.
  They must become different: the first must *not* be retried, the second must. Backwards means either
  swallowing crashes or re-running completed work.
- **Dead-letter queue** for poison messages, plus something watching it.

### Serverless and SSE are in tension

A long-lived SSE connection holds a function invocation open for its whole duration — you stop paying for
compute and start paying for wall-clock connection time. Platform limits bite: API Gateway caps HTTP
responses at 30s; Vercel's ceiling is minutes.

So "serverless + queue" in practice means **serverless API + queue + worker + a separate non-serverless
streaming tier** — a small always-on service, or a managed realtime product (Ably, Pusher, Supabase
Realtime, Cloudflare Durable Objects). That fourth component is the one usually missed when this is
sketched on a whiteboard.

### Local development regresses

The target needs Postgres, Redis and a queue emulator locally — precisely what §2 optimises against.
Mitigation: keep the in-process implementations as the *development* profile, selected by environment.
The interfaces that make the migration possible are the same ones that keep dev simple.

### Trigger conditions

Not a schedule — an event. More than one instance needed (traffic or HA) · runs long enough that losing
them on deploy is unacceptable · runs needing retry on infrastructure failure · load bursty enough to
want the queue as a buffer. Until one is true, the full operational cost buys nothing.

### The framing

**Serverless doesn't make this design better — it makes it necessary.** The persisted event log with
monotonic sequence, the payload-free bus, cooperative cancellation, execution outliving the request: all
of it is what serverless would *require*. We built the architecture and skipped the infrastructure.

The genuinely wrong trade would be the opposite one — serverless with state in memory. That works on day
one and fails silently the moment there are two instances.

### Precise statement of what is and isn't in memory

Worth stating exactly, because the loose version gives away a point the design earns.

**The run's state is durable from creation.** The run row and its first event are written before `POST
/run` returns 202, and every subsequent event is written to the store *before* any wakeup is published.
What lives in memory is only the **executing function**. If the process dies we lose the execution, not
the record — the run is still queryable with its full log up to the crash, and boot-time reconciliation
resolves it.

The general invariant is not serverless-versus-server; every Kubernetes deployment is a long-lived
process. It is: **the process is disposable, the state is not.** Serverless enforces that by removing
memory; a container merely permits it.

---

## 12b. Target architecture for real agents

The shape this points at once execution stops being simulated.

```
                    ┌──────────┐
                    │  Client  │◀──────────────┐
                    └────┬─────┘               │
                         │                     │
                         ▼                     │
              ┌─────────────────────┐   ┌──────┴───────┐
              │  API control plane  │   │ Fan-out tier │
              │ writes intent,      │   │ pushes       │
              │ returns immediately │   │ updates      │
              └────┬───────────┬────┘   └──────▲───────┘
                   │           │               │
                   ▼           └──────────┐    │
          ┌─────────────────┐             ▼    │
          │  Durable queue  │      ┌──────────────────┐
          │ survives both   │      │   State store    │
          │ sides           │      │ every step       │
          └────────┬────────┘      │ journaled        │
                   │               └─────────▲────────┘
                   ▼                         │
        ┌────────────────────────┐           │
        │    Execution plane     │───────────┘
        │ sandboxed agent workers│
        └────────────────────────┘
```

**Three properties define it:**

1. **Every arrow reaching the client originates from the store** — never from the API's memory or a
   worker's memory. A run must be fully reconstructable from durable state alone, so any component can be
   killed at any moment.
2. **The control plane never executes; the execution plane never serves requests.** They scale on
   different curves — thousands of short requests versus a handful of long expensive ones. Coupling them
   means over-provisioning one to serve the other.
3. **The queue and the store answer different questions.** The queue says *someone will pick this up*.
   The store says *here is exactly how far it got*. That is the retry-versus-resume distinction.

### Retry is not resume

The distinction that matters most for agents specifically. A queue guarantees a failed run is **retried**
— handed back to a worker that starts at step 1. For an 8-second simulation that's equivalent to
resuming. For a real agent — 40 steps, 12 minutes, six external API calls, real model spend — a crash at
step 39 means paying twice, waiting twice, and re-executing every side effect.

**Durable execution** (Temporal, Restate, Inngest, AWS Step Functions) journals each completed step so a
crash resumes at 39, not at 1. It brings two requirements with it:

- **Idempotency keys on every side effect** — re-running a step that already charged a card or sent an
  email is worse than losing the run outright.
- **Long-running execution**, which is why plain FaaS is often the *wrong* home for agent work: Lambda
  caps at 15 minutes and agent runs routinely exceed it. Enterprise agent platforms run on containers or
  a durable-execution engine, not raw functions.

### How streaming works once the worker is separate

The worker never talks to the browser. It writes each event to Postgres, then publishes a **payload-free
wakeup** to Redis. Whoever holds the SSE connection receives the wakeup and re-reads Postgres for
`seq > lastSent`.

The §7 wakeup-only decision pays off far more here than it does in a single process: **because the
message carries no payload, Redis's delivery guarantees stop mattering.** Redis pub/sub is
fire-and-forget — a momentarily disconnected subscriber simply misses messages. If the event were in the
message it would be gone permanently; as a wakeup, a dropped message costs latency until the next
heartbeat and never costs data.

*Footnote: Postgres `LISTEN/NOTIFY` does not substitute for Redis on serverless. `LISTEN` requires a
dedicated long-lived connection, and poolers in transaction mode don't support it. It's a fine way to
avoid running Redis on a long-lived server; it's the wrong tool on functions.*

**Who holds the connection** — four answers:

| Option | How | Cost |
|---|---|---|
| **1. Serverless function** | Invocation subscribes to Redis, writes to the response stream | Billed on wall-clock, not compute; Redis connections scale with *viewers*; dies at the duration cap — though `EventSource` reconnects with `Last-Event-ID` and the next invocation resumes exactly where the last stopped, invisibly |
| **2. Long-polling** | `GET /events?since=7` waits ~25s, returns, client re-requests | Fits any duration limit, no persistent connections. More invocations, a little latency. Underrated |
| **3. Managed realtime** (Ably, Pusher, Supabase Realtime) | Worker publishes to a channel; the function only mints a scoped token | Nothing of yours held open; fan-out is their problem. Another vendor and an SDK on the client. Keep the DB replay path — snapshot with `lastSeq`, then subscribe, dedupe by `seq` |
| **4. Cloudflare Durable Objects** | One object per run holds connections and coordination state | Arguably the most elegant fit — the stateful thing gets to be stateful with no server to babysit. Cloudflare-specific, different mental model |

**Choose by run duration:**

| Runs last | Use |
|---|---|
| Seconds | Option 1 — reconnect covers the cap |
| Seconds to minutes | Option 2 — cheaper than fighting duration limits |
| Minutes to hours (**real agents**) | Option 3 or 4 — holding an invocation for an hour is untenable at any price |

The honest one-line answer to "how does streaming work in production": **you stop holding connections on
your own compute, because that is the single thing serverless is worst at.**

Note that option 1's viability rests entirely on resume-after-disconnect — the `seq` + `Last-Event-ID`
+ `?since=` design from §7, built here for refresh-mid-run, is the same mechanism that makes serverless
streaming survivable at all.

### Production would *also* be servers — on the merits, not as a compromise

The reflex answer to "how would you run this in production?" is serverless. For a typical SaaS — request
in, query, response out, spiky traffic, nothing long-running — that reflex is correct.

**An agent platform is the exception**, and it's worth saying so explicitly because it inverts the
expected answer:

| Workload | Shape | Serverless fit |
|---|---|---|
| Agent runs | Minutes to hours, CPU-light, mostly waiting on external calls | ❌ duration caps, and you pay for waiting |
| Live progress streaming | Many long-held connections | ❌ the single worst case for serverless |
| CRUD API | Short requests, modest B2B volume | ✅ fine — but the smallest part of the work |
| Sandboxed tool execution | Needs runtime control and isolation | ❌ |

**The two dominant workloads are precisely the two things serverless is worst at.** Which matches what
real agent platforms actually run: containers or Kubernetes for execution (sandboxing needs control), a
durable execution engine (Temporal, Inngest) for long workflows, and often a managed realtime service for
streaming. Not FaaS.

So the production answer for a product like this is **containers + queue + durable execution**, with
serverless at most for the thin CRUD API.

The rule underneath: *serverless is for work that starts and finishes quickly. The more of a product's
value lives in things that take a long time or stay connected, the less it fits.* An agent platform is
close to the definition of "takes a long time and stays connected."

**Note this makes the local choice and the production choice agree** — a long-lived process is right in
both, for different reasons. Local: zero-setup runnability. Production: the workload shape. The pieces
that differ between them are exactly the ones behind interfaces (§12).

### How the current build maps onto it

| Target plane | Ours today |
|---|---|
| API control plane | Hono route handlers |
| Durable queue | Collapsed into a function call |
| Execution plane | The run engine, same process |
| State store | SQLite |
| Fan-out tier | The SSE endpoint |

Same five responsibilities, sharing one process. And the mechanism already generalises: **the sequence
numbers that let a browser resume mid-stream are the same mechanism that lets a worker resume mid-run.**

---

## 13. Build ladder

Each rung runs and demos on its own.

1. **Skeleton + deploy.** Workspace, TypeScript, Hono responding on `/health` — **and deployed**.
   Deployment is the riskiest single step (build config, Node version, static file serving, SSE buffering
   through the host's proxy) and it is a *bonus*. Doing it when there is nothing to go wrong takes twenty
   minutes; doing it on deadline day is how the bonus gets lost. Every later rung is then a `git push`
   that self-verifies.
2. **Store + seed.** Schema, migrations-on-boot, repositories, seed script with 6 agents.
   *Note: the `SimulationProfile` type is settled here, in `core/`, even though the engine that consumes
   it arrives at rung 3 — a real backward reach, named so it doesn't surprise us.*
3. **Run engine + CLI harness.** State machine with injected clock/RNG/sink, plus its tests. Ships with
   `pnpm demo:run invoice-parser`, ~5 lines, printing the event stream to stdout — so the rung is
   demoable without HTTP, database or browser, which is the entire point of it.
4. **API + SSE.** All endpoints. Full flow exercisable with `curl` alone. Verify SSE through the Vite
   proxy here.
5. **a — Read-only UI.** Agents list, filter, task list, all-tasks view, status indicators, **and the
   empty / loading / error states**. These are graded requirements; parking them in a "polish" rung is
   how they get dropped when time runs short.
   **b — Interactive UI.** Create task, run, live logs, retry, cancel, stats footer.
6. **Tests + polish.** Frontend tests, responsive pass, README.
7. **Custom domain.** Optional and cheap once rung 1's URL is confirmed working.

---

## 14. README outline

Setup and run · architecture with the §4 diagram · **the streaming approach and why SSE** (the brief asks
for this explicitly) · the seams table · the limitations table verbatim, including the yellows · testing
approach and how to run them.

### Must be stated explicitly: the local/production split

The README should say plainly that **the in-process choices are for local runnability, and production
would go the other way** — serverless functions, managed Postgres and Redis, no server to babysit.

The reasoning, in the README's own words:

> Nine of the ten endpoints are exactly what a serverless platform is best at. One isn't: `POST
> /tasks/:id/run` returns immediately and then works for fifteen seconds, and it has a streaming
> counterpart that holds a connection open. That's entirely doable serverless — `waitUntil`, managed
> Postgres, managed Redis — but all three mean connection strings, and the priority here was that
> anyone can clone this and run it with none. So the architecture is serverless-shaped and the
> infrastructure is skipped: state is durable from the moment a run is created, the bus carries no
> payload, cancellation is cooperative, and execution outlives the request. Every one of those is what
> serverless would *require*, not a concession to it.

This framing matters because it inverts the obvious reading. The in-process implementation isn't a
simplification the design tolerates — it's the one piece deliberately left swappable, and §12a prices the
swap.

### And the second inversion: production is servers too

The README should then go one step further, because the expected answer is wrong for this product:

> The reflex is that production means serverless. For most SaaS that's right. An agent platform is the
> exception: its two dominant workloads are runs that last minutes to hours and connections held open to
> watch them — precisely the two things serverless handles worst. Which is why real agent platforms run
> containers for execution, a durable execution engine for long workflows, and often a managed realtime
> service for streaming. So production here is **containers + queue + durable execution**, with serverless
> at most for the thin CRUD API.
>
> Which means the local choice and the production choice agree, for different reasons. Locally a
> long-lived process is what makes zero-setup possible. In production it's what the workload actually
> wants. What differs between them is only what sits behind the interfaces in §12.

**Be precise about provenance.** The zero-setup constraint is self-imposed, not from the brief — the brief
asks for a README explaining setup, and nothing in it forces a server. `waitUntil` plus a hosted Postgres
would satisfy every stated requirement. The defensible phrasing is *"I imposed a constraint that this
runs with one command and no credentials, and that forced a server"* — not *"the requirements forced a
server,"* which anyone holding the brief can falsify.

One further note belongs there rather than here: hand-written shared types work only while every consumer
lives in this repo. A second consumer — a mobile app, a partner — means generating a client from an
OpenAPI spec. And a monorepo solves coordination at *authoring* time, not at *deploy* time; version skew
during rollout needs additive-only changes and contract tests regardless of repo layout.

---

## 15. Resolved

- **Styling** → Tailwind v4.
- **Routing** → React Router. *Reversed from an earlier "no router" decision: the all-tasks view added a
  second real screen, and `replaceState` breaks the back button on selection. See §9.*
- **Repo visibility** → public, so reviewers need no invite.
- **Expected challenge:** "one deployable, why three packages?" — because `core/package.json` declares no
  dependencies, so "the domain has no I/O" is verifiable by opening one file rather than trusted.
