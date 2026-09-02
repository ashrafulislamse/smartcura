#!/usr/bin/env bash
#
# Sets up Mosquitto MQTT authentication for the SmartCura backend.
#
# Creates the password file with the bridge service account, then optionally
# adds device credentials. Run this once after starting the mosquitto container
# for the first time, and again whenever a new device is provisioned.
#
# Usage:
#   # 1. Create the password file with the bridge account (run once):
#   SMARTCURA_MQTT_PASSWORD='your-bridge-secret' \
#     ./deploy/mosquitto/setup-mqtt-auth.sh init
#
#   # 2. Add a device credential (run per device at provisioning time):
#   DEVICE_ID='01912345-6789-7abc-8def-0123456789ab' \
#   PROVISIONING_SECRET='the-secret-you-chose-at-registration' \
#     ./deploy/mosquitto/setup-mqtt-auth.sh add-device
#
# After adding or changing credentials, the script sends SIGHUP to mosquitto
# so it reloads the password and ACL files without restarting.
#
# The password file is stored at /mosquitto/config/auth/passwd inside the
# container, mounted from the deploy/mosquitto/auth directory on the host.
set -euo pipefail

# Defensive CRLF strip: this file is sometimes edited on Windows or scp'd
# from a Windows host, and the trailing \r on each line breaks "set -euo
# pipefail" under Ubuntu's dash when SMARTCURA_MQTT_PASSWORD is unset.
sed -i 's/\r$//' "$0" 2>/dev/null || true

CONTAINER="${MOSQUITTO_CONTAINER:-}"

# If MOSQUITTO_CONTAINER was not passed, search for any running container
# whose name starts with "mosquitto-" or matches the known compose project
# names. Coolify-generated container names follow the pattern
# "mosquitto-<app_uuid>-<random>" which the old hard-coded fallbacks did
# not cover.
if [ -z "${CONTAINER}" ] || ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  for pattern in '^mosquitto-' '^smartcura-prod-mosquitto-1$' '^smartcura-mosquitto-1$'; do
    candidate=$(docker ps --format '{{.Names}}' | grep -m1 "${pattern}" || true)
    if [ -n "${candidate}" ]; then
      CONTAINER="${candidate}"
      echo "[mqtt] auto-detected mosquitto container: ${CONTAINER}"
      break
    fi
  done
fi

if [ -z "${CONTAINER}" ] || ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "ERROR: no running mosquitto container found." >&2
  echo "  Pass MOSQUITTO_CONTAINER=<name> or start the mosquitto service first." >&2
  exit 1
fi

AUTH_DIR="/mosquitto/config/auth"
PASSWD_FILE="${AUTH_DIR}/passwd"

reload_mosquitto() {
  echo "[mqtt] reloading mosquitto (SIGHUP)..."
  docker exec "${CONTAINER}" kill -HUP 1
  echo "[mqtt] done."
}

case "${1:-}" in
  init)
    if [ -z "${SMARTCURA_MQTT_PASSWORD:-}" ]; then
      echo "ERROR: set SMARTCURA_MQTT_PASSWORD to the bridge service password."
      exit 1
    fi
    echo "[mqtt] creating password file with bridge account..."
    docker exec "${CONTAINER}" \
      mosquitto_passwd -c -b "${PASSWD_FILE}" smartcura-bridge "${SMARTCURA_MQTT_PASSWORD}"
    reload_mosquitto
    echo "[mqtt] bridge account created. Keep SMARTCURA_MQTT_PASSWORD for the worker env."
    ;;

  add-device)
    if [ -z "${DEVICE_ID:-}" ] || [ -z "${PROVISIONING_SECRET:-}" ]; then
      echo "ERROR: set DEVICE_ID (UUIDv7) and PROVISIONING_SECRET."
      exit 1
    fi
    echo "[mqtt] adding device ${DEVICE_ID} to password file..."
    docker exec "${CONTAINER}" \
      mosquitto_passwd -b "${PASSWD_FILE}" "${DEVICE_ID}" "${PROVISIONING_SECRET}"
    reload_mosquitto
    echo "[mqtt] device added. The ESP32 can now connect with these credentials."
    ;;

  *)
    echo "Usage:"
    echo "  SMARTCURA_MQTT_PASSWORD=... $0 init          — create password file + bridge account"
    echo "  DEVICE_ID=... PROVISIONING_SECRET=... $0 add-device  — add a device credential"
    exit 1
    ;;
esac
