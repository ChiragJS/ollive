from __future__ import annotations

from typing import Any

import psycopg
from psycopg.rows import dict_row


class Database:
    def __init__(self, database_url: str):
        self.database_url = database_url

    def fetch_all(self, query: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        with psycopg.connect(self.database_url, row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute(query, params)
                return list(cur.fetchall())

    def fetch_one(self, query: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
        with psycopg.connect(self.database_url, row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute(query, params)
                return cur.fetchone()

    def execute(self, query: str, params: tuple[Any, ...] = ()) -> None:
        with psycopg.connect(self.database_url, row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute(query, params)
            conn.commit()
