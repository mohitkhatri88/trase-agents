# Trase Agents

Manage agents, create tasks, and run them with live streaming progress.

- **Agent** — a runnable capability. Execution is simulated here.
- **Task** — a concrete job assigned to an agent.
- **Run** — one execution attempt. A task can have many.

---

> **Status.** Everything below runs locally and is fully tested. The deployment artifacts
> (`Dockerfile`, `render.yaml`) are built and verified against a local container; the public URL goes
> live when the Render service is created — see [Deployment](#deployment).

## Setup

```bash
npm i -g pnpm     # if you don't already have it
pnpm install
pnpm dev
```

Then open **http://localhost:5173**.

No Docker. No database to install. No `.env` to fill in. No credentials. Nothing compiles during
install. Sample agents and tasks are seeded automatically on first boot.

| Command | What it does |
|---|---|
| `pnpm dev` | Vite on 5173 + API on 3000, proxied. The one command you need |
| `pnpm test` | Unit and integration tests (136) |
| `pnpm test:e2e` | Playwright end-to-end tests (29) — run `pnpm --filter @trase/e2e install-browsers` once first |
| `pnpm build && pnpm start` | Production mode locally: one process on :3000 serving API *and* UI |
| `pnpm typecheck` | TypeScript across every package |
| `pnpm db:reset` | Delete the local database so the next boot reseeds |

**Try this first:** open an agent, expand a task, hit **Run**, and watch the log stream in. The
*Flaky Web Scraper* fails about a third of the time, so it's the quickest way to see the error path
and **Retry**. The *Nightly Reconciler* is slow enough to **Cancel** mid-run. Run something twice and
a **Run history** section appears beneath the log — every past attempt, selectable.

**On seed data:** seeding is `seedIfEmpty`, not seed-on-every-boot. It runs only when there are no
agents, so your own tasks and runs survive restarts and are never overwritten. `pnpm db:reset`
deletes the local database when you want the sample data back.

---

## Architecture

```
   Browser (React SPA)
        │  REST + SSE
        ▼
   API (Hono) ──triggers──▶ Run engine
        │                       │
        │ reads                 │ writes events
        ▼                       ▼
        └────── SQLite ◀────────┘
                  │
            wakeup only
                  ▼
        Event bus ──▶ SSE handlers ──▶ re-read the store
```

**The load-bearing property, stated precisely:** the API *triggers* the engine but never *reads*
from it. Every byte the browser sees came out of the store. The bus only ever says "something
changed for run N" — never what changed.

### Layers

| Package | Responsibility |
|---|---|
| `packages/core` | Run engine and domain types. **No HTTP, no database, and `dependencies: {}`** — a claim you can verify by opening one file |
| `packages/server/store` | Repositories over Drizzle. The only place SQL lives |
| `packages/server/http` | Hono routes. Translate HTTP to store and runner calls; no business logic |
| `packages/server/bus.ts` | The wakeup bus |
| `packages/web` | React SPA |
| `packages/e2e` | Playwright |

### Rendering

A client-rendered SPA. One port, two jobs:

| Request | Server does |
|---|---|
| `/api/**` | Route handler — JSON, or a held-open SSE stream |
| `/assets/**` | Serves the built file |
| **anything else** | Returns `index.html` — the SPA catch-all |

That last row matters: without it, a deep link like `/tasks` reaches the server with that path and
404s, so a link that works inside the app breaks the moment it's pasted anywhere else. In dev it's
two processes (Vite needs to own hot reload); deployed it's one.

---

## Streaming — the approach, and why

### SSE, not WebSockets

Data flows one way: server to client. Cancel is a plain `POST`, so a bidirectional channel would be
paid for and unused.

The decisive argument is what you get for free. `EventSource` reconnects automatically and replays
`Last-Event-ID` on its own. With WebSockets you hand-write reconnection, backoff, and resume — the
part people usually get wrong. `POST /run` also returns `202` with a `runId` rather than streaming
its own response, because `EventSource` is GET-only, and "watch a run already in progress" needs a
separate GET endpoint anyway.

### The event log is the design

Every event is a row with a **monotonic `seq` per run**. That one decision produces run history,
multiple simultaneous viewers, resume-after-disconnect, and idempotent replay — a client holding
`seq = 7` asks for `8+`, and duplicates are harmless.

**Retry is a new `runs` row, not a state transition.** Which collapses three requirements into one
design: retry, run history, and random failure are the same feature seen from different angles. Run
history is `SELECT * FROM runs WHERE task_id = ?`.

The UI makes that visible rather than leaving it as an assertion: run a task more than once and every
attempt is listed beneath the log, with its own status, duration and error. Selecting an older one
replays its log from the store — and opens no stream, because a finished run has nothing left to say.
Nothing is ever overwritten, so the whole history stays inspectable.

**Tasks have no status column.** A task's status is derived from its most recent run. A denormalised
column would create two places that can disagree, and that disagreement is always found by a user
rather than by a test.

### The bus carries no payload

`bus.publish(runId)` is the entire message. Subscribers respond by re-reading the store.

This is deliberate, and it fixes a real race. The obvious design — replay from the database, then
subscribe to a bus carrying events — loses events: one emitted between the read and the subscribe
lands in the database *after* the query snapshot and on the bus *before* the subscriber exists. It's
gone permanently and the client never notices the gap.

Carrying only a wakeup makes that structurally impossible. A missed wakeup costs latency until the
next heartbeat; it can never cost data. It also means swapping this for Redis later needs no ordering
or delivery guarantees at all.

### Four things that are easy to get wrong, and are handled

1. **Two cursors, and the order between them.** The browser sends `Last-Event-ID` only on its *own*
   automatic reconnect, so a hard refresh mid-run opens a brand-new `EventSource` with no header and
   would replay from zero — hence `?since=`, supplied by the client from the REST snapshot. But the
   header **wins when present**: `EventSource` reconnects to the same URL, so `?since=` is frozen at
   whatever the cursor was when the stream first opened, while the header is current. Preferring the
   query string would replay the whole log on every reconnect.
2. **An explicit `done` event, and the client closes.** If the server just hangs up, `EventSource`
   treats it as a network failure and reconnects forever — one dangling connection per finished run.
3. **Unsubscribe on abort.** A closed tab aborts the stream but leaves the bus subscription alive
   unless explicitly closed. Invisible in a demo, fatal over days.
4. **Event names are prefixed `run.*`.** A bare `event: error` is delivered to `EventSource`'s own
   `error` handler, which also fires on connection failure — the two would be indistinguishable.

### One connection, not one per run

Only the run the user has **expanded** streams. Task-list statuses poll every two seconds instead.

A two-second lag on a status badge is invisible, and this keeps the app to a single live connection
no matter how many runs are executing — which sidesteps the browser's per-origin connection limit
(6 over HTTP/1.1) entirely rather than merely documenting it.

---

## Testing

**165 tests.** 136 unit and integration, 29 end-to-end.

```bash
pnpm test        # 136, ~2s
pnpm test:e2e    # 29, ~13s
```

### The thing that makes this testable

The run engine takes its clock, its randomness, and its event sink as **injected dependencies**.

- **In the app:** real clock, real randomness, events written to SQLite.
- **In tests:** a fake clock that advances instantly, a scripted or seeded RNG, an in-memory sink.

So `test("fails at exactly the step whose roll is under its failure rate")` is deterministic and
runs in about two milliseconds — on a system whose entire premise is multi-second nondeterminism.
Without it you'd be sleeping in tests and asserting on probabilistic outcomes: flaky tests, therefore
ignored tests. It costs about fifteen lines and it's the highest-leverage decision in the project.

### Coverage

| Suite | What it covers |
|---|---|
| `core` (16) | Engine state machine, failure injection, cancel before/between steps, seeded RNG reproducibility |
| `server` (90) | Store behaviour, sequence integrity, orphan recovery, all endpoints, **400 on a nonexistent agent**, 409 on double-run, cancel, and the full SSE contract |
| `web` (30) | Filter behaviour (name, description, case, clearing, empty state) and run status display driven by a mock `EventSource` |
| `e2e` (29) | Real browser against the real production build |

### How the e2e suite stays deterministic

Two complementary strategies:

**Real server, deterministic fixtures.** With `TRASE_E2E=1` the seed adds three fixture agents whose
outcome comes from the *simulation profile* rather than from chance — `failureRate: 0` can never
fail, `failureRate: 1` always fails, and a six-step agent is reliably slow enough to cancel. Nothing
is stubbed; the real streaming path runs. `TRASE_SPEED=0.02` compresses sleeps so a run finishes in
~50ms of real time while still exercising genuine timers, ordering, and async behaviour.

**Network mocking** (`mocked.spec.ts`) for states a healthy backend won't produce on demand: a failing
API, an empty dataset, a slow response, a 409, and a deliberately **gapped event stream** to prove the
client refetches instead of silently rendering an incomplete log.

Most SSE tests assert against an **already-terminal run**, so the stream closes deterministically —
asserting against a live one means asserting against a stream that never ends, which is the fastest
way to hang CI. But that alone would leave everything that only matters *while* a run is live with
no coverage, so two further tests read the stream incrementally against a running task: one asserts
that events arrive across multiple chunks with a gapless sequence, the other that abandoning the
stream releases its bus subscription.

---

## Decisions and trade-offs

| Decision | Choice | Why | Rejected |
|---|---|---|---|
| Hosting model | Long-lived Node process | Background work and an in-process bus just work | Serverless — see below |
| Database | SQLite via `@libsql/client` | Zero setup, the dominant constraint | `better-sqlite3` — v13 ships **zero prebuilt binaries** and falls back to a C++ compile, which fails on a machine without build tools |
| DB access | Drizzle | Schema declared once; types and migrations derived from it; thin enough to drop to raw SQL | Prisma — codegen step, abstracts SQL away |
| Framework | Hono | Port-free test client; `streamSSE` as a first-class helper | Express (manual SSE, no port-free tests); Fastify (close second — loses only on SSE being a plugin) |
| Validation | ~30 hand-written lines | Four fields across two endpoints, and the graded check — *does this agent exist* — is a database lookup no schema validator can do | Zod, until a third non-trivial body appears |
| Frontend data | TanStack Query | Loading, error, empty, and refetch states are all graded | Plain hooks — reimplements the same thing, worse |
| Routing | React Router | Two real views, and back/forward must work on selection | Hand-rolled `history` — `replaceState` creates no history entries, so back would leave the app |

### Two bugs found by checking, not by reasoning

Worth recording because they're the kind that survive code review:

**`better-sqlite3@13` ships no prebuilt binaries.** Installing it falls back to compiling C++ via
node-gyp — fine on a Mac with Xcode tools, a hard failure on Windows without Build Tools. That's a
coin flip on whether a stranger can run the project, decided by whether they happen to have a
compiler. Hence `@libsql/client`, which ships per-platform binaries as ordinary npm packages.

**libsql opens a separate connection per transaction.** Two concurrent runs deadlocked with
`SQLITE_BUSY`, and an in-memory database couldn't see its own tables inside a transaction at all. The
transactions weren't buying anything — `UPDATE … RETURNING` is atomic on its own and only one writer
advances a given run — so removing them fixed both problems. Statements outside a transaction share
one connection, which serialises them for free.

---

## Limitations

Rated honestly. 🟢 swap an implementation · 🟡 contained but real · 🔴 genuinely new architecture

| Limitation | Why accepted | Fix | |
|---|---|---|---|
| Restart orphans in-flight runs | Handled: marked failed on boot, with the reason written into the event log | — | 🟢 |
| In-process bus doesn't cross instances | Single process | Redis behind the same interface; the payload-free design makes this a true swap | 🟢 |
| Six concurrent SSE streams (HTTP/1.1) | We open one; also ~100 over HTTP/2, which every HTTPS host negotiates | — | 🟢 |
| SQLite → Postgres | Single process | Types survive, but the **schema file is rewritten** — Drizzle schemas are dialect-specific | 🟡 |
| Running more than one instance | Not needed | Not just a store+bus swap: **orphan-recovery-on-boot becomes actively wrong**, since instance B would mark instance A's live runs as failed. Needs leases | 🟡 |
| Client-side filtering | Six agents | Server-side search and pagination | 🟡 |
| A crash between the counter bump and the event insert skips a `seq` | The client treats a gap as "refetch", so the cost is one redundant request | — | 🟡 |
| Runs don't survive a deploy | Nothing is running during a take-home deploy | Durable queue plus a separate worker | 🔴 |
| No auth | Out of scope | Touches every endpoint | 🔴 |

The two yellows that look like they should be green are the interesting ones.

---

## What production would look like

**The reflex answer is serverless. For most SaaS that's right. An agent platform is the exception.**

Its two dominant workloads are runs lasting minutes to hours, and connections held open to watch
them — precisely the two things serverless handles worst. Which is why real agent platforms run
containers for execution, a durable execution engine for long workflows, and often a managed realtime
service for streaming.

So production here is **containers + queue + durable execution**, with serverless at most for the
thin CRUD API. The local choice and the production choice agree, for different reasons: locally a
long-lived process is what makes zero-setup possible; in production it's what the workload wants.

### Migrating would cost about a week, and ~70% of it is operational

**Unchanged:** the run engine, the repository interfaces, the HTTP handlers, the API contract, event
semantics (`seq`, replay, `?since=`), every engine test. SSE reconnect keeps working untouched.

**Changed:** SQLite → Postgres (~half a day). In-process bus → Redis (~2 hours, and cheap *because*
it carries no payload). `executeRun(id)` → `queue.send({runId})` (one line). Then the expensive part:
a worker is not execution logic — the engine already exists — it's **delivery semantics**. Idempotent
claiming, lease renewal, and retry classification, because "the agent failed" and "the worker
crashed" are currently the same thing and must become different.

**And the distinction that matters most for agents: a queue gives you *retry*; you need *resume*.**
For an eight-second simulation those are the same. For a forty-step agent that fails at step 39, a
queue hands the whole thing back and you pay twice. That's what durable execution (Temporal,
Restate, Inngest) buys, and it brings idempotency keys with it — because re-running a step that
already sent an email is worse than losing the run.

