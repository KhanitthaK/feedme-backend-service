# Technical Documentation — Backend

McDonald's cooking-bot **order controller** backend. Go 1.23, clean architecture, in-memory.
One shared domain core drives **two delivery adapters**: an HTTP REST API (consumed by the
[React frontend](https://github.com/KhanitthaK/feedme-frontend-service)) and a CLI
(interactive REPL + a `--scenario` mode used by CI).

- **Live API:** https://feedme-order-controller.fly.dev (`/healthz`, `/api/*`)
- **Live UI:** https://feedme-frontend-service.vercel.app

---

## 1. Architecture

The guiding idea is **one shared domain core with two delivery mechanisms**. All business
logic lives in `internal/usecase`; the HTTP API and the CLI are thin adapters over it. That is
why this backend satisfies *both* the assignment's CLI requirement *and* serves the live web UI
without duplicating a single rule.

```
React SPA ──HTTPS/JSON──▶ REST adapter ──▶ OrderController (in-memory)
                                              ▲
CLI (REPL / --scenario) ──────────────────────┘   same engine, no duplicated logic
```

**Dependency rule:** `domain ← usecase ← adapter ← cmd`. Dependencies point inward — the
domain knows nothing about HTTP or the terminal; the usecase knows nothing about JSON. New
delivery mechanisms (gRPC, WebSocket) or a persistence layer can be added at the edges without
touching the core.

### Package layout
```
cmd/
  server/main.go        # wire the HTTP server (reads PORT, default 8080)
  cli/main.go           # --scenario | interactive REPL
internal/
  domain/               # Order, Bot — pure types + enums, no imports
  usecase/
    controller.go       # OrderController — rules + state + concurrency
    ports.go            # Clock port (injectable time for tests)
  adapter/
    http/               # handler · router · dto · cors middleware
    cli/                # repl · deterministic scenario
scripts/                # test.sh · build.sh · run.sh  (backend-verify-result workflow)
Dockerfile · fly.toml · render.yaml
```

---

## 2. Domain model

| Type | Fields |
|------|--------|
| `Order` | `ID int` · `Type` (`NORMAL`\|`VIP`) · `Status` (`PENDING`\|`PROCESSING`\|`COMPLETE`) · `CreatedAt` · `CompletedAt` |
| `Bot`   | `ID int` · `Status` (`IDLE`\|`PROCESSING`) · `CurrentOrderID *int` |

The domain package has **no imports beyond the standard library** and no concurrency — it is
pure data.

---

## 3. OrderController — the core

Holds all state, guarded by a single mutex:

- `pending []*Order` — one ordered slice holding the invariant *"all VIP before all NORMAL"*
- `processing map[int]*Order` — orders currently held by bots
- `complete []*Order` — finished orders, in completion order
- `bots []*botHandle` — each wraps a `*Bot` + its `context.CancelFunc` + a `done` channel
- `orderSeq, botSeq int` — monotonic counters (unique, never reused)
- `mu sync.Mutex`, `cond *sync.Cond`

### 3.1 VIP priority insert
A VIP is spliced in just past the last VIP (front of its class); a NORMAL is appended. The
**same** function is reused when a removed bot requeues an order, so priority is always
preserved. Order numbers stay unique and increasing because `orderSeq` only ever increments.

```go
// insertPendingLocked — caller holds c.mu
if o.Type == domain.OrderTypeVIP {
    i := 0
    for i < len(c.pending) && c.pending[i].Type == domain.OrderTypeVIP {
        i++ // advance to the first NORMAL
    }
    c.pending = append(c.pending, nil)
    copy(c.pending[i+1:], c.pending[i:])
    c.pending[i] = o // front of its class
    return
}
c.pending = append(c.pending, o) // NORMAL -> end
```

### 3.2 Bot lifecycle (`runBot` goroutine)
Each bot is a goroutine: wait for work, take the front order, cook for the injectable
duration, then complete or — if cancelled — requeue and exit.

```go
for {
    c.mu.Lock()
    for len(c.pending) == 0 && ctx.Err() == nil {
        c.cond.Wait() // IDLE — zero CPU, woken by Broadcast()
    }
    if ctx.Err() != nil { c.mu.Unlock(); return } // bot removed while idle
    order := c.pending[0]; c.pending = c.pending[1:]
    // ... mark order PROCESSING, bot PROCESSING ...
    c.mu.Unlock()

    select {
    case <-c.clock.After(c.procDur): // finished -> COMPLETE
        // ... move to complete, bot -> IDLE, loop ...
    case <-ctx.Done():               // removed mid-cook -> requeue & exit
        c.mu.Lock()
        c.insertPendingLocked(order) // back to its priority position
        c.cond.Broadcast()
        c.mu.Unlock()
        return
    }
}
```

### 3.3 Remove-bot handshake (`RemoveBot`)
Removes the **newest** bot (highest id): pops it, calls `cancel()`, `Broadcast()`, then blocks
on the bot's `done` channel — guaranteeing the order is safely requeued **before** the API
responds. Removing when there are no bots returns an error (surfaced as `409`).

---

## 4. Concurrency model

The heart of the design — many goroutines touch shared state, so correctness here is everything.

- **One mutex** guards all state. Every HTTP handler and every bot goroutine locks before
  touching the queue or bot list. Verified with `go test -race`.
- **`sync.Cond`, not a busy-loop.** Idle bots `Wait()` and are woken by `Broadcast()` on order
  create / requeue — the IDLE state costs zero CPU.
- **`context.CancelFunc` per bot.** "− Bot stops the current process" *is* cancelling the
  context; it wins the `select` and triggers the requeue.
- **No lost wakeups.** Signalling always happens under the lock, and waits re-check the
  predicate in a `for` loop.

> **The complete-vs-cancel race.** If a bot's 10-second timer and its cancellation become ready
> at the same instant, Go's `select` picks one arbitrarily. Both outcomes are correct: complete
> → the order finishes; cancel → it is requeued. The order is never lost or duplicated.

---

## 5. REST API

All routes under `/api`. JSON bodies, uppercase enums, RFC 3339 timestamps. CORS allows the
browser origin; arrays serialize as `[]`, never `null`.

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST   | `/api/orders` | `{"type":"NORMAL"\|"VIP"}` | `201 { order }` · invalid → `400` |
| POST   | `/api/bots`   | — | `201 { bot }` |
| DELETE | `/api/bots`   | — | `200 { removedBotId }` · none → `409` |
| GET    | `/api/state`  | — | `200 { pending, processing, complete, bots }` |
| POST   | `/api/reset`  | — | `200 { ok:true }` |
| GET    | `/healthz`    | — | `200 ok` |

```jsonc
// GET /api/state
{
  "pending":    [ { "id":1, "type":"NORMAL", "status":"PENDING", "createdAt":"...", "completedAt":null } ],
  "processing": [ { "id":2, "type":"VIP",    "status":"PROCESSING", "createdAt":"...", "completedAt":null } ],
  "complete":   [],
  "bots":       [ { "id":1, "status":"PROCESSING", "currentOrderId":2, "remainingSeconds":10 } ]
}
```

---

## 6. CLI

```bash
# interactive REPL — same engine as the REST server
go run ./cmd/cli
#   normal | vip | +bot | -bot | status | help | quit

# deterministic scenario used by CI — writes scripts/result.txt with HH:MM:SS timestamps
go run ./cmd/cli --scenario
```

---

## 7. Testing

15 unit tests, deterministic, race-clean. The processing duration and a `Clock` are **injected**
(`NewOrderController(clock, procDur)`): production uses 10s, tests use ~20ms — so tests assert
*behavior* (ordering, requeue, completion), not wall-clock time.

```bash
go test ./... -race        # or: bash scripts/test.sh
```

| Suite | Covers |
|-------|--------|
| `usecase` (9) | unique IDs · VIP priority · process/complete/idle · concurrent bots (no loss) · remove-while-processing requeue · reset |
| `http` (6)    | create order · invalid type → 400 · remove none → 409 · state arrays not null · healthz · CORS preflight |

**CI:** `.github/workflows/backend-verify-result.yaml` runs `test.sh → build.sh → run.sh` and
asserts `scripts/result.txt` is non-empty and contains `HH:MM:SS` timestamps.

---

## 8. Deployment

Multi-stage Docker build → distroless image (~2.9 MB). Because state is **in-memory**, the
service runs **exactly one always-on machine** (`min_machines_running=1`,
`auto_stop_machines="off"` in `fly.toml`) — multiple replicas would split the queue.
`PORT` comes from env; health check is `/healthz`. Horizontal scaling would mean externalizing
state (e.g. Redis) behind the same usecase interface, with no change to the domain.

```bash
go run ./cmd/server        # local, :8080
flyctl deploy              # Fly.io (Dockerfile + fly.toml)
```

---

## 9. Requirements map

| # | Requirement | Where |
|---|-------------|-------|
| 1 | New Normal Order → PENDING | `POST /api/orders`, appended to `pending` |
| 2 | New VIP → ahead of Normal, behind earlier VIP | `insertPendingLocked` invariant |
| 3 | Order numbers unique + increasing | single `orderSeq++` counter |
| 4 | + Bot processes pending, 10s each, then next | `runBot` goroutine + `select` |
| 5 | No pending → bot IDLE | `cond.Wait()` (no busy-loop) |
| 6 | − Bot removes newest; busy bot's order returns to its spot | `RemoveBot` → `ctx.Done()` → requeue |
| 7 | In-memory only | plain slices / maps, no DB |
