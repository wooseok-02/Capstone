from typing import Literal

from pydantic import BaseModel, ConfigDict, NonNegativeInt, PositiveInt


class EmbeddingChunk(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    chunk_index: NonNegativeInt
    chunk_text: str
    embedding: list[float]


class EmbeddingSuccessResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_version_id: str
    status: Literal["success"] = "success"
    embedding_model: str
    embedding_dim: PositiveInt
    chunks: list[EmbeddingChunk]


class EmbeddingFailedResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_version_id: str
    status: Literal["failed"] = "failed"


EmbeddingResponse = EmbeddingSuccessResponse | EmbeddingFailedResponse
