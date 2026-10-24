"""PostgreSQL access for the v2 website. Every change runs under one advisory lock."""
from __future__ import annotations

import os
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

LOCK_KEY = 820_2026


@contextmanager
def connect(write=False):
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set.")
    with psycopg.connect(url, row_factory=dict_row) as conn:
        with conn.transaction():
            if write:
                conn.execute("SELECT pg_advisory_xact_lock(%s)", (LOCK_KEY,))
            yield conn


def log(conn, actor: str, action: str, event_id=None, **details):
    conn.execute("INSERT INTO eo2_activity (event_id, actor, action, details) VALUES (%s,%s,%s,%s)",
                 (event_id, actor, action, Jsonb(details)))


__all__ = ["connect", "log", "Jsonb"]
