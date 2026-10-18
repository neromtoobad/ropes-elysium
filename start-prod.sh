#!/usr/bin/env bash
# Railway boot. Two services share this repo and this script:
#
#   ROLE=web       the Next app (pages + API), on Railway's PORT
#   (otherwise)    the EXECUTOR — the game loop and the Hyperliquid relay,
#                  supervised, 24/7
#
# Both answer /health, which railway.json points the platform health check
# at: the web app's says the server is up, the executor's says the loop is
# still ticking (503 once it goes stale), so a wedged loop shows as unhealthy.
#
# ONE EXECUTOR AT A TIME. Stop the laptop's before this one goes live — two
# executors on one wallet race the nonce and poison every measured number.
set -e

if [ "${ROLE:-}" = "web" ]; then
  exec npx next start -p "${PORT:-3000}"
fi

# Make sure the schema is there before the loop asks for it.
#
# This used to say "no schema push — the database is already provisioned",
# which was true right up until the database wasn't. The ledger lived on a
# Supabase free-tier project; the free plan allows two active projects, a third
# project was created on 16 sep, and the game's database was paused to make
# room. Every tick then died on
#
#     FATAL: (ENOTFOUND) tenant/user climb.flprhfxryvpe
#
# and the fix — a fresh Postgres — needed a schema that only a laptop could
# push, which was the one thing nobody had. So the box provisions itself now.
#
# `db push` is idempotent: against a database that already matches it prints
# "already in sync" and changes nothing, so this costs a couple of seconds a
# boot and is a no-op every time but the first. It is deliberately NOT fatal —
# the loop's own connection handling gives a better error than a dead container,
# and a push that fails on a database that is actually fine must never be the
# reason the game does not start.
echo "[boot] ensuring schema is present…"
npx prisma db push --skip-generate || echo "[boot] WARNING: schema push failed — continuing; the loop will report the real error"

exec ./run-executor.sh
