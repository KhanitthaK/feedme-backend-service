# feedme-backend-service

Backend for the **McDonald's cooking-bot order controller** (FeedMe SDE take-home).

Go 1.23, **clean architecture**, in-memory (no persistence). One shared domain core drives **two delivery adapters**:

- **HTTP REST API** — consumed by [`feedme-frontend-service`](https://github.com/KhanitthaK/feedme-frontend-service)
- **CLI** — interactive REPL + a non-interactive `--scenario` mode used by CI to produce `scripts/result.txt`

## Requirements covered
| # | Requirement | Where |
|---|-------------|-------|
| 1 | New Normal Order -> PENDING | `POST /api/orders {"type":"NORMAL"}` |
| 2 | New VIP Order -> in front of Normal, behind existing VIP | `insertPendingLocked` in `usecase/controller.go` |
| 3 | Order number unique + increasing | single `orderSeq` counter |
| 4 | + Bot processes pending, 10s each, then next | `runBot` goroutine |
| 5 | No pending -> bot IDLE | `sync.Cond` wait |
| 6 | - Bot removes newest; if processing, order returns to its priority spot | `RemoveBot` + requeue |
| 7 | In-memory only | no DB |

## Architecture
```
cmd/server   -> wires the HTTP REST server (reads PORT, default 8080)
cmd/cli      -> --scenario (batch -> result.txt) | interactive REPL
internal/
  domain/    -> Order, Bot entities + enums (pure, no imports)
  usecase/   -> OrderController: business rules + state + concurrency; Clock port
  adapter/
    http/    -> handlers, DTOs, router, CORS middleware
    cli/     -> REPL + deterministic scenario
```
Dependency rule: `domain <- usecase <- adapter <- cmd`. The domain knows nothing about HTTP or the CLI.

**Concurrency:** all state is guarded by a `sync.Mutex`; idle bots block on a `sync.Cond` (no busy-loop); each bot is a goroutine with a `context.CancelFunc`. Processing is `select { case <-clock.After(10s): complete; case <-ctx.Done(): requeue }`. Passes `go test ./... -race`.

**Testability:** the processing duration is injectable (`NewOrderController(clock, procDur)`, default 10s) so unit tests run in milliseconds and stay deterministic - no real 10-second sleeps.

## REST API
Base URL from env; all data routes under `/api`. JSON, enums UPPERCASE, timestamps RFC3339.

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/api/orders` | `{"type":"NORMAL"\|"VIP"}` | `201 {"order":{...}}` (invalid -> 400) |
| POST | `/api/bots` | - | `201 {"bot":{...}}` |
| DELETE | `/api/bots` | - | `200 {"removedBotId":n}` (none -> 409) |
| GET | `/api/state` | - | `200 {"pending":[],"processing":[],"complete":[],"bots":[]}` |
| POST | `/api/reset` | - | `200 {"ok":true}` |
| GET | `/healthz` | - | `200 ok` |

`Order = {id,type,status,createdAt,completedAt}` - `Bot = {id,status,currentOrderId,remainingSeconds}`

## Run locally
```bash
# REST server (for the frontend)
go run ./cmd/server            # http://localhost:8080  (PORT to override)

# Interactive CLI
go run ./cmd/cli               # commands: normal | vip | +bot | -bot | status | help | quit

# Scenario (what CI runs) -> prints timestamped log to result.txt
bash scripts/build.sh && bash scripts/run.sh && cat scripts/result.txt
```

## Test
```bash
go test ./... -race            # or: bash scripts/test.sh
```

## CI / assignment
`.github/workflows/backend-verify-result.yaml` runs `scripts/test.sh -> build.sh -> run.sh` and asserts `scripts/result.txt` is non-empty and contains `HH:MM:SS` timestamps. `run.sh` regenerates `result.txt` on every run (it is gitignored).

## Deploy
`Dockerfile` (multi-stage, distroless, `EXPOSE 8080`, respects `PORT`) + `render.yaml` (health check `/healthz`) -> deploy to Render/Fly.io. Set the frontend's `VITE_API_BASE_URL` to the resulting URL.

## Documentation
See **[DOCS.md](./DOCS.md)** for the full technical documentation — architecture, domain model, concurrency model, REST API reference, testing, and deployment.
