import secrets
from typing import Annotated

import jwt
from fastapi import APIRouter, Cookie, HTTPException, Path, Query
from fastapi.responses import JSONResponse, RedirectResponse, Response

from ..core.security import FLOW_LIFETIME, NO_STORE, OAUTH_AUDIENCE, SettingsDependency, decode_token, encode_token
from ..database import connect
from ..schemas.auth import DesktopExchangeRequest, RefreshRequest, SessionTokenResponse
from ..services.auth_service import desktop_redirect, login_social_user, session_response
from ..services.desktop_auth_service import consume_desktop_code, issue_desktop_code
from ..services.session_service import hash_refresh_token, logout_session, rotate_refresh_token
from ..services.social_provider_service import authorization_url, get_provider, verify_provider_code


router = APIRouter(prefix="/auth", tags=["회원가입 및 로그인"])
SocialProvider = Annotated[str, Path(description="소셜 로그인 제공자입니다. `google`, `naver`, `kakao`를 사용할 수 있습니다.")]


@router.get(
    "/{provider}/start", status_code=302, response_class=RedirectResponse,
    summary="소셜 로그인 시작",
    description="브라우저에서 열면 소셜 로그인 화면으로 이동합니다. Electron은 앱이 열어 둔 포트와 검증값의 해시를 함께 보냅니다.",
    response_description="소셜 로그인 화면으로 이동합니다.",
)
def start(
    provider: SocialProvider, settings: SettingsDependency,
    desktop_port: Annotated[int | None, Query(ge=1, le=65535, description="Electron이 127.0.0.1에서 열어 둔 포트입니다.")] = None,
    desktop_challenge: Annotated[str | None, Query(
        pattern=r"^[A-Za-z0-9_-]{43}$", description="Electron 검증값의 SHA-256 해시를 Base64URL로 인코딩한 값입니다.",
    )] = None,
):
    config = get_provider(provider, settings)
    if (desktop_port is None) != (desktop_challenge is None):
        raise HTTPException(400, "Electron login requires both desktop_port and desktop_challenge", headers=NO_STORE)
    flow = {
        "provider": config.name,
        "state": secrets.token_urlsafe(32),
        "desktop_port": desktop_port, "desktop_challenge": desktop_challenge,
    }
    if config.name == "google":
        flow["nonce"] = secrets.token_urlsafe(32)
    if config.uses_pkce:
        flow["verifier"] = secrets.token_urlsafe(48)
    flow_token = encode_token(settings, OAUTH_AUDIENCE, FLOW_LIFETIME, flow)
    response = RedirectResponse(authorization_url(config, flow), status_code=302, headers=NO_STORE)
    response.set_cookie(
        "oauth_flow", flow_token, path=config.callback_path, max_age=FLOW_LIFETIME,
        httponly=True, secure=config.secure_cookie, samesite="lax",
    )
    return response


