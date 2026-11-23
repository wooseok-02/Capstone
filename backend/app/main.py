from fastapi import FastAPI

from .routers import auth, users


app = FastAPI(
    title="Knowledge Pet 백엔드 API",
    description="소셜 회원가입, 로그인, 토큰 갱신, 로그아웃과 내 정보 조회에 사용하는 API입니다.",
)
app.include_router(auth.router)
app.include_router(users.router)
