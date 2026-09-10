#!/bin/bash

set -e

docker compose exec backend poetry run python createsuperuser.py
