#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

{
  echo "vip"
  echo "normal"
  echo "+bot"
  sleep 11
  echo "status"
  echo "exit"
} | go run ./cmd/order-controller > result.txt

echo "CLI output written to result.txt"
