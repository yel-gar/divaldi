#!/usr/bin/env python
"""
Apply the object-storage expiration rules.

Runs as a one-shot Compose service (`garage-lifecycle`) after
`garage-bootstrap` has created the buckets, because the lifecycle API needs a
real S3 client: it takes XML on the wire, and unlike bucket creation there is no
Garage CLI command for it. Running on the backend image reuses the aioboto3
dependency that is already there instead of adding a Python package to the
bootstrap image.

Idempotent: PutBucketLifecycleConfiguration replaces the whole configuration,
so re-running converges rather than accumulating rules.

Usage (as the service does):
    poetry run python apply_s3_lifecycle.py

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


async def apply() -> int:
    endpoint = os.getenv("S3_INTERNAL_URL", "http://garage:3900")
    region = os.getenv("S3_REGION", "garage")
    session = aioboto3.Session(
        aws_access_key_id=os.environ["S3_ACCESS_KEY"],
        aws_secret_access_key=os.environ["S3_SECRET_KEY"],
        region_name=region,
    )

    failures = 0
    async with session.client("s3", endpoint_url=endpoint, region_name=region) as s3:
        for bucket in BUCKETS:
            path = RULES_DIR / f"{bucket}.json"
            if not path.is_file():
                print(f"[garage-lifecycle] ERROR: no rule file at {path}", file=sys.stderr)
                failures += 1
                continue

            configuration = json.loads(path.read_text(encoding="utf-8"))
            await s3.put_bucket_lifecycle_configuration(Bucket=bucket, LifecycleConfiguration=configuration)

            # Read back rather than trusting the write, so a store that accepts
            # the call but drops a rule is caught here instead of in production.
            applied = await s3.get_bucket_lifecycle_configuration(Bucket=bucket)
            ids = sorted(rule.get("ID", "?") for rule in applied.get("Rules", []))
            expected = sorted(rule["ID"] for rule in configuration["Rules"])
            if ids != expected:
                print(
                    f"[garage-lifecycle] ERROR: {bucket} expected {expected}, store reports {ids}",
                    file=sys.stderr,
                )
                failures += 1
                continue
            print(f"[garage-lifecycle] {bucket}: {', '.join(ids)}")

    return failures


if __name__ == "__main__":
    sys.exit(1 if asyncio.run(apply()) else 0)
