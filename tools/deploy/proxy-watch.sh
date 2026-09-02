#!/bin/sh
# Watch for new SmartCura app containers and restart coolify-proxy so Traefik
# re-reads its Docker provider state. Required because Coolify recreates app
# containers on every deploy with new suffixes and new Traefik labels, but
# Traefik's Docker provider sometimes holds onto the old container's state and
# the next request to the new api/livekit/mosquitto host hangs forever.
# Symptom: /api/v1/health timeouts, openssl s_client completes the TLS
# handshake, then the proxy never responds. The api, livekit, and mosquitto
# backends are all healthy; only the proxy's view of the Docker network is
# stale. A `docker restart coolify-proxy` fixes it; sometimes a single
# restart is not enough, so the script verifies after restart and retries.
#
# Trigger: a newly recreated SmartCura container, or a failed public route
# probe. The latter matters because Traefik can retain stale Docker-provider
# state even when the proxy itself started after the app containers.
# After restart, the script probes each HTTP public route from inside the proxy.
# If a probe fails, it restarts again, up to MAX_RESTARTS consecutive attempts.
# The whole loop is throttled to once per COOLDOWN seconds to keep a deploy
# storm from bouncing the proxy repeatedly.
set -eu

LABEL="coolify.projectName=smartcura"
PROXY="coolify-proxy"
LOG="/var/log/smartcura-proxy-watch.log"
THROTTLE_FILE="/tmp/smartcura-proxy-restart.lock"
# Probe every SmartCura public host after each restart; one of them may have
# a stale Traefik route even if the others do not. Order matters only for the
# log line; all of them are checked. The api endpoint is the most reliable
# canary because /api/v1/health is a tight 200 with no side effects.
# host|path pairs; LiveKit and the API have different valid paths.
HEALTHCHECKS="api.smartcura.app|/api/v1/health livekit.smartcura.app|/"
HEALTHCHECK_PORT="443"
HEALTHCHECK_TIMEOUT="5"
APP_FRESH_WINDOW="300"        # only consider app containers started in the last 5 minutes
COOLDOWN="120"                 # at most one "burst" of restarts per 2 minutes
SLEEP_BETWEEN_RESTARTS="15"   # seconds between retry restarts
MAX_RESTARTS="3"               # total restarts in one burst

log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG"
}

if ! command -v docker >/dev/null 2>&1; then
  log "ERROR: docker not in PATH"
  exit 1
fi

if ! docker inspect "$PROXY" >/dev/null 2>&1; then
  log "ERROR: $PROXY container is not running"
  exit 1
fi

# Find the most recently started SmartCura app container.
NEWEST=$(docker ps --filter "label=$LABEL" --format '{{.Names}} {{.CreatedAt}}' \
  | sort -k2,3 -r | head -1 | awk '{print $1}')

if [ -z "$NEWEST" ]; then
  exit 0
fi

NEWEST_STARTED_AT=$(docker inspect --format '{{.State.StartedAt}}' "$NEWEST" 2>/dev/null || echo "")
PROXY_STARTED_AT=$(docker inspect --format '{{.State.StartedAt}}' "$PROXY" 2>/dev/null || echo "")

if [ -z "$NEWEST_STARTED_AT" ] || [ -z "$PROXY_STARTED_AT" ]; then
  log "ERROR: could not read StartedAt for $NEWEST or $PROXY"
  exit 1
fi

APP_EPOCH=$(date -d "$NEWEST_STARTED_AT" +%s 2>/dev/null || echo 0)
PROXY_EPOCH=$(date -d "$PROXY_STARTED_AT" +%s 2>/dev/null || echo 0)
NOW_EPOCH=$(date +%s)

if [ "$APP_EPOCH" = "0" ] || [ "$PROXY_EPOCH" = "0" ]; then
  log "WARN: could not parse dates; newest=$NEWEST_STARTED_AT proxy=$PROXY_STARTED_AT"
  exit 0
fi

APP_AGE=$((NOW_EPOCH - APP_EPOCH))
NEW_DEPLOY="false"
if [ "$APP_AGE" -le "$APP_FRESH_WINDOW" ] && [ "$APP_EPOCH" -gt "$PROXY_EPOCH" ]; then
  NEW_DEPLOY="true"
fi

probe_health() {
  failed=0
  for check in $HEALTHCHECKS; do
    host=${check%%|*}
    path=${check#*|}
    if docker exec "$PROXY" sh -c \
      "wget -q -S -O /dev/null --timeout=$HEALTHCHECK_TIMEOUT \
       https://$host:$HEALTHCHECK_PORT$path 2>&1 \
       | head -1 | grep -q '200 OK'"; then
      log "probe OK: $host$path"
    else
      log "probe FAILED: $host$path"
      failed=1
    fi
  done
  [ "$failed" -eq 0 ]
}

# Do not restart on a probe failure when there is no fresh deploy. A proxy
# restart itself briefly makes public probes fail, and using that failure as a
# trigger creates an endless restart loop. The deployment gate is the durable
# signal; probes are used only to verify a restart caused by that signal.
if [ "$NEW_DEPLOY" = "false" ]; then
  exit 0
fi

# Throttle: a single burst is at most one restart loop per COOLDOWN seconds.
if [ -f "$THROTTLE_FILE" ]; then
  LAST_EPOCH=$(cat "$THROTTLE_FILE" 2>/dev/null || echo 0)
  if [ $((NOW_EPOCH - LAST_EPOCH)) -lt "$COOLDOWN" ]; then
    exit 0
  fi
fi

# Mark the start of the burst immediately so a parallel cron tick does not
# start a second burst while the first is working.
echo "$NOW_EPOCH" > "$THROTTLE_FILE"

attempt=1
while [ "$attempt" -le "$MAX_RESTARTS" ]; do
  log "burst $attempt/$MAX_RESTARTS: newest=$NEWEST age=${APP_AGE}s new_deploy=$NEW_DEPLOY; restarting $PROXY (proxy started at $PROXY_STARTED_AT)"
  if ! docker restart "$PROXY" >/dev/null 2>&1; then
    log "ERROR: docker restart $PROXY failed"
    exit 1
  fi
  # Give Traefik enough time to come back AND to re-read all container
  # labels. Empirically 10s is the floor; 15s is safer.
  sleep "$SLEEP_BETWEEN_RESTARTS"
  if probe_health; then
    log "$attempt restart(s) succeeded: all public HTTP probes passed"
    exit 0
  fi
  log "public route probe(s) still failing after restart $attempt"
  attempt=$((attempt + 1))
done

log "GAVE UP: public route probe(s) still failing after $MAX_RESTARTS restarts; manual intervention required"
exit 1
