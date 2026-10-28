#!/bin/sh
set -e

# Docker only seeds a volume's ownership when the volume is new, so a volume
# created by an older image that ran as root stays root:root. Hand anything
# not owned by the app user back to it, then drop root for the real command.
if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/data
  find /app/data \( ! -user nextjs -o ! -group nodejs \) -exec chown nextjs:nodejs {} +
  exec su-exec nextjs:nodejs "$@"
fi

exec "$@"
