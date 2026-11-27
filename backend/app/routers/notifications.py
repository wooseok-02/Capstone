from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from ..core.auth import CurrentUserId
from ..core.security import NO_STORE, SettingsDependency
from ..database import connect
from ..schemas.notification import NotificationDetailResponse, NotificationListResponse, NotificationReadResponse
from ..services import notification_service


def set_no_store(response: Response) -> None:
    response.headers.update(NO_STORE)


router = APIRouter(prefix="/api/v1/notifications", tags=["알림"], dependencies=[Depends(set_no_store)])


@router.get(
    "", response_model=NotificationListResponse,
    summary="내 알림 목록 조회",
    description=(
        "기기를 생략하면 내 계정의 전체 알림, 기기를 지정하면 해당 기기에서 발생한 알림을 조회합니다. "
        "생성 시각 내림차순이며, 시각이 같으면 알림 ID 내림차순으로 정렬합니다. "
        "전체 수와 읽지 않은 수에는 기기 범위만 적용하고, 읽지 않음 필터와 페이지 범위는 적용하지 않습니다. "
        "관련 문서 항목이 없는 알림은 목록과 집계에서 제외합니다."
    ),
)
def list_notifications(
    user_id: CurrentUserId, settings: SettingsDependency,
    limit: int = Query(20, ge=1, le=100, description="한 번에 가져올 알림 수입니다."),
    offset: int = Query(0, ge=0, le=2**63 - 1, description="정렬된 목록의 앞에서 건너뛸 알림 수입니다."),
    unread_only: bool = Query(False, description="true면 읽지 않은 알림만 목록에 표시합니다."),
    device_id: UUID | None = Query(None, description="알림을 발생시킨 내 기기의 ID입니다. 생략하면 전체 기기 내역입니다."),
):
    with connect(settings) as db:
        return notification_service.list_notifications(db, user_id, limit, offset, unread_only, device_id)


@router.get(
    "/{notification_id}", response_model=NotificationDetailResponse,
    summary="내 알림 상세 조회",
    description="기준 문서, 관련 문서와 연결 이유를 조회합니다. 조회해도 읽음 시각은 변경되지 않습니다.",
)
def get_notification(notification_id: UUID, user_id: CurrentUserId, settings: SettingsDependency):
    with connect(settings) as db:
        return notification_service.get_notification(db, user_id, notification_id)


@router.patch(
    "/{notification_id}/read", response_model=NotificationReadResponse,
    summary="내 알림 읽음 처리",
    description="처음 읽음 처리한 시각을 저장합니다. 다시 요청하면 저장한 시각을 반환합니다.",
)
def mark_notification_read(notification_id: UUID, user_id: CurrentUserId, settings: SettingsDependency):
    with connect(settings) as db:
        return notification_service.mark_notification_read(db, user_id, notification_id)
