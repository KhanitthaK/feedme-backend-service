# FeedMe order controller

A dependency-free Node.js CLI for the cooking bot assignment. Orders and bots live in memory. Node.js 22 is used by the repository's GitHub Actions workflow.

## Run

```sh
./scripts/test.sh
./scripts/build.sh
./scripts/run.sh
```

`run.sh` runs a noninteractive demonstration using real ten-second timers and writes its timestamped output to `scripts/result.txt`. The demonstration takes about 20 seconds. The Node build step checks JavaScript syntax; no Node compilation or package installation is needed. If the repository also contains the earlier Go implementation, the scripts test and build it too.

For an interactive session:

```sh
node src/cli.js
```

| Command | Action |
| --- | --- |
| `normal` | Submit a normal order |
| `vip` | Submit a VIP order |
| `+` or `add` | Add a bot |
| `-` or `remove` | Remove the newest bot |
| `status` | Show PENDING, PROCESSING, COMPLETE, and bot states |
| `help` | Show commands |
| `quit` or `exit` | Stop the session |

Every output line starts with a UTC `HH:MM:SS` timestamp. To try the interactive flow, enter `normal`, `vip`, `status`, `+`, wait ten seconds, and enter `status` again. Each bot completes at most one order at a time.

## Scheduling rules

Pending VIP orders come first, followed by pending normal orders. Each group retains order-number order, so a stopped order returns to its original place within its group. Orders already being cooked continue when a VIP order arrives. A bot starts the next pending order immediately after completing one, and an idle bot starts a newly submitted order immediately. Removing the newest bot cancels its current timer; its unfinished order returns to PENDING and needs a full ten seconds when another bot takes it.

`test.sh` uses Node's built-in test runner with a controllable clock to verify queue ordering, completion timing, idle and concurrent bots, cancellation, and the CLI commands. No data is persisted; order and bot numbers restart when the process starts.

## GitHub Actions

The existing `backend-verify-result` workflow calls the three scripts above and checks that `scripts/result.txt` is nonempty and contains `HH:MM:SS` timestamps. The scripts resolve the repository directory themselves, so they work from any current directory.
