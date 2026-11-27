from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, StringConstraints


ConnectionReason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class RelatedDocumentResult(BaseModel):
    """저장 서비스에서 사용하는 관련 문서 한 건."""

    related_document_version_id: UUID
    connection_reason: ConnectionReason
    source_excerpt: str | None = None
    related_excerpt: str | None = None


class NotificationCreate(BaseModel):
    """AI 응답 또는 테스트 데이터를 변환해서 전달하는 내부 입력."""

    source_document_version_id: UUID
    source_device_id: UUID | None = None
    related_documents: tuple[RelatedDocumentResult, ...]
