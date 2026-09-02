# Custom Mosquitto image for SmartCura.
#
# Why a custom image? Coolify's deploy pipeline materialises bind-mount source
# paths as empty directories and does not copy repository files into them. A
# stock eclipse-mosquitto image with a bind-mounted config directory therefore
# starts with an empty /mosquitto/config, which makes Mosquitto fail with
# "Error: /mosquitto/config/mosquitto.conf is missing".
#
# This Dockerfile bakes the config and ACL into the image and uses an entrypoint
# to generate the password file at runtime from SMARTCURA_MQTT_PASSWORD, so the
# secret is never committed and no bind-mount is required for broker
# configuration.
FROM eclipse-mosquitto:2.0.21

# The base image sets USER mosquitto (UID 1883). Switch to root so the
# entrypoint can create directories, run mosquitto_passwd, and fix ownership
# on named volumes (which Docker creates as root by default).
USER root

COPY mosquitto.conf /mosquitto/config/mosquitto.conf
COPY auth/acl /mosquitto/config/auth/acl
# Mosquitto refuses to load a world-readable password or ACL file in newer
# versions; bake the ACL at 0700 so the volume mount at runtime does not
# surface a permissive default.
RUN chmod 0700 /mosquitto/config/auth/acl

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
