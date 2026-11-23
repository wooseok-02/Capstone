import psycopg
from psycopg.rows import dict_row

from .config import Settings


def connect(settings: Settings):
    return psycopg.connect(settings.database_url, row_factory=dict_row, connect_timeout=5)