@router.get(
    "/{provider}/callback", response_model=SessionTokenResponse,
    summary="소셜 인증 결과 확인",
    description=(
        "소셜 로그인 제공자가 인증을 마친 뒤 호출하는 주소입니다. "
        "브라우저에서 시작한 로그인은 토큰을 반환합니다. Electron에서 시작한 로그인은 앱에 일회용 코드를 전달합니다."
    ),
    response_description="소셜 인증 후 발급한 로그인 토큰입니다.",
    responses={302: {"description": "Electron의 루프백 주소로 일회용 코드 또는 오류를 전달합니다."}},
)
def callback(
    provider: SocialProvider, settings: SettingsDependency,
    code: Annotated[str | None, Query(description="소셜 로그인 제공자가 발급한 인증 코드입니다.")] = None,
    state: Annotated[str | None, Query(description="로그인을 시작한 요청과 인증 결과가 연결되는지 확인하는 값입니다.")] = None,
    error: Annotated[str | None, Query(description="인증이 취소되거나 실패했을 때 제공자가 돌려주는 값입니다.")] = None,
    oauth_flow: str | None = Cookie(default=None, description="로그인 시작 시 서버가 발급하며 브라우저가 자동으로 보냅니다."),
):
    config = get_provider(provider, settings)
    try:
        flow = decode_token(settings, OAUTH_AUDIENCE, oauth_flow or "")
        if flow.get("provider") != config.name or not state or not secrets.compare_digest(state.encode(), flow["state"].encode()):
            raise jwt.InvalidTokenError()
    except (jwt.InvalidTokenError, KeyError):
        raise HTTPException(400, "소셜 로그인 요청이 만료됐거나 인증 결과가 일치하지 않습니다.", headers=NO_STORE) from None

    desktop_port = flow.get("desktop_port")
    try:
        if error or not code:
            raise HTTPException(400, "소셜 로그인이 취소되었거나 실패했습니다.")
        provider_user_id, nickname = verify_provider_code(config, code, flow)
        verified_provider = config.name.upper()
        with connect(settings) as db:
            if desktop_port is None:
                session = login_social_user(db, verified_provider, provider_user_id, nickname)
                response = session_response(settings, session)
            else:
                desktop_code = issue_desktop_code(
                    db, flow["desktop_challenge"], verified_provider, provider_user_id, nickname,
                )
                response = desktop_redirect(desktop_port, code=desktop_code)
    except HTTPException as exc:
        if desktop_port is None:
            response = JSONResponse({"detail": exc.detail}, status_code=exc.status_code, headers=NO_STORE)
        else:
            response = desktop_redirect(desktop_port, error="access_denied" if error == "access_denied" else "login_failed")

    response.delete_cookie("oauth_flow", path=config.callback_path, secure=config.secure_cookie)
    return response


@router.post(
    "/exchange", response_model=SessionTokenResponse,
    summary="Electron 로그인 코드 교환",
    description=(
        "루프백 주소에서 받은 일회용 코드와 앱이 보관한 검증값을 보냅니다. "
        "코드는 발급 후 2분 동안 유효하며 한 번만 사용할 수 있습니다. "
        "서버가 코드에 연결해 둔 소셜 계정으로 로그인하며 첫 로그인이라면 회원을 자동 등록합니다."
    ),
    response_description="Electron에서 사용할 접근 토큰과 갱신 토큰입니다.",
)
def exchange(body: DesktopExchangeRequest, settings: SettingsDependency):
    with connect(settings) as db:
        profile = consume_desktop_code(db, body.code.get_secret_value(), body.code_verifier.get_secret_value())
        if profile is None:
            raise HTTPException(401, "A valid desktop login code and verifier are required", headers=NO_STORE)
        session = login_social_user(db, profile["provider"], profile["provider_user_id"], profile["nickname"])
    return session_response(settings, session)


@router.post(
    "/refresh", response_model=SessionTokenResponse,
    summary="로그인 토큰 갱신",
    description=(
        "현재 갱신 토큰을 보내면 새 접근 토큰과 갱신 토큰을 받을 수 있습니다. "
        "이전에 사용한 갱신 토큰을 다시 보내면 해당 세션이 종료됩니다."
    ),
    response_description="갱신 후 사용할 새 접근 토큰과 갱신 토큰입니다.",
)
def refresh(body: RefreshRequest, settings: SettingsDependency):
    token_hash = hash_refresh_token(body.refresh_token.get_secret_value())
    inactive = HTTPException(401, "A valid refresh token is required", headers=NO_STORE)
    if token_hash is None:
        raise inactive

    with connect(settings) as db:
        session = rotate_refresh_token(db, token_hash)
    if session is None:
        # The transaction must commit any revocation before reporting the failed refresh.
        raise inactive
    return session_response(settings, session)


@router.post(
    "/logout", status_code=204, response_class=Response,
    summary="현재 세션 로그아웃",
    description="갱신 토큰을 보낸 세션만 종료합니다. 같은 계정으로 로그인한 다른 기기에서는 계속 사용할 수 있습니다.",
    response_description="로그아웃 요청을 처리했으며 응답 본문은 비어 있습니다.",
)
def logout(body: RefreshRequest, settings: SettingsDependency):
    token_hash = hash_refresh_token(body.refresh_token.get_secret_value())
    if token_hash is not None:
        with connect(settings) as db:
            logout_session(db, token_hash)
    return Response(status_code=204, headers=NO_STORE)