Pleasingly, the sequence numbers that let a browser resume mid-stream are the same mechanism that
lets a worker resume mid-run.

### On the constraint itself

The zero-setup requirement is **self-imposed, not from the brief**. Nothing in the brief forces a
server — `waitUntil` plus a hosted Postgres would satisfy every stated requirement. The honest
phrasing is *"I decided this should run with one command and no credentials, and that forced a
server"* — not *"the requirements forced a server."*

Serverless was rejected on exactly one point: managed Postgres and Redis both need connection
strings, so clone-and-run disappears. It's otherwise entirely feasible — two swaps and two vendors,
not a rewrite.

---

## Deployment

One process serving both the API and the built UI, from a single container.

```bash
docker build -t trase-agents .
docker run -p 3000:3000 -v trase-data:/data -e DATABASE_URL=file:/data/app.db trase-agents
```

**To Render:** dashboard → **Blueprints** → New Blueprint Instance → this repo. Not *New → Static
Site*; this is a Node process serving an API and the built UI from one port, which is a **Web
Service**. `render.yaml` declares the rest and auto-deploys on push to `main`.

`numInstances: 1` is a **correctness constraint, not a cost setting**. The event bus is in-process
and the database is a single file, so a second instance would see neither — it would look perfectly
healthy while dropping every event for half of all users. Raising it requires the store and bus swaps
described above, first.

