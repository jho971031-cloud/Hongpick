#!/bin/sh
set -eu
case "${PAPER_DATA_DIR:-/var/data}" in
  /var/data|/var/data/*) ;;
  *) echo 'PAPER_DATA_DIR must be under /var/data' >&2; exit 1 ;;
esac
mkdir -p "$PAPER_DATA_DIR"
chown node:node "$PAPER_DATA_DIR"
exec gosu node "$@"
