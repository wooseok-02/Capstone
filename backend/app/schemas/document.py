import re
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from ..core.paths import clean_display_name, validate_document_path, validate_local_path


SHA256_HEX = re.compile(r"^[0-9a-fA-F]{64}$")


def check_sha256(value: str) -> str:
    if not SHA256_HEX.match(value):
        raise ValueError("sha256은 64자리 16진수여야 합니다.")
    return value.lower()


class DocumentCreateRequest(BaseModel):
    folder_id: UUID = Field(description="문서가 속한 내 폴더 ID입니다.")
    device_id: UUID = Field(description="파일이 있는 내 기기 ID입니다. 폴더가 이 기기에 연결되어 있어야 합니다.")
    relative_path: str = Field(description="폴더 루트 기준 파일 경로입니다. `\\`는 `/`로 바뀝니다.", examples=["study/운영체제/프로세스.md"])
    file_name: str = Field(description="파일 이름입니다. `relative_path`의 마지막 이름과 같아야 합니다.", examples=["프로세스.md"])
    file_size: int = Field(ge=0, description="파일 크기(byte)입니다.", examples=[1024])
    modified_at: datetime | None = Field(default=None, description="파일 수정 시각입니다. 선택 값입니다.")
    sha256: str = Field(description="파일 내용의 SHA-256(64자리 16진수)입니다.")

    @field_validator("relative_path")
    @classmethod
    def check_relative_path(cls, value: str) -> str:
        return validate_document_path(value)

    @field_validator("file_name")
    @classmethod
    def check_file_name(cls, value: str) -> str:
        return clean_display_name(value, 255)

    @field_validator("sha256")
    @classmethod
    def check_hash(cls, value: str) -> str:
        return check_sha256(value)

    @model_validator(mode="after")
    def check_name_matches_path(self):
        if self.relative_path.rsplit("/", 1)[-1] != self.file_name:
            raise ValueError("file_name은 relative_path의 마지막 이름과 같아야 합니다.")
        return self


class DocumentCreateResponse(BaseModel):
    document_id: UUID = Field(description="서버가 발급한 문서 ID입니다.")
    document_version_id: UUID = Field(description="이번 버전의 ID입니다.")
    version: int = Field(description="버전 번호입니다.")
    object_key: str = Field(description="R2 저장 위치입니다.")
    status: str = Field(description="버전 상태입니다.")
    upload_url: str | None = Field(description="원본을 올릴 Presigned PUT URL입니다. 이미 올라간 버전이면 null입니다.")
    upload_headers: dict[str, str] | None = Field(description="업로드할 때 그대로 보내야 하는 헤더입니다.")
    expires_in: int | None = Field(description="업로드 URL 유효 시간(초)입니다.")


class VersionRequest(BaseModel):
    version: int | None = Field(default=None, gt=0, description="버전 번호입니다. 생략하면 서버가 정합니다.")


class UploadCompleteRequest(BaseModel):
    version: int = Field(gt=0, description="업로드를 마친 버전 번호입니다.")


class UploadCompleteResponse(BaseModel):
    document_id: UUID = Field(description="문서 ID입니다.")
    version: int = Field(description="버전 번호입니다.")
    status: str = Field(description="처리 후 버전 상태입니다.")
    error_code: str | None = Field(description="실패했을 때 원인 코드입니다.")


class DocumentVersionResponse(BaseModel):
    version: int = Field(description="버전 번호입니다.")
    status: str = Field(description="버전 상태입니다.")
    file_size: int = Field(description="파일 크기(byte)입니다.")
    sha256: str = Field(description="파일 SHA-256입니다.")
    error_code: str | None = Field(description="실패했을 때 원인 코드입니다.")
    created_at: datetime = Field(description="버전을 등록한 시각입니다.")
    uploaded_at: datetime | None = Field(description="업로드를 확인한 시각입니다.")
    processed_at: datetime | None = Field(description="분석을 마친 시각입니다.")