### Cost

Two layers, and they're easy to confuse:

- **Workspace plan** — Hobby $0 / Pro $25. Buys team seats, bandwidth, audit logs.
- **Compute** — billed per instance, on top of any workspace plan.

A solo project needs only the free Hobby workspace. Note that paying for Pro would **not** remove the
free tier's cold start, because sleeping is a property of the *instance type*, not the workspace — a
$25 upgrade with a Free instance still sleeps.

The blueprint runs a **Starter instance (~$7/month, prorated by the second) on the free Hobby
workspace**, plus a 1GB disk. That buys the two things the free tier can't give:

- **It never sleeps.** Free spins down after 15 minutes idle and takes ~1 minute to wake, so a link
  someone clicks once shows a blank loading page for that minute.
- **The disk persists**, so a reviewer's tasks and run history survive restarts and deploys.

To run at zero cost instead: set `plan: free`, drop the `disk:` block, and point `DATABASE_URL` at
`file:/tmp/trase/app.db`. Seeding runs on boot, so every wake still serves a clean populated demo —
you just trade the cold start back in.

### Verified against the real container

These are the failures that only appear once containerised:

| Checked | Result |
|---|---|
| Static UI, SPA catch-all on `/tasks`, API, `/health` | All 200, correct content types |
| A run streaming end to end | 8 SSE frames, terminal `done` |
| Restart with a disk attached | Data survived, no reseed |
| Boot with an ephemeral path and no volume | Seeds itself, serves normally |
| `SIGTERM` mid-run | Run marked *"Interrupted by a server shutdown"*, not silently lost |
| Platform-injected `PORT` | Binds correctly (Render assigns its own) |

