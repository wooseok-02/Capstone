import logging
import mimetypes
import re
from uuid import UUID

from fastapi import HTTPException

from ..config import Settings
from ..core import ai_client, storage
from ..core.paths import is_excluded, join_local_path
from ..database import connect
from ..schemas.document import DocumentCreateRequest, LocationUpdateRequest
from .device_service import require_owned_device
from .folder_service import get_owned_folder, read_exclusions


logger = logging.getLogger(__name__)
mimetypes.add_type("text/markdown", ".md")

# R2에 원본이 있는 상태. 다운로드와 재처리가 가능하다.
OBJECT_STATUSES = ("uploaded", "processing", "ready", "processing_failed")
SAFE_EXTENSION = re.compile(r"^\.[a-z0-9]{1,10}$")
SNIPPET_LENGTH = 300


def _object_key(user_id: int, document_id: UUID, version_no: int, file_name: str) -> str:
    # 파일 이름에는 개인정보가 들어갈 수 있어 확장자만 붙인다.
    extension = "." + file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
    if not SAFE_EXTENSION.match(extension):
        extension = ""
    return f"{user_id}/{document_id}/v{version_no}{extension}"


def _mime_type(file_name: str) -> str:
    return mimetypes.guess_type(file_name, strict=False)[0] or "application/octet-stream"


def _upload_fields(settings: Settings, version: dict) -> dict:
    return {
        "upload_url": storage.presign_put(settings, version["object_key"], version["mime_type"]),
        "upload_headers": {"Content-Type": version["mime_type"]},
        "expires_in": settings.upload_url_expires,
    }


def register_document(db, settings: Settings, user_id: int, body: DocumentCreateRequest) -> dict:
    storage.require_storage(settings)
    if body.file_size > settings.max_upload_bytes:
        raise HTTPException(413, f"파일은 {settings.max_upload_bytes} byte 이하만 올릴 수 있습니다.")
    get_owned_folder(db, user_id, body.folder_id)
    require_owned_device(db, user_id, body.device_id)
    folder_location = db.execute("""
        SELECT local_path FROM folder_locations WHERE folder_id = %s AND device_id = %s
        """, (body.folder_id, body.device_id)).fetchone()
    if folder_location is None:
        raise HTTPException(404, "이 기기에 연결된 폴더가 아닙니다.")
    if is_excluded(body.relative_path, read_exclusions(db, body.folder_id)):
        raise HTTPException(422, "제외된 폴더의 파일은 등록할 수 없습니다.")

    db.execute("""
        INSERT INTO documents (folder_id, relative_path, file_name, registered_device_id)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (folder_id, relative_path) DO NOTHING
        """, (body.folder_id, body.relative_path, body.file_name, body.device_id))
    # 같은 문서에 대한 동시 요청은 이 잠금에서 차례로 처리되어 버전이 중복 생성되지 않는다.
    document = db.execute("""
        SELECT document_id FROM documents WHERE folder_id = %s AND relative_path = %s FOR UPDATE
        """, (body.folder_id, body.relative_path)).fetchone()
    document_id = document["document_id"]
    latest = db.execute("""
        SELECT document_version_id, version_no, object_key, mime_type, status, sha256, file_size
        FROM document_versions WHERE document_id = %s ORDER BY version_no DESC LIMIT 1
        """, (document_id,)).fetchone()

    # TODO: 멱등성 기준은 팀 확정 전 임시다. 최신 버전과 해시·크기가 같으면 같은 파일로 보고 기존 버전을 돌려준다.
    if latest and latest["sha256"] == body.sha256 and latest["file_size"] == body.file_size:
        version = latest
        if version["status"] in ("upload_pending", "upload_failed"):
            db.execute("""
                UPDATE document_versions SET status = 'upload_pending', error_code = NULL
                WHERE document_version_id = %s
                """, (version["document_version_id"],))
            version = {**version, "status": "upload_pending"}
    else:
        version_no = latest["version_no"] + 1 if latest else 1
        mime_type = _mime_type(body.file_name)
        version = db.execute("""
            INSERT INTO document_versions
                (document_id, version_no, object_key, file_size, sha256, mime_type, file_modified_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING document_version_id, version_no, object_key, mime_type, status
            """, (document_id, version_no, _object_key(user_id, document_id, version_no, body.file_name),
                  body.file_size, body.sha256, mime_type, body.modified_at)).fetchone()

    db.execute("""
        INSERT INTO document_locations (document_id, device_id, local_path, version_no, sha256, last_verified_at)
        VALUES (%s, %s, %s, %s, %s, clock_timestamp())
        ON CONFLICT (document_id, device_id) DO UPDATE SET
            local_path = EXCLUDED.local_path, version_no = EXCLUDED.version_no,
            sha256 = EXCLUDED.sha256, last_verified_at = EXCLUDED.last_verified_at
        """, (document_id, body.device_id, join_local_path(folder_location["local_path"], body.relative_path),
              version["version_no"], body.sha256))

    upload = (_upload_fields(settings, version) if version["status"] == "upload_pending"
              else {"upload_url": None, "upload_headers": None, "expires_in": None})
    return {
        "document_id": document_id,
        "document_version_id": version["document_version_id"],
        "version": version["version_no"],
        "object_key": version["object_key"],
        "status": version["status"],
        **upload,
    }


