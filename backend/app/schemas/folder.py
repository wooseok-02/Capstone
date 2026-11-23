from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from ..core.paths import clean_display_name, validate_local_path, validate_relative_path


MAX_EXCLUSIONS = 1000


class FolderCreateRequest(BaseModel):
    device_id: UUID = Field(description="폴더가 있는 내 기기의 ID입니다.")
    folder_name: str = Field(description="화면에 보여줄 폴더 이름입니다. 1~255자입니다.", examples=["notes"])
    local_path: str = Field(description="해당 기기에서의 폴더 루트 절대 경로입니다.", examples=["C:\\Users\\me\\Documents\\notes"])

    @field_validator("folder_name")
    @classmethod
    def check_folder_name(cls, value: str) -> str:
        return clean_display_name(value, 255)

    @field_validator("local_path")
    @classmethod
    def check_local_path(cls, value: str) -> str:
        return validate_local_path(value)


class FolderResponse(BaseModel):
    folder_id: UUID = Field(description="서버가 발급한 폴더 ID입니다.")
    folder_name: str = Field(description="폴더 이름입니다.")
    status: str = Field(description="폴더 상태입니다.")
    created_at: datetime = Field(description="폴더를 등록한 시각입니다.")


class FolderLocationResponse(BaseModel):
    device_id: UUID = Field(description="폴더가 연결된 기기 ID입니다.")
    local_path: str = Field(description="해당 기기에서의 폴더 루트 경로입니다.")
    last_seen_at: datetime | None = Field(description="앱이 마지막으로 폴더를 확인한 시각입니다.")


class FolderDetailResponse(FolderResponse):
    locations: list[FolderLocationResponse] = Field(description="기기별 폴더 위치입니다.")
    excluded_paths: list[str] = Field(description="폴더 루트 기준 제외 경로입니다.")


class FolderListResponse(BaseModel):
    folders: list[FolderResponse] = Field(description="내 폴더 목록입니다.")


class ExclusionsUpdateRequest(BaseModel):
    excluded_paths: list[str] = Field(
        max_length=MAX_EXCLUSIONS,
        description="저장할 제외 경로 전체 목록입니다. 빈 배열을 보내면 모두 해제합니다.",
        examples=[["study/개인자료", "node_modules", ".git"]],
    )

    @field_validator("excluded_paths")
    @classmethod
    def check_excluded_paths(cls, values: list[str]) -> list[str]:
        return list(dict.fromkeys(validate_relative_path(value) for value in values))


class ExclusionsResponse(BaseModel):
    folder_id: UUID = Field(description="폴더 ID입니다.")
    excluded_paths: list[str] = Field(description="폴더 루트 기준 제외 경로입니다.")


class ExclusionsSavedResponse(ExclusionsResponse):
    status: str = Field(description="저장 결과입니다. 값은 `saved`입니다.")


class RescanRequest(BaseModel):
    device_id: UUID = Field(description="재탐색을 수행할 내 기기의 ID입니다.")


class RescanResponse(BaseModel):
    folder_id: UUID = Field(description="폴더 ID입니다.")
    scan_id: UUID = Field(description="이번 재탐색 요청의 식별자입니다.")
    status: str = Field(description="요청 상태입니다. 값은 `awaiting_client_scan`입니다.")
