#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
if [[ -f go.mod ]]; then
  export GOCACHE="${GOCACHE:-${TMPDIR:-/tmp}/feedme-go-build-cache}"
  export GOMODCACHE="${GOMODCACHE:-${TMPDIR:-/tmp}/feedme-go-mod-cache}"
  mkdir -p bin
  go build -o bin/order-cli ./cmd/cli
  go build -o bin/order-server ./cmd/server
fi
