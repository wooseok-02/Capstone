from fastapi import APIRouter, Response

from ..core.auth import CurrentUserId
from ..core.security import NO_STORE, SettingsDependency
from ..database import connect
from ..schemas.device import DeviceCreateRequest, DeviceResponse
from ..services.device_service import create_device


router = APIRouter(prefix="/api/v1/devices", tags=["기기"])


@router.post(
    "", status_code=201, response_model=DeviceResponse,
    summary="기기 등록",
    description="앱 첫 실행 시 호출합니다. 기기 ID를 발급해 로그인한 계정과 연결합니다. 응답의 `device_id`는 Electron이 보관합니다.",
    response_description="발급된 기기 정보입니다.",
)
def register_device(body: DeviceCreateRequest, response: Response, user_id: CurrentUserId, settings: SettingsDependency):
    with connect(settings) as db:
        device = create_device(db, user_id, body.device_name)
    response.headers.update(NO_STORE)
    return device