def get_owned_document(db, user_id: int, document_id: UUID) -> dict:
    document = db.execute("""
        SELECT d.document_id, d.folder_id, d.relative_path, d.file_name, d.created_at
        FROM documents d JOIN folders f USING (folder_id)
        WHERE d.document_id = %s AND f.user_id = %s
        """, (document_id, user_id)).fetchone()
    if document is None:
        raise HTTPException(404, "문서를 찾을 수 없습니다.")
    return document


def _owned_version(db, user_id: int, document_id: UUID, version_no: int, lock: bool = False) -> dict:
    get_owned_document(db, user_id, document_id)
    query = """
        SELECT document_version_id, version_no, object_key, file_size, status
        FROM document_versions WHERE document_id = %s AND version_no = %s
        """
    version = db.execute(query + (" FOR UPDATE" if lock else ""), (document_id, version_no)).fetchone()
    if version is None:
        raise HTTPException(404, "문서 버전을 찾을 수 없습니다.")
    return version


def complete_upload(db, settings: Settings, user_id: int, document_id: UUID, version_no: int) -> tuple[dict, UUID | None]:
    """업로드를 검증한다. 분석을 시작해야 하면 두 번째 값으로 버전 ID를 돌려준다."""
    storage.require_storage(settings)
    version = _owned_version(db, user_id, document_id, version_no, lock=True)
    status, error_code = version["status"], None

    if status in ("upload_pending", "upload_failed"):
        size = storage.object_size(settings, version["object_key"])
        if size is None or size != version["file_size"]:
            status, error_code = "upload_failed", "OBJECT_NOT_FOUND" if size is None else "SIZE_MISMATCH"
            db.execute("""
                UPDATE document_versions SET status = %s, error_code = %s WHERE document_version_id = %s
                """, (status, error_code, version["document_version_id"]))
        else:
            status = "uploaded"
            db.execute("""
                UPDATE document_versions SET status = 'uploaded', error_code = NULL, uploaded_at = clock_timestamp()
                WHERE document_version_id = %s
                """, (version["document_version_id"],))

    start = None
    # 이미 처리 중이거나 끝난 버전은 그대로 돌려준다(같은 완료 통지가 여러 번 와도 결과가 같다).
    # 분석 실패한 버전은 다시 완료 통지를 보내면 재처리한다.
    if status in ("uploaded", "processing_failed") and ai_client.processing_configured(settings):
        status = "processing"
        db.execute("""
            UPDATE document_versions SET status = 'processing', error_code = NULL WHERE document_version_id = %s
            """, (version["document_version_id"],))
        start = version["document_version_id"]
    elif status == "processing_failed":
        error_code = db.execute(
            "SELECT error_code FROM document_versions WHERE document_version_id = %s",
            (version["document_version_id"],),
        ).fetchone()["error_code"]

    return {"document_id": document_id, "version": version_no, "status": status, "error_code": error_code}, start


def _mark_failed(settings: Settings, document_version_id: UUID, error_code: str) -> None:
    with connect(settings) as db:
        db.execute("""
            UPDATE document_versions SET status = 'processing_failed', error_code = %s, processed_at = clock_timestamp()
            WHERE document_version_id = %s AND status = 'processing'
            """, (error_code, document_version_id))


