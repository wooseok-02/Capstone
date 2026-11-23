from datetime import datetime

from pydantic import BaseModel, Field


class UserProfile(BaseModel):
    id: int = Field(description="Knowledge Pet에서 사용하는 회원 번호입니다.")
    provider: str = Field(description="가입에 사용한 소셜 로그인 제공자입니다.")
    nickname: str | None = Field(description="회원의 닉네임입니다. 이름 정보가 없으면 `null`입니다.")
    created_at: datetime = Field(description="회원으로 처음 가입한 시각입니다.")
