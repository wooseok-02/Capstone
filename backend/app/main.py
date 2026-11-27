from fastapi import FastAPI

from .routers import auth, devices, documents, folders, notifications, users


app = FastAPI(
    title="Knowledge Pet 백엔드 API",
    description="소셜 로그인과 세션, 내 정보, 기기·폴더 등록, 문서 업로드·검색·다운로드와 알림에 사용하는 API입니다.",
)
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(devices.router)
app.include_router(folders.router)
app.include_router(documents.router)
app.include_router(documents.search_router)
app.include_router(notifications.router)