def process_version(settings: Settings, document_version_id: UUID) -> None:
    """응답을 보낸 뒤 실행한다. AI 결과를 받아 청크를 전부 저장한 뒤에만 ready로 바꾼다.

    TODO: 작업 큐가 정해지면 옮긴다. 지금은 서버가 처리 중에 꺼지면 버전이 processing에 남는다.
    """
    with connect(settings) as db:
        version = db.execute("""
            SELECT v.object_key, v.mime_type, v.status, d.file_name
            FROM document_versions v JOIN documents d USING (document_id)
            WHERE v.document_version_id = %s
            """, (document_version_id,)).fetchone()
    if version is None or version["status"] != "processing":
        return
    try:
        download_url = storage.presign_get(settings, version["object_key"], settings.ai_download_url_expires)
        result = ai_client.process_document(
            settings, str(document_version_id), version["file_name"], version["mime_type"], download_url,
        )
    except ai_client.AIError as error:
        logger.warning("document processing failed: version=%s code=%s", document_version_id, error.code)
        _mark_failed(settings, document_version_id, error.code)
        return
    except Exception:
        logger.exception("document processing failed: version=%s", document_version_id)
        _mark_failed(settings, document_version_id, "PROCESSING_ERROR")
        return

    try:
        with connect(settings) as db:
            current = db.execute("""
                SELECT status FROM document_versions WHERE document_version_id = %s FOR UPDATE
                """, (document_version_id,)).fetchone()
            if current is None or current["status"] != "processing":
                return
            # 재처리라면 이전 청크를 지우고 새로 넣는다. 한 트랜잭션이라 일부만 저장되는 일은 없다.
            db.execute("DELETE FROM chunks WHERE document_version_id = %s", (document_version_id,))
            with db.cursor() as cursor:
                cursor.executemany("""
                    INSERT INTO chunks (document_version_id, chunk_index, chunk_text, embedding)
                    VALUES (%s, %s, %s, %s::vector)
                    """, [(document_version_id, index, text, vector) for index, text, vector in result.chunks])
            db.execute("""
                UPDATE document_versions SET status = 'ready', error_code = NULL,
                    embedding_model = %s, embedding_dim = %s, processed_at = clock_timestamp()
                WHERE document_version_id = %s
                """, (result.embedding_model, result.embedding_dim, document_version_id))
    except Exception:
        logger.exception("chunk store failed: version=%s", document_version_id)
        _mark_failed(settings, document_version_id, "STORE_FAILED")


LATEST_VERSION = """
    JOIN LATERAL (
        SELECT version_no AS latest_version, status, error_code FROM document_versions v
        WHERE v.document_id = d.document_id ORDER BY version_no DESC LIMIT 1
    ) latest ON TRUE
"""


def list_folder_documents(db, user_id: int, folder_id: UUID, limit: int, offset: int) -> list[dict]:
    get_owned_folder(db, user_id, folder_id)
    return db.execute(f"""
        SELECT d.document_id, d.folder_id, d.relative_path, d.file_name, d.created_at,
               latest.latest_version, latest.status, latest.error_code
        FROM documents d {LATEST_VERSION}
        WHERE d.folder_id = %s
        ORDER BY d.relative_path COLLATE "C"
        LIMIT %s OFFSET %s
        """, (folder_id, limit, offset)).fetchall()


def get_document_detail(db, user_id: int, document_id: UUID) -> dict:
    get_owned_document(db, user_id, document_id)
    document = db.execute(f"""
        SELECT d.document_id, d.folder_id, d.relative_path, d.file_name, d.created_at,
               latest.latest_version, latest.status, latest.error_code
        FROM documents d {LATEST_VERSION}
        WHERE d.document_id = %s
        """, (document_id,)).fetchone()
    versions = db.execute("""
        SELECT version_no AS version, status, file_size, sha256, error_code, created_at, uploaded_at, processed_at
        FROM document_versions WHERE document_id = %s ORDER BY version_no DESC
        """, (document_id,)).fetchall()
    return {**document, "versions": versions}


