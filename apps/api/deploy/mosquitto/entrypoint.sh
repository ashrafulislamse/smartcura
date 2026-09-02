#!/bin/sh
set -e

# Ensure the runtime auth directory exists. The password file is intentionally
# not baked into the image so SMARTCURA_MQTT_PASSWORD can be supplied at
# runtime.
mkdir -p /mosquitto/config/auth

# The named volume mount at /mosquitto/config/auth may carry a permissive
# default ACL from a previous run; Mosquitto logs a warning if passwd or
# acl are world-readable. Restore the strict mode we baked into the image
# so the warning does not fire on every boot.
chmod 0700 /mosquitto/config/auth/acl 2>/dev/null || true

if [ ! -f /mosquitto/config/auth/passwd ]; then
  if [ -z "${SMARTCURA_MQTT_PASSWORD:-}" ]; then
    echo "ERROR: SMARTCURA_MQTT_PASSWORD is required to create the bridge password file."
    exit 1
  fi
  echo "[mqtt] creating bridge password file..."
  mosquitto_passwd -c -b /mosquitto/config/auth/passwd smartcura-bridge "${SMARTCURA_MQTT_PASSWORD}"
fi

# Ensure persisted data directory exists. Docker named volumes are owned by
# root by default; since we run as root (USER root in the Dockerfile), this
# is not a permission issue, but the directory must exist.
mkdir -p /mosquitto/data

# Run mosquitto as root. The container is isolated; running the broker as
# root inside it is acceptable and avoids BusyBox su/gosu compatibility issues.
exec /usr/sbin/mosquitto -c /mosquitto/config/mosquitto.conf
