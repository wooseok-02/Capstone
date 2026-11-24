from uuid import UUID, uuid4

from fastapi import HTTPException

from ..core.paths import normalize_local_path
from ..schemas.folder import FolderCreateRequest
from .device_service import require_owned_device


FOLDER_COLUMNS = "folder_id, folder_name, status, created_at"


def get_owned_folder(db, user_id: int, folder_id: UUID, lock: bool = False) -> dict:
    query = f"""
        SELECT {FOLDER_COLUMNS} FROM folders
        WHERE folder_id = %s AND user_id = %s AND status = 'registered'
        """
    if lock:
        query += " FOR UPDATE"
    folder = db.execute(query, (folder_id, user_id)).fetchone()
    if folder is None:
        # 다른 계정의 폴더 존재 여부가 드러나지 않도록 404로 응답한다.
        raise HTTPException(404, "폴더를 찾을 수 없습니다.")
    return folder


def register_folder(db, user_id: int, body: FolderCreateRequest) -> dict:
    require_owned_device(db, user_id, body.device_id)
    normalized_path = normalize_local_path(body.local_path)
    folder = db.execute(f"""
        INSERT INTO folders (user_id, folder_name) VALUES (%s, %s)
        RETURNING {FOLDER_COLUMNS}
        """, (user_id, body.folder_name)).fetchone()
    location = db.execute("""
        INSERT INTO folder_locations (folder_id, device_id, local_path, normalized_path, last_seen_at)
        VALUES (%s, %s, %s, %s, clock_timestamp())
        ON CONFLICT (device_id, normalized_path) DO NOTHING
        RETURNING folder_id
        """, (folder["folder_id"], body.device_id, body.local_path, normalized_path)).fetchone()
    if location is None:
        existing = db.execute("""
            SELECT folder_id FROM folder_locations WHERE device_id = %s AND normalized_path = %s
            """, (body.device_id, normalized_path)).fetchone()
        # 예외가 connect 블록을 빠져나가면서 방금 만든 folders 행도 롤백된다.
        raise HTTPException(409, {
            "message": "이 기기에 이미 등록된 폴더입니다.",
            "folder_id": str(existing["folder_id"]) if existing else None,
        })
    return folder


def list_folders(db, user_id: int) -> list[dict]:
    return db.execute(f"""
        SELECT {FOLDER_COLUMNS} FROM folders
        WHERE user_id = %s AND status = 'registered'
        ORDER BY created_at DESC, folder_id
        """, (user_id,)).fetchall()


def read_exclusions(db, folder_id: UUID) -> list[str]:
    rows = db.execute("""
        SELECT relative_path FROM folder_exclusions WHERE folder_id = %s
        ORDER BY relative_path COLLATE "C"
        """, (folder_id,)).fetchall()
    # DB 로캘 정렬은 `.` 같은 기호를 무시하므로 환경과 관계없이 같은 순서가 나오도록 문자 코드 순으로 정렬한다.
    return [row["relative_path"] for row in rows]


def get_folder_detail(db, user_id: int, folder_id: UUID) -> dict:
    folder = get_owned_folder(db, user_id, folder_id)
    locations = db.execute("""
        SELECT device_id, local_path, last_seen_at FROM folder_locations
        WHERE folder_id = %s ORDER BY device_id
        """, (folder_id,)).fetchall()
    return {**folder, "locations": locations, "excluded_paths": read_exclusions(db, folder_id)}


def replace_exclusions(db, user_id: int, folder_id: UUID, paths: list[str]) -> list[str]:
    # TODO: 임베딩 후 새로 제외한 폴더의 R2 원본·청크 처리 정책은 문서 기능 구현 때 확정한다.
    get_owned_folder(db, user_id, folder_id, lock=True)
    db.execute("""
        DELETE FROM folder_exclusions WHERE folder_id = %s AND NOT (relative_path = ANY(%s))
        """, (folder_id, paths))
    if paths:
        with db.cursor() as cursor:
            cursor.executemany("""
                INSERT INTO folder_exclusions (folder_id, relative_path) VALUES (%s, %s)
                ON CONFLICT (folder_id, relative_path) DO NOTHING
                """, [(folder_id, path) for path in paths])
    return read_exclusions(db, folder_id)


def request_rescan(db, user_id: int, folder_id: UUID, device_id: UUID) -> dict:
    get_owned_folder(db, user_id, folder_id)
    require_owned_device(db, user_id, device_id)
    location = db.execute("""
        SELECT 1 FROM folder_locations WHERE folder_id = %s AND device_id = %s
        """, (folder_id, device_id)).fetchone()
    if location is None:
        raise HTTPException(404, "이 기기에 연결된 폴더가 아닙니다.")
    # TODO: 재탐색 결과 제출 방식이 확정되면 scan_id를 저장하고 결과 접수와 연결한다.
    return {"folder_id": folder_id, "scan_id": uuid4(), "status": "awaiting_client_scan"}


def disconnect_folder(db, user_id: int, folder_id: UUID) -> None:
    # 연결만 해제한다. 폴더 행과 제외 규칙은 보존하고 기기별 로컬 경로는 지운다.
    get_owned_folder(db, user_id, folder_id, lock=True)
    db.execute("DELETE FROM folder_locations WHERE folder_id = %s", (folder_id,))
    db.execute("UPDATE folders SET status = 'disconnected' WHERE folder_id = %s", (folder_id,))
