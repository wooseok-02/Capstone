from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Response

from ..core.auth import CurrentUserId
from ..core.security import NO_STORE, SettingsDependency
from ..database import connect
from ..schemas.document import (
    DocumentCreateRequest,
    DocumentCreateResponse,
    DocumentDetailResponse,
    DownloadUrlResponse,
    LocationResponse,
    LocationUpdateRequest,
    LocationUpdateResponse,
    SearchRequest,
    SearchResponse,
    UploadCompleteRequest,
    UploadCompleteResponse,
    VersionRequest,
)
from ..services import document_service


def set_no_store(response: Response) -> None:
    response.headers.update(NO_STORE)


router = APIRouter(prefix="/api/v1/documents", tags=["문서"], dependencies=[Depends(set_no_store)])
search_router = APIRouter(prefix="/api/v1/search", tags=["검색"], dependencies=[Depends(set_no_store)])


@router.post(
    "", status_code=201, response_model=DocumentCreateResponse,
    summary="문서 등록·업로드 URL 발급",
    description=(
        "파일 하나를 문서로 등록하고 R2 업로드용 Presigned PUT URL을 발급합니다. "
        "최신 버전과 해시·크기가 같으면 새 버전을 만들지 않고 기존 버전을 돌려줍니다."
    ),
    response_description="문서·버전 정보와 업로드 URL입니다.",
)
def create_document(body: DocumentCreateRequest, user_id: CurrentUserId, settings: SettingsDependency):
    with connect(settings) as db:
        return document_service.register_document(db, settings, user_id, body)


@router.get(
    "/{document_id}", response_model=DocumentDetailResponse,
    summary="문서 상세 조회",
    description="문서 정보와 버전별 상태를 반환합니다. 업로드 후 분석 진행 상태를 확인할 때 씁니다.",
    response_description="문서 상세 정보입니다.",
)
def get_document(document_id: UUID, user_id: CurrentUserId, settings: SettingsDependency):
    with connect(settings) as db:
        return document_service.get_document_detail(db, user_id, document_id)


@router.post(
    "/{document_id}/upload-complete", response_model=UploadCompleteResponse,
    summary="업로드 완료 통지",
    description=(
        "R2에 객체가 있고 크기가 맞는지 확인한 뒤 분석을 시작합니다. 같은 통지를 여러 번 보내도 안전합니다. "
        "분석에 실패한 버전은 다시 보내면 재처리합니다."
    ),
    response_description="검증 후 버전 상태입니다.",
)
def upload_complete(document_id: UUID, body: UploadCompleteRequest, background: BackgroundTasks,
                    user_id: CurrentUserId, settings: SettingsDependency):
    with connect(settings) as db:
        result, start = document_service.complete_upload(db, settings, user_id, document_id, body.version)
    # 커밋 후 응답을 보내고 나서 AI 처리를 시작한다.
    if start is not None:
        background.add_task(document_service.process_version, settings, start)
    return result


@router.post(
    "/{document_id}/download-url", response_model=DownloadUrlResponse,
    summary="다운로드 URL 발급",
    description="원본을 받을 Presigned GET URL을 발급합니다. 버전을 생략하면 업로드가 확인된 최신 버전입니다.",
    response_description="다운로드 URL입니다.",
)
def download_url(document_id: UUID, body: VersionRequest, user_id: CurrentUserId, settings: SettingsDependency):
    with connect(settings) as db:
        return document_service.create_download_url(db, settings, user_id, document_id, body.version)


@router.get(
    "/{document_id}/locations/{device_id}", response_model=LocationResponse,
    summary="기기별 문서 경로 조회",
    description="서버가 마지막으로 기록한 그 기기의 파일 경로입니다. 실제로 파일이 있는지는 앱이 확인합니다.",
    response_description="기기별 문서 경로입니다.",
)
def get_location(document_id: UUID, device_id: UUID, user_id: CurrentUserId, settings: SettingsDependency):
    with connect(settings) as db:
        return document_service.get_location(db, user_id, document_id, device_id)


@router.put(
    "/{document_id}/locations/{device_id}", response_model=LocationUpdateResponse,
    summary="기기별 문서 경로 갱신",
    description="다운로드하거나 파일을 확인한 뒤 그 기기의 파일 경로를 저장합니다.",
    response_description="저장 결과입니다.",
)
def put_location(document_id: UUID, device_id: UUID, body: LocationUpdateRequest,
                 user_id: CurrentUserId, settings: SettingsDependency):
    with connect(settings) as db:
        document_service.update_location(db, user_id, document_id, device_id, body)
    return {"document_id": document_id, "device_id": device_id, "status": "updated"}


@search_router.post(
    "", response_model=SearchResponse,
    summary="문서 검색",
    description="검색어와 의미가 가까운 청크를 찾습니다. 내 폴더의 분석 완료된 최신 버전만 검색하고 제외 경로는 뺍니다.",
    response_description="유사도 순 검색 결과입니다.",
)
def search(body: SearchRequest, user_id: CurrentUserId, settings: SettingsDependency):
    return {"results": document_service.search(settings, user_id, body.query, body.top_k)}
