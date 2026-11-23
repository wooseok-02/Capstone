from uuid import UUID

from fastapi import HTTPException


def create_device(db, user_id: int, device_name: str) -> dict:
    return db.execute("""
        INSERT INTO devices (user_id, device_name) VALUES (%s, %s)
        RETURNING device_id, device_name, created_at
        """, (user_id, device_name)).fetchone()


def require_owned_device(db, user_id: int, device_id: UUID) -> None:
    device = db.execute(
        "SELECT 1 FROM devices WHERE device_id = %s AND user_id = %s", (device_id, user_id),
    ).fetchone()
    if device is None:
        # 다른 계정의 기기 존재 여부가 드러나지 않도록 404로 응답한다.
        raise HTTPException(404, "기기를 찾을 수 없습니다.")
