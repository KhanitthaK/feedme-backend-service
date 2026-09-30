#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm test
if [[ -f go.mod ]]; then
  export GOCACHE="${GOCACHE:-${TMPDIR:-/tmp}/feedme-go-build-cache}"
  export GOMODCACHE="${GOMODCACHE:-${TMPDIR:-/tmp}/feedme-go-mod-cache}"
  go test ./...
fi
