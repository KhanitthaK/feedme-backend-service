# feedme-backend-service

McDonald's Order Controller backend prototype (Go + clean architecture, in-memory only).

## Structure

- `cmd/order-controller` - interactive CLI entrypoint
- `internal/domain` - core entities
- `internal/usecase` - order controller/business logic
- `script/build.sh` - build command
- `script/test.sh` - test command
- `script/run.sh` - run CLI flow and write `result.txt`

## Supported CLI commands

- `normal` - create normal order
- `vip` - create VIP order
- `+bot` - add a cooking bot
- `-bot` - remove newest cooking bot
- `status` - show current queue/completion state
- `help`
- `exit`

## Verification

```bash
./script/build.sh
./script/test.sh
./script/run.sh
cat result.txt
```

`result.txt` includes event timestamps in `HH:MM:SS` format.
