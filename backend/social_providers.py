from dataclasses import dataclass
from urllib.parse import urlencode, urlsplit

import httpx
import jwt
from fastapi import HTTPException

from .db import Settings
from .desktop_auth import s256_challenge


GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_KEYS = jwt.PyJWKClient("https://www.googleapis.com/oauth2/v3/certs", timeout=5)
NAVER_AUTHORIZE_URL = "https://nid.naver.com/oauth2.0/authorize"
NAVER_TOKEN_URL = "https://nid.naver.com/oauth2.0/token"
NAVER_PROFILE_URL = "https://openapi.naver.com/v1/nid/me"
KAKAO_AUTHORIZE_URL = "https://kauth.kakao.com/oauth/authorize"
KAKAO_TOKEN_URL = "https://kauth.kakao.com/oauth/token"
KAKAO_PROFILE_URL = "https://kapi.kakao.com/v2/user/me"

AUTHORIZATION_URLS = {"google": GOOGLE_AUTHORIZE_URL, "naver": NAVER_AUTHORIZE_URL, "kakao": KAKAO_AUTHORIZE_URL}


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


def get_provider(name: str, settings: Settings) -> ProviderConfig:
    if name == "google":
        provider = ProviderConfig(name, settings.google_client_id, settings.google_client_secret, settings.google_redirect_uri)
    elif name == "naver":
        provider = ProviderConfig(name, settings.naver_client_id, settings.naver_client_secret, settings.naver_redirect_uri)
    elif name == "kakao":
        provider = ProviderConfig(name, settings.kakao_client_id, settings.kakao_client_secret, settings.kakao_redirect_uri)
    else:
        raise HTTPException(404, "지원하지 않는 소셜 로그인 제공자입니다.")

    if not (provider.client_id and provider.client_secret and provider.redirect_uri):
        raise HTTPException(503, "이 제공자의 소셜 로그인 설정이 아직 준비되지 않았습니다.")
    try:
        redirect = urlsplit(provider.redirect_uri)
    except ValueError:
        raise HTTPException(503, "이 제공자의 콜백 주소 설정을 확인하세요.") from None
    if (
        not redirect.hostname
        or redirect.username is not None
        or redirect.path != provider.callback_path
        or redirect.query
        or redirect.fragment
        or not (
            redirect.scheme == "https"
            or (redirect.scheme == "http" and redirect.hostname in {"localhost", "127.0.0.1", "::1"})
        )
    ):
        raise HTTPException(503, "이 제공자의 콜백 주소 설정을 확인하세요.")
    return provider


def authorization_url(provider: ProviderConfig, flow: dict) -> str:
    query = {
        "client_id": provider.client_id,
        "redirect_uri": provider.redirect_uri,
        "response_type": "code",
        "state": flow["state"],
    }
    if provider.name == "google":
        query.update({"scope": "openid profile", "nonce": flow["nonce"]})
    if provider.uses_pkce:
        query.update({
            "code_challenge": s256_challenge(flow["verifier"]),
            "code_challenge_method": "S256",
        })
    return f"{AUTHORIZATION_URLS[provider.name]}?{urlencode(query)}"


def verify_provider_code(provider: ProviderConfig, code: str, flow: dict) -> tuple[str, str | None]:
    if provider.name == "google":
        return verify_google_code(provider, code, flow)
    if provider.name == "kakao":
        return verify_kakao_code(provider, code, flow["verifier"])
    return verify_naver_code(provider, code, flow["state"])


def read_provider_response(response: httpx.Response) -> dict:
    if response.status_code in (400, 401, 403):
        raise HTTPException(401, "소셜 인증을 확인할 수 없습니다.")
    response.raise_for_status()
    try:
        body = response.json()
    except ValueError:
        raise HTTPException(502, "소셜 로그인 서버의 응답을 확인할 수 없습니다.") from None
    if not isinstance(body, dict):
        raise HTTPException(502, "소셜 로그인 서버의 응답을 확인할 수 없습니다.")
    return body


def read_bearer_token(response: httpx.Response, error_message: str) -> str:
    tokens = read_provider_response(response)
    access_token = tokens.get("access_token")
    token_type = tokens.get("token_type", "")
    if (
        "error" in tokens or not isinstance(access_token, str) or not access_token
        or not isinstance(token_type, str) or token_type.lower() != "bearer"
    ):
        raise HTTPException(401, error_message)
    return access_token


