from pydantic import AnyHttpUrl, BaseModel, ConfigDict, PositiveInt


class EmbeddingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_version_id: str
    file_name: str
    mime_type: str
    download_url: AnyHttpUrl
    expires_in: PositiveInt