## Data model

```sql
agents      id, name, description, simulation_profile (json), created_at
tasks       id, title, description, agent_id → agents.id, created_at
runs        id, task_id → tasks.id, status, started_at, finished_at, error,
            cancel_requested, seq_counter
run_events  id, run_id → runs.id, seq, ts, type, message   -- UNIQUE (run_id, seq)
```

Integer autoincrement primary keys throughout, so "the most recent run" is deterministic even for two
runs created in the same millisecond. A real system would use ULIDs to avoid leaking counts.

## API

```
GET    /api/agents                 list
POST   /api/agents                 create
GET    /api/agents/:id             detail
GET    /api/agents/:id/tasks       tasks for an agent

GET    /api/tasks[?agent_id=]      list with agent + derived status
POST   /api/tasks                  create — 400 if the agent doesn't exist
GET    /api/tasks/:id              detail + run history

POST   /api/tasks/:id/run          202 { runId } — 409 if one is already running
GET    /api/runs/:id               run + full event list
GET    /api/runs/:id/events        SSE, resumable via ?since= or Last-Event-ID
POST   /api/runs/:id/cancel        202 — 409 if already finished

GET    /api/stats                  counts by status
GET    /api/health                 status, node version, commit
```

One error shape everywhere, so the frontend has exactly one thing to render:

```json
{ "error": { "code": "AGENT_NOT_FOUND", "message": "No agent with id 42", "details": { "field": "agentId" } } }
```

## Cancellation is cooperative

The engine checks for cancellation **between steps**. Work already in flight can't be interrupted —
only asked to stop and allowed to notice at the next checkpoint. That isn't a shortcut; it's how
Kubernetes and every job queue behave, and it's the only kind of cancellation that exists once the
thing doing the work isn't the thing receiving the request.