class DocumentSummary(BaseModel):
    document_id: UUID = Field(description="문서 ID입니다.")
    folder_id: UUID = Field(description="폴더 ID입니다.")
    relative_path: str = Field(description="폴더 루트 기준 경로입니다.")
    file_name: str = Field(description="파일 이름입니다.")
    latest_version: int = Field(description="가장 최근 버전 번호입니다.")
    status: str = Field(description="가장 최근 버전의 상태입니다.")
    error_code: str | None = Field(description="가장 최근 버전이 실패했을 때 원인 코드입니다. 실패가 아니면 null입니다.")
    created_at: datetime = Field(description="문서를 등록한 시각입니다.")


class DocumentDetailResponse(DocumentSummary):
    versions: list[DocumentVersionResponse] = Field(description="버전 목록입니다. 최신 버전이 먼저 옵니다.")


class FolderDocumentsResponse(BaseModel):
    folder_id: UUID = Field(description="폴더 ID입니다.")
    documents: list[DocumentSummary] = Field(description="문서 목록입니다.")


class DownloadUrlResponse(BaseModel):
    document_id: UUID = Field(description="문서 ID입니다.")
    version: int = Field(description="버전 번호입니다.")
    file_name: str = Field(description="파일 이름입니다.")
    download_url: str = Field(description="원본을 받을 Presigned GET URL입니다.")
    expires_in: int = Field(description="URL 유효 시간(초)입니다.")


class LocationResponse(BaseModel):
    document_id: UUID = Field(description="문서 ID입니다.")
    device_id: UUID = Field(description="기기 ID입니다.")
    local_path: str = Field(description="서버가 마지막으로 기록한 파일 경로입니다. 실제 존재는 앱이 확인합니다.")
    version: int | None = Field(description="그 기기에 있는 파일의 버전입니다.")
    sha256: str | None = Field(description="그 기기에 있는 파일의 SHA-256입니다.")
    last_verified_at: datetime | None = Field(description="마지막으로 존재를 확인한 시각입니다.")


class LocationUpdateRequest(BaseModel):
    local_path: str = Field(description="그 기기에서의 파일 전체 경로입니다.", examples=["D:\\다운로드\\프로세스.md"])
    version: int | None = Field(default=None, gt=0, description="그 파일의 버전입니다.")
    sha256: str | None = Field(default=None, description="그 파일의 SHA-256입니다.")

    @field_validator("local_path")
    @classmethod
    def check_local_path(cls, value: str) -> str:
        return validate_local_path(value)

    @field_validator("sha256")
    @classmethod
    def check_hash(cls, value: str | None) -> str | None:
        return None if value is None else check_sha256(value)


class LocationUpdateResponse(BaseModel):
    document_id: UUID = Field(description="문서 ID입니다.")
    device_id: UUID = Field(description="기기 ID입니다.")
    status: str = Field(description="저장 결과입니다. 값은 `updated`입니다.")


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000, description="검색어입니다.")
    top_k: int = Field(default=5, ge=1, le=50, description="돌려받을 결과 수입니다.")

    @field_validator("query")
    @classmethod
    def check_query(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("검색어를 입력하세요.")
        return value


class SearchResult(BaseModel):
    document_id: UUID = Field(description="문서 ID입니다.")
    folder_id: UUID = Field(description="폴더 ID입니다.")
    file_name: str = Field(description="파일 이름입니다.")
    relative_path: str = Field(description="폴더 루트 기준 경로입니다.")
    version: int = Field(description="검색된 버전 번호입니다.")
    chunk_id: UUID = Field(description="검색된 청크 ID입니다.")
    snippet: str = Field(description="청크 발췌입니다.")
    score: float = Field(description="코사인 유사도(1 - 코사인 거리)입니다. 클수록 가깝습니다.")


class SearchResponse(BaseModel):
    results: list[SearchResult] = Field(description="유사도 순 검색 결과입니다.")