def create_download_url(db, settings: Settings, user_id: int, document_id: UUID, version_no: int | None) -> dict:
    storage.require_storage(settings)
    document = get_owned_document(db, user_id, document_id)
    if version_no is None:
        version = db.execute("""
            SELECT version_no, object_key FROM document_versions
            WHERE document_id = %s AND status = ANY(%s) ORDER BY version_no DESC LIMIT 1
            """, (document_id, list(OBJECT_STATUSES))).fetchone()
        if version is None:
            raise HTTPException(404, "다운로드할 수 있는 버전이 없습니다.")
    else:
        version = _owned_version(db, user_id, document_id, version_no)
        if version["status"] not in OBJECT_STATUSES:
            raise HTTPException(409, "아직 업로드가 확인되지 않은 버전입니다.")
    return {
        "document_id": document_id,
        "version": version["version_no"],
        "file_name": document["file_name"],
        "download_url": storage.presign_get(settings, version["object_key"], settings.download_url_expires),
        "expires_in": settings.download_url_expires,
    }


def get_location(db, user_id: int, document_id: UUID, device_id: UUID) -> dict:
    get_owned_document(db, user_id, document_id)
    require_owned_device(db, user_id, device_id)
    location = db.execute("""
        SELECT document_id, device_id, local_path, version_no AS version, sha256, last_verified_at
        FROM document_locations WHERE document_id = %s AND device_id = %s
        """, (document_id, device_id)).fetchone()
    if location is None:
        raise HTTPException(404, "이 기기에 기록된 문서 경로가 없습니다.")
    return location


def update_location(db, user_id: int, document_id: UUID, device_id: UUID, body: LocationUpdateRequest) -> None:
    get_owned_document(db, user_id, document_id)
    require_owned_device(db, user_id, device_id)
    if body.version is not None:
        exists = db.execute("""
            SELECT 1 FROM document_versions WHERE document_id = %s AND version_no = %s
            """, (document_id, body.version)).fetchone()
        if exists is None:
            raise HTTPException(404, "문서 버전을 찾을 수 없습니다.")
    db.execute("""
        INSERT INTO document_locations (document_id, device_id, local_path, version_no, sha256, last_verified_at)
        VALUES (%s, %s, %s, %s, %s, clock_timestamp())
        ON CONFLICT (document_id, device_id) DO UPDATE SET
            local_path = EXCLUDED.local_path, version_no = EXCLUDED.version_no,
            sha256 = EXCLUDED.sha256, last_verified_at = EXCLUDED.last_verified_at
        """, (document_id, device_id, body.local_path, body.version, body.sha256))


def search(settings: Settings, user_id: int, query: str, top_k: int) -> list[dict]:
    if not ai_client.embedding_configured(settings):
        raise HTTPException(503, "검색 서버가 설정되지 않았습니다.")
    try:
        model, dim, vector = ai_client.embed_query(settings, query)
    except ai_client.AIError as error:
        logger.warning("query embedding failed: code=%s", error.code)
        raise HTTPException(502, "검색어를 분석하지 못했습니다.") from None
    # TODO: 거리 함수는 미정이다. 현재 코사인 거리(<=>)를 쓰고 점수는 1 - 거리로 돌려준다.
    # 내 폴더(연결 해제 제외), ready 상태의 최신 버전, 제외 경로 밖의 문서만 검색한다.
    with connect(settings) as db:
        return db.execute("""
            SELECT d.document_id, d.folder_id, d.file_name, d.relative_path, v.version_no AS version,
                   c.chunk_id, left(c.chunk_text, %s) AS snippet,
                   1 - (c.embedding <=> %s::vector) AS score
            FROM chunks c
            JOIN document_versions v USING (document_version_id)
            JOIN documents d USING (document_id)
            JOIN folders f ON f.folder_id = d.folder_id
            WHERE f.user_id = %s AND f.status = 'registered'
              AND v.status = 'ready' AND v.embedding_model = %s AND v.embedding_dim = %s
              AND v.version_no = (
                  SELECT max(v2.version_no) FROM document_versions v2
                  WHERE v2.document_id = d.document_id AND v2.status = 'ready'
              )
              AND NOT EXISTS (
                  SELECT 1 FROM folder_exclusions e
                  WHERE e.folder_id = d.folder_id
                    AND (d.relative_path = e.relative_path OR starts_with(d.relative_path, e.relative_path || '/'))
              )
            ORDER BY c.embedding <=> %s::vector
            LIMIT %s
            """, (SNIPPET_LENGTH, vector, user_id, model, dim, vector, top_k)).fetchall()
