import hashlib
import re
import secrets
from dataclasses import dataclass


@dataclass(frozen=True)
class LoginSession:
    id: int
    user_id: int
    refresh_token: str


def hash_refresh_token(token: str) -> str | None:
    if not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
        return None
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def create_session(db, user_id: int) -> LoginSession:
    token = secrets.token_urlsafe(32)
    session = db.execute("""
        INSERT INTO refresh_token (user_id, token_hash, expires_at)
        VALUES (%s, %s, CURRENT_TIMESTAMP + INTERVAL '336 hours')
        RETURNING id
        """, (user_id, hash_refresh_token(token))).fetchone()
    return LoginSession(session["id"], user_id, token)


def rotate_refresh_token(db, old_hash: str) -> LoginSession | None:
    new_token = secrets.token_urlsafe(32)
    session = db.execute("""
        UPDATE refresh_token SET token_hash = %s
        WHERE token_hash = %s AND revoked_at IS NULL AND expires_at > clock_timestamp()
        RETURNING id, user_id
        """, (hash_refresh_token(new_token), old_hash)).fetchone()
    if session is None:
        revoke_used_refresh_token(db, old_hash)
        return None

    db.execute("""
        INSERT INTO used_refresh_tokens (token_hash, session_id) VALUES (%s, %s)
        """, (old_hash, session["id"]))
    return LoginSession(session["id"], session["user_id"], new_token)


def logout_session(db, token_hash: str) -> None:
    result = db.execute("""
        UPDATE refresh_token SET revoked_at = clock_timestamp()
        WHERE token_hash = %s AND revoked_at IS NULL AND expires_at > clock_timestamp()
        """, (token_hash,))
    if result.rowcount == 0:
        # A refresh may have won the race and moved this hash to the history table.
        revoke_used_refresh_token(db, token_hash)


def revoke_used_refresh_token(db, token_hash: str) -> None:
    # A separate statement sees history committed by a concurrent rotation.
    db.execute("""
        UPDATE refresh_token AS session SET revoked_at = clock_timestamp()
        FROM used_refresh_tokens AS used
        WHERE used.token_hash = %s AND used.session_id = session.id
          AND session.revoked_at IS NULL AND session.expires_at > clock_timestamp()
        """, (token_hash,))
