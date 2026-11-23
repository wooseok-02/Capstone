from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from ..core.paths import clean_display_name


class DeviceCreateRequest(BaseModel):
    device_name: str = Field(description="화면에 보여줄 기기 이름입니다. 1~100자입니다.", examples=["내 노트북"])

    @field_validator("device_name")
    @classmethod
    def check_device_name(cls, value: str) -> str:
        return clean_display_name(value, 100)


class DeviceResponse(BaseModel):
    device_id: UUID = Field(description="서버가 발급한 기기 ID입니다. Electron이 보관합니다.")
    device_name: str = Field(description="기기 이름입니다.")
    created_at: datetime = Field(description="기기를 등록한 시각입니다.")
