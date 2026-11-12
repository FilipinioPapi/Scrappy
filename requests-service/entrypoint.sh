#!/bin/sh
# Make sure the data folder is writable, then run as a normal user.
# PUID/PGID pick that user (default 1000, the image's "node" user).
set -e
if [ "$(id -u)" = "0" ]; then
  PUID="${PUID:-1000}"; PGID="${PGID:-1000}"
  mkdir -p "$DATA_DIR"
  if [ "$(stat -c %u:%g "$DATA_DIR")" != "$PUID:$PGID" ]; then chown -R "$PUID:$PGID" "$DATA_DIR"; fi
  exec su-exec "$PUID:$PGID" "$@"
fi
exec "$@"
