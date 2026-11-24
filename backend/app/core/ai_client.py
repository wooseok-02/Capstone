"""AI 서버 호출. 내부 토큰으로 인증하고, 사용자 정보·로컬 경로는 보내지 않는다.

TODO: 동기/비동기 호출 방식과 AI 서버의 실제 엔드포인트 경로는 AI 담당과 확정 후 맞춘다.
현재는 노션 '백엔드 → AI' 문서의 요청·응답 형식을 HTTP 요청 1회로 주고받는다고 가정한다.
"""
import math
from dataclasses import dataclass

import httpx

from ..config import Settings


MAX_EMBEDDING_DIM = 16000  # pgvector vector 타입의 최대 차원
MAX_CHUNKS = 20000


class AIError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class ProcessResult:
    embedding_model: str
    embedding_dim: int
    chunks: list[tuple[int, str, str]]  # (chunk_index, chunk_text, pgvector 문자열)


def processing_configured(settings: Settings) -> bool:
    return bool(settings.ai_process_url and settings.ai_internal_token)


def embedding_configured(settings: Settings) -> bool:
    return bool(settings.ai_embed_url and settings.ai_internal_token)


def _post(settings: Settings, url: str, body: dict) -> dict:
    try:
        response = httpx.post(
            url, json=body, timeout=settings.ai_timeout_seconds,
            headers={"Authorization": f"Bearer {settings.ai_internal_token}"},
        )
    except httpx.HTTPError:
        raise AIError("AI_UNREACHABLE") from None
    if response.status_code != 200:
        raise AIError(f"AI_HTTP_{response.status_code}")
    try:
        data = response.json()
    except ValueError:
        raise AIError("AI_INVALID_RESPONSE") from None
    if not isinstance(data, dict):
        raise AIError("AI_INVALID_RESPONSE")
    return data


def to_vector(values, dim: int) -> str:
    if not isinstance(values, list) or len(values) != dim:
        raise AIError("AI_INVALID_EMBEDDING")
    numbers = []
    for value in values:
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise AIError("AI_INVALID_EMBEDDING")
        numbers.append(repr(float(value)))
    return "[" + ",".join(numbers) + "]"


def _model_and_dim(data: dict) -> tuple[str, int]:
    model, dim = data.get("embedding_model"), data.get("embedding_dim")
    if not isinstance(model, str) or not model.strip() or len(model) > 200:
        raise AIError("AI_INVALID_RESPONSE")
    if isinstance(dim, bool) or not isinstance(dim, int) or not 0 < dim <= MAX_EMBEDDING_DIM:
        raise AIError("AI_INVALID_RESPONSE")
    return model, dim


def process_document(settings: Settings, document_version_id: str, file_name: str, mime_type: str,
                     download_url: str) -> ProcessResult:
    data = _post(settings, settings.ai_process_url, {
        "document_version_id": document_version_id,
        "file_name": file_name,
        "mime_type": mime_type,
        "download_url": download_url,
        "expires_in": settings.ai_download_url_expires,
    })
    if data.get("document_version_id") != document_version_id:
        raise AIError("AI_VERSION_MISMATCH")
    if data.get("status") != "success":
        code = data.get("error_code")
        # AI가 보낸 오류 코드는 형식이 맞을 때만 그대로 저장한다. error_message는 본문이 섞일 수 있어 저장하지 않는다.
        if isinstance(code, str) and code.replace("_", "").isalnum() and len(code) <= 50:
            raise AIError(code.upper())
        raise AIError("AI_PROCESSING_FAILED")
    model, dim = _model_and_dim(data)
    raw_chunks = data.get("chunks")
    if not isinstance(raw_chunks, list) or not 0 < len(raw_chunks) <= MAX_CHUNKS:
        raise AIError("AI_INVALID_CHUNKS")
    chunks, seen = [], set()
    for chunk in raw_chunks:
        if not isinstance(chunk, dict):
            raise AIError("AI_INVALID_CHUNKS")
        index, text = chunk.get("chunk_index"), chunk.get("chunk_text")
        if isinstance(index, bool) or not isinstance(index, int) or index < 0 or index in seen:
            raise AIError("AI_INVALID_CHUNKS")
        if not isinstance(text, str) or not text.strip() or "\x00" in text:
            raise AIError("AI_INVALID_CHUNKS")
        seen.add(index)
        chunks.append((index, text, to_vector(chunk.get("embedding"), dim)))
    return ProcessResult(model, dim, chunks)


def embed_query(settings: Settings, text: str) -> tuple[str, int, str]:
    # TODO: 검색어 임베딩 요청 형식은 미정이다. 현재 가정: {"text"} → {"embedding_model", "embedding_dim", "embedding"}
    data = _post(settings, settings.ai_embed_url, {"text": text})
    model, dim = _model_and_dim(data)
    return model, dim, to_vector(data.get("embedding"), dim)
