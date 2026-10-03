#!/bin/sh
#
# Prepare the object store: import the application key, create the two buckets
# and grant the key access to them.
#
# Runs in the `garage-bootstrap` service, which is a thin busybox wrapper around
# the Garage image because that image has no shell of its own.
#
# Every step is idempotent, because this service runs on every `compose up`:
# re-importing an existing key fails with a 409, and creating an existing bucket
# fails with a 409. Both are expected and treated as success, because the key
# and buckets live in the metadata volume and outlive the container.
#
# Note that Garage deliberately refuses to re-import a key id once it has been
# deleted, so S3_SECRET_KEY must not be rotated by changing the secret alone.
# Changing it means creating a new key id and updating the environment.
set -eu

GARAGE_URL="${GARAGE_URL:-http://garage:3903}"
BUCKETS="avatars uploads"

log() { echo "[garage-bootstrap] $*"; }

# Wait for the RPC port the CLI talks to. The CLI resolves rpc_public_addr from
# the config, which in Compose is the service name.
log "waiting for Garage at ${GARAGE_URL}"
attempt=0
until /garage status >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -gt 60 ]; then
        log "Garage did not become ready in time"
        /garage status || true
        exit 1
    fi
    sleep 2
done
log "Garage is up"
/garage status || true

# Import the key. Garage assigns key ids itself, so `key import` is the only way
# to pin the credentials: it lets S3_ACCESS_KEY and S3_SECRET_KEY stay static in
# the environment instead of having to be captured out of a `key create` at
# runtime and handed to the backend through a shared volume.
if /garage key import "$S3_ACCESS_KEY" "$S3_SECRET_KEY" --yes -n divaldi-app >/dev/null 2>&1; then
    log "imported application key $S3_ACCESS_KEY"
else
    # Already present from a previous run. The secret is not re-displayed and
    # cannot be, so this is the only way to confirm it is unchanged.
    if /garage key info --show-secret "$S3_ACCESS_KEY" 2>/dev/null | grep -q "$S3_SECRET_KEY"; then
        log "application key already present"
    else
        log "ERROR: key $S3_ACCESS_KEY exists but does not match S3_SECRET_KEY."
        log "Garage will not let a key id be reused with a different secret."
        log "Generate a new key id, or restore the original secret."
        exit 1
    fi
fi

for bucket in $BUCKETS; do
    if /garage bucket create "$bucket" >/dev/null 2>&1; then
        log "created bucket $bucket"
    else
        log "bucket $bucket already exists"
    fi
    # Garage has no ACL API. Access is granted per key per bucket, and a bucket
    # with no grant is private, which is what MinIO's `mc anonymous set none`
    # achieved.
    /garage bucket allow --read --write --owner "$bucket" --key "$S3_ACCESS_KEY" >/dev/null 2>&1 || true
    log "granted $S3_ACCESS_KEY read/write/owner on $bucket"
done

log "buckets and key ready"
