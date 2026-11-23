from uuid import UUID

from fastapi import APIRouter, Depends, Response

from ..core.auth import CurrentUserId
from ..core.security import NO_STORE, SettingsDependency
from ..database import connect
from ..schemas.folder import (
    ExclusionsResponse,
    ExclusionsSavedResponse,
    ExclusionsUpdateRequest,
    FolderCreateRequest,
    FolderDetailResponse,
    FolderListResponse,
    FolderResponse,
    RescanRequest,
    RescanResponse,
)
from ..services import folder_service


def set_no_store(response: Response) -> None:
    response.headers.update(NO_STORE)


router = APIRouter(prefix="/api/v1/folders", tags=["폴더"], dependencies=[Depends(set_no_store)])


@router.post(
    "", status_code=201, response_model=FolderResponse,
    summary="폴더 등록",
    description="내 기기의 폴더를 등록하고 `folder_id`를 발급합니다. 같은 기기에 같은 경로가 있으면 `409`를 반환합니다.",
    response_description="등록된 폴더 정보입니다.",
)
def create_folder(body: FolderCreateRequest, user_id: CurrentUserId, settings: SettingsDependency):
    with connect(settings) as db:
        return folder_service.register_folder(db, user_id, body)


@router.get(
    "", response_model=FolderListResponse,
    summary="내 폴더 목록 조회",
    description="연결 해제되지 않은 내 폴더를 최근 등록 순으로 반환합니다.",
    response_description="폴더 목록입니다.",
)
def list_folders(user_id: CurrentUserId, settings: SettingsDependency):
    with connect(settings) as db:
        return {"folders": folder_service.list_folders(db, user_id)}


@router.get(
    "/{folder_id}", response_model=FolderDetailResponse,
    summary="폴더 상세 조회",
    description="폴더 정보와 기기별 위치, 제외 경로를 반환합니다.",
    response_description="폴더 상세 정보입니다.",
)
def get_folder(folder_id: UUID, user_id: CurrentUserId, settings: SettingsDependency):
    with connect(settings) as db:
        return folder_service.get_folder_detail(db, user_id, folder_id)


@router.put(
    "/{folder_id}/exclusions", response_model=ExclusionsSavedResponse,
    summary="제외 폴더 저장",
    description="제외 경로 목록 전체를 교체합니다. 중복 경로는 하나로 저장합니다.",
    response_description="저장된 제외 경로입니다.",
)
def put_exclusions(folder_id: UUID, body: ExclusionsUpdateRequest, user_id: CurrentUserId, settings: SettingsDependency):
    with connect(settings) as db:
        paths = folder_service.replace_exclusions(db, user_id, folder_id, body.excluded_paths)
    return {"folder_id": folder_id, "excluded_paths": paths, "status": "saved"}


@router.get(
    "/{folder_id}/exclusions", response_model=ExclusionsResponse,
    summary="제외 폴더 조회",
    description="저장된 제외 경로를 반환합니다.",
    response_description="제외 경로 목록입니다.",
)
def get_exclusions(folder_id: UUID, user_id: CurrentUserId, settings: SettingsDependency):
    with connect(settings) as db:
        folder_service.get_owned_folder(db, user_id, folder_id)
        return {"folder_id": folder_id, "excluded_paths": folder_service.read_exclusions(db, folder_id)}


@router.post(
    "/{folder_id}/rescan", status_code=202, response_model=RescanResponse,
    summary="폴더 재탐색 요청",
    description="재탐색 식별자를 발급합니다. 실제 디스크 탐색은 Electron이 수행합니다.",
    response_description="재탐색 요청 정보입니다.",
)
def rescan_folder(folder_id: UUID, body: RescanRequest, user_id: CurrentUserId, settings: SettingsDependency):
    with connect(settings) as db:
        return folder_service.request_rescan(db, user_id, folder_id, body.device_id)


@router.delete(
    "/{folder_id}", status_code=204, response_class=Response,
    summary="폴더 연결 해제",
    description="모든 기기와 폴더의 연결을 해제합니다. 기기별 로컬 경로는 삭제하고 폴더 기록과 제외 규칙은 보존합니다.",
    response_description="연결을 해제했으며 응답 본문은 비어 있습니다.",
)
def delete_folder(folder_id: UUID, user_id: CurrentUserId, settings: SettingsDependency):
    with connect(settings) as db:
        folder_service.disconnect_folder(db, user_id, folder_id)
    return Response(status_code=204, headers=NO_STORE)
