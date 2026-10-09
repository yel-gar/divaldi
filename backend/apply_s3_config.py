#!/usr/bin/env python
"""
Apply the object-storage bucket configuration: expiration rules and CORS rules.

Runs as a one-shot Compose service (`garage-config`) after `garage-bootstrap` has
created the buckets, because both of these need a real S3 client. Garage's CLI
covers key import, bucket creation and key grants, but has no command for the
lifecycle or the CORS API, and both take XML on the wire. Running on the backend
image reuses the aioboto3 dependency that is already there instead of adding a
Python package to the bootstrap image.

Why CORS is configured at all: the browser talks to the object store directly,
through presigned URLs, so every upload and download is cross-origin and is
preceded by a preflight. Garage applies no default CORS policy and answers an
unmatched preflight with `403 This CORS request is not allowed.`, so a bucket
with no CORS configuration is unusable from a browser. MinIO shipped a
permissive default, which is why this was invisible before the migration.

Idempotent: PutBucketLifecycleConfiguration and PutBucketCors both replace the
whole configuration, so re-running converges rather than accumulating rules.

Usage (as the service does):
    poetry run python apply_s3_config.py

Reads rules from ``/rules/<bucket>.json``; override with S3_RULES_DIR.
"""

import asyncio
import json
import os
import sys
from pathlib import Path

import aioboto3

RULES_DIR = Path(os.getenv("S3_RULES_DIR", "/rules"))
BUCKETS = ("avatars", "uploads")

# Every method the presigned URLs the backend hands out can produce: POST for the
# presigned form uploads, GET for the presigned downloads, HEAD and PUT for
# completeness. Garage matches the requested method case-sensitively.
ALLOWED_METHODS = ("POST", "GET", "HEAD", "PUT")

# `*` rather than an enumeration, because the fields of a presigned POST form are
# not known here and browsers add their own (content-type, content-length). A
# wildcard origin cannot be combined with credentials, and presigned URLs carry
# their authorisation in the query string instead, so it is safe here.
ALLOWED_HEADERS = ("*",)
EXPOSED_HEADERS = ("ETag", "Content-Length", "Content-Type")


def get_origins() -> list[str]:
    """Browser origins allowed to call the buckets directly.

    Comma-separated in ``S3_CORS_ORIGINS``. Defaults to ``*``, which is what
    MinIO used to allow unconditionally: the buckets are private and reachable
    only through presigned URLs, so the origin is not the authorisation boundary.
    Set this to the deployed frontend origin in production.
    """
    raw = os.getenv("S3_CORS_ORIGINS", "*")
    origins = [origin.strip() for origin in raw.split(",") if origin.strip()]
    return origins or ["*"]


def cors_configuration(origins: list[str]) -> dict:
    return {
        "CORSRules": [
            {
                "ID": "browser-access",
                "AllowedOrigins": origins,
                "AllowedMethods": list(ALLOWED_METHODS),
                "AllowedHeaders": list(ALLOWED_HEADERS),
                "ExposeHeaders": list(EXPOSED_HEADERS),
                # Preflights are cheap and identical for every object, so let the
                # browser cache the decision instead of re-asking per upload.
                "MaxAgeSeconds": 3000,
            }
        ]
    }


async def apply(session: aioboto3.Session, endpoint: str, region: str) -> int:
    failures = 0
    async with session.client("s3", endpoint_url=endpoint, region_name=region) as s3:
        for bucket in BUCKETS:
            failures += await apply_lifecycle(s3, bucket)
            failures += await apply_cors(s3, bucket)
    return failures


async def apply_lifecycle(s3, bucket: str) -> int:
    path = RULES_DIR / f"{bucket}.json"
    if not path.is_file():
        print(f"[garage-config] ERROR: no rule file at {path}", file=sys.stderr)
        return 1

    configuration = json.loads(path.read_text(encoding="utf-8"))
    await s3.put_bucket_lifecycle_configuration(Bucket=bucket, LifecycleConfiguration=configuration)

    # Read back rather than trusting the write, so a store that accepts the call
    # but drops a rule is caught here instead of in production.
    applied = await s3.get_bucket_lifecycle_configuration(Bucket=bucket)
    ids = sorted(rule.get("ID", "?") for rule in applied.get("Rules", []))
    expected = sorted(rule["ID"] for rule in configuration["Rules"])
    if ids != expected:
        print(
            f"[garage-config] ERROR: {bucket} expected {expected}, store reports {ids}",
            file=sys.stderr,
        )
        return 1
    print(f"[garage-config] {bucket}: {', '.join(ids)}")
    return 0


async def apply_cors(s3, bucket: str) -> int:
    configuration = cors_configuration(get_origins())
    await s3.put_bucket_cors(Bucket=bucket, CORSConfiguration=configuration)

    applied = await s3.get_bucket_cors(Bucket=bucket)
    rules = applied.get("CORSRules", [])
    origins = sorted(rules[0].get("AllowedOrigins", [])) if rules else []
    methods = sorted(rules[0].get("AllowedMethods", [])) if rules else []
    expected_origins = sorted(configuration["CORSRules"][0]["AllowedOrigins"])
    expected_methods = sorted(configuration["CORSRules"][0]["AllowedMethods"])
    if origins != expected_origins or methods != expected_methods:
        print(
            f"[garage-config] ERROR: {bucket} CORS expected origins {expected_origins}"
            f" and methods {expected_methods}, store reports {origins} and {methods}",
            file=sys.stderr,
        )
        return 1
    print(f"[garage-config] {bucket}: CORS {', '.join(origins)} [{', '.join(methods)}]")
    return 0


if __name__ == "__main__":
    endpoint = os.getenv("S3_INTERNAL_URL", "http://garage:3900")
    region = os.getenv("S3_REGION", "garage")
    session = aioboto3.Session(
        aws_access_key_id=os.environ["S3_ACCESS_KEY"],
        aws_secret_access_key=os.environ["S3_SECRET_KEY"],
        region_name=region,
    )
    sys.exit(1 if asyncio.run(apply(session, endpoint, region)) else 0)
