from dataclasses import dataclass


@dataclass(frozen=True)
class LoginSession:
    id: int
    user_id: int
    refresh_token: str