def verify_google_code(provider: ProviderConfig, code: str, flow: dict) -> tuple[str, str | None]:
    try:
        token_response = httpx.post(GOOGLE_TOKEN_URL, data={
            "grant_type": "authorization_code",
            "code": code,
            "client_id": provider.client_id,
            "client_secret": provider.client_secret,
            "redirect_uri": provider.redirect_uri,
            "code_verifier": flow["verifier"],
        }, timeout=8)
        id_token = read_provider_response(token_response).get("id_token")
        if not isinstance(id_token, str):
            raise jwt.InvalidTokenError()
        signing_key = GOOGLE_KEYS.get_signing_key_from_jwt(id_token)
        profile = jwt.decode(
            id_token, signing_key.key, algorithms=["RS256"],
            issuer=("https://accounts.google.com", "accounts.google.com"),
            audience=provider.client_id,
            options={"require": ["iss", "aud", "sub", "exp", "iat", "nonce"]},
        )
        if profile["nonce"] != flow["nonce"]:
            raise jwt.InvalidTokenError()
        if ("azp" in profile or isinstance(profile["aud"], list)) and profile.get("azp") != provider.client_id:
            raise jwt.InvalidTokenError()
    except (httpx.HTTPError, jwt.PyJWKClientConnectionError):
        raise HTTPException(502, "소셜 로그인 서버에 연결할 수 없습니다.") from None
    except jwt.PyJWTError:
        raise HTTPException(401, "소셜 인증을 확인할 수 없습니다.") from None

    return social_profile(profile["sub"], profile.get("name"))


def verify_naver_code(provider: ProviderConfig, code: str, state: str) -> tuple[str, str | None]:
    try:
        token_response = httpx.post(NAVER_TOKEN_URL, data={
            "grant_type": "authorization_code",
            "client_id": provider.client_id,
            "client_secret": provider.client_secret,
            "code": code,
            "state": state,
        }, timeout=8)
        access_token = read_bearer_token(token_response, "네이버 인증을 확인할 수 없습니다.")
        profile_response = httpx.get(NAVER_PROFILE_URL, headers={"Authorization": f"Bearer {access_token}"}, timeout=8)
        body = read_provider_response(profile_response)
    except httpx.HTTPError:
        raise HTTPException(502, "네이버 로그인 서버에 연결할 수 없습니다.") from None

    profile = body.get("response")
    if body.get("resultcode") != "00" or not isinstance(profile, dict):
        raise HTTPException(401, "네이버 회원 정보를 확인할 수 없습니다.")
    return social_profile(profile.get("id"), profile.get("nickname"))


def verify_kakao_code(provider: ProviderConfig, code: str, verifier: str) -> tuple[str, str | None]:
    try:
        token_response = httpx.post(KAKAO_TOKEN_URL, data={
            "grant_type": "authorization_code",
            "client_id": provider.client_id,
            "client_secret": provider.client_secret,
            "redirect_uri": provider.redirect_uri,
            "code": code,
            "code_verifier": verifier,
        }, timeout=8)
        access_token = read_bearer_token(token_response, "카카오 인증을 확인할 수 없습니다.")
        profile_response = httpx.get(
            KAKAO_PROFILE_URL, headers={"Authorization": f"Bearer {access_token}"},
            params={"property_keys": '["kakao_account.profile"]'}, timeout=8,
        )
        body = read_provider_response(profile_response)
    except httpx.HTTPError:
        raise HTTPException(502, "카카오 로그인 서버에 연결할 수 없습니다.") from None

    user_id = body.get("id")
    if type(user_id) is not int or user_id <= 0:
        raise HTTPException(401, "카카오 사용자 ID를 확인할 수 없습니다.")
    account = body.get("kakao_account")
    profile = account.get("profile") if isinstance(account, dict) else None
    nickname = profile.get("nickname") if isinstance(profile, dict) else None
    return social_profile(str(user_id), nickname)


def social_profile(user_id: object, name: object) -> tuple[str, str | None]:
    if not isinstance(user_id, str) or not user_id.strip() or len(user_id) > 255 or "\x00" in user_id:
        raise HTTPException(401, "소셜 사용자 ID를 확인할 수 없습니다.")
    nickname = None
    if isinstance(name, str):
        nickname = name.replace("\x00", "").strip()[:50] or None
    return user_id, nickname
