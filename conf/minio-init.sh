#!/bin/sh
set -e

echo "Waiting for MinIO..."

until mc alias set minio http://minio:9000 \
    "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
do
    sleep 1
done

echo "Creating buckets..."

mc mb --ignore-existing minio/avatars

echo "Configuring buckets..."

mc anonymous set none minio/avatars

mc ilm rule import minio/avatars < /minio-rules.json

echo "MinIO initialization complete."
