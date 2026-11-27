from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, computed_field


class NotificationReadResponse(BaseModel):
    notification_id: UUID = Field(description="알림 ID입니다.")
    read_at: datetime | None = Field(description="최초로 읽은 시각입니다. 읽지 않았으면 null입니다.")

    @computed_field(description="읽은 알림이면 true입니다. 말풍선 표시 여부와 별개입니다.")
    @property
    def is_read(self) -> bool:
        return self.read_at is not None


class NotificationResponse(NotificationReadResponse):
    title: str = Field(description="알림 제목입니다.")
    message: str = Field(description="알림 요약 문구입니다.")
    source_device_id: UUID | None = Field(description="문서 변경을 보고한 기기입니다. 모르면 null입니다.")
    created_at: datetime = Field(description="알림 생성 시각입니다.")


class NotificationSummary(NotificationResponse):
    related_document_count: int = Field(description="알림에 남아 있는 관련 문서 항목 수입니다.")


class NotificationListResponse(BaseModel):
    notifications: list[NotificationSummary] = Field(description="생성 시각이 최신인 알림부터 반환합니다.")
    total_count: int = Field(description="기기 범위 내의 전체 알림 수입니다. 읽지 않음 필터와 페이지 적용 전입니다.")
    unread_count: int = Field(description="기기 범위 내의 읽지 않은 알림 수입니다. 페이지 적용 전입니다.")
    limit: int = Field(description="요청한 페이지 크기입니다.")
    offset: int = Field(description="목록에서 건너뛴 알림 수입니다.")


class NotificationDocument(BaseModel):
    document_id: UUID = Field(description="기기별 위치 조회와 다운로드 URL 요청에 사용할 문서 ID입니다.")
    document_version_id: UUID = Field(description="알림이 참조하는 문서 버전의 고유 ID입니다.")
    file_name: str = Field(description="문서의 파일 이름입니다.")
    version: int = Field(description="다운로드 요청 본문에 지정할 문서 버전 번호입니다.")


class NotificationRelatedDocument(NotificationDocument):
    connection_reason: str = Field(description="기준 문서와 연결된 이유입니다.")
    source_excerpt: str | None = Field(description="기준 문서의 근거 구절입니다.")
    related_excerpt: str | None = Field(description="관련 문서의 근거 구절입니다.")


class NotificationDetailResponse(NotificationResponse):
    source_document: NotificationDocument = Field(description="알림을 발생시킨 기준 문서입니다.")
    related_documents: list[NotificationRelatedDocument] = Field(description="관련 문서와 각 문서의 연결 이유입니다.")
