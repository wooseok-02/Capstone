import base64
import hashlib
import re
import secrets


def s256_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def issue_desktop_code(db, challenge: str, provider: str, provider_user_id: str, nickname: str | None) -> str:
    code = secrets.token_urlsafe(32)
    db.execute("DELETE FROM desktop_login_codes WHERE expires_at <= clock_timestamp()")
    db.execute("""
        INSERT INTO desktop_login_codes (code_hash, code_challenge, provider, provider_user_id, nickname, expires_at)
        VALUES (%s, %s, %s, %s, %s, clock_timestamp() + INTERVAL '2 minutes')
        """, (hashlib.sha256(code.encode("ascii")).hexdigest(), challenge, provider, provider_user_id, nickname))
    return code


def consume_desktop_code(db, code: str, verifier: str):
    if not re.fullmatch(r"[A-Za-z0-9_-]{43}", code) or not re.fullmatch(r"[A-Za-z0-9._~-]{43,128}", verifier):
        return None
    return db.execute("""
        DELETE FROM desktop_login_codes
        WHERE code_hash = %s AND code_challenge = %s AND expires_at > clock_timestamp()
        RETURNING provider, provider_user_id, nickname
        """, (hashlib.sha256(code.encode("ascii")).hexdigest(), s256_challenge(verifier))).fetchone()
