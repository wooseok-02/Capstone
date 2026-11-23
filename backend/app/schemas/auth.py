from pydantic import BaseModel, Field, SecretStr


class RefreshRequest(BaseModel):
    refresh_token: SecretStr = Field(description="로그인 또는 마지막 갱신에서 받은 갱신 토큰입니다.")


class DesktopExchangeRequest(BaseModel):
    code: SecretStr = Field(description="브라우저에서 앱으로 전달된 일회용 코드입니다.")
    code_verifier: SecretStr = Field(description="앱이 로그인 시작 때 생성해 보관했던 원래 검증값입니다.")


class SessionTokenResponse(BaseModel):
    access_token: str = Field(description="내 정보 조회 같은 보호된 API를 호출할 때 사용하는 접근 토큰입니다.")
    refresh_token: str = Field(description="로그인을 유지하거나 현재 세션을 종료할 때 사용하는 갱신 토큰입니다.")
    token_type: str = Field(description="접근 토큰을 전달하는 방식입니다. 값은 `bearer`입니다.")
    expires_in: int = Field(description="접근 토큰의 유효기간입니다. 단위는 초입니다.")
