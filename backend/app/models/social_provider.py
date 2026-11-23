from dataclasses import dataclass
from urllib.parse import urlsplit


@dataclass(frozen=True)
class ProviderConfig:
    name: str
    client_id: str
    client_secret: str
    redirect_uri: str

    @property
    def callback_path(self) -> str:
        return f"/auth/{self.name}/callback"

    @property
    def secure_cookie(self) -> bool:
        return urlsplit(self.redirect_uri).scheme == "https"

    @property
    def uses_pkce(self) -> bool:
        return self.name in {"google", "kakao"}
