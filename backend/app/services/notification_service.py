from uuid import UUID

from fastapi import HTTPException

from ..models.notification import NotificationCreate
from .device_service import require_owned_device
from .document_service import get_owned_document


# 관련 항목이 모두 삭제된 알림은 삭제 정리 연동 전까지 노출하지 않는다.
HAS_RELATED_DOCUMENTS = "EXISTS (SELECT 1 FROM notification_items i WHERE i.notification_id = n.notification_id)"


def create_notification(db, user_id: int, body: NotificationCreate) -> UUID | None:
    """알림과 항목을 함께 저장한다. 빈 결과나 재전송이면 None을 반환한다."""
    if not body.related_documents:
        return None

    source_version_id = body.source_document_version_id
    version_ids = {source_version_id}
    version_ids.update(item.related_document_version_id for item in body.related_documents)

    with db.transaction():
        versions = db.execute("""
            SELECT document_version_id, document_id FROM document_versions
            WHERE document_version_id = ANY(%s)
            """, (list(version_ids),)).fetchall()
        if len(versions) != len(version_ids):
            raise HTTPException(404, "문서 버전을 찾을 수 없습니다.")

        document_by_version = {row["document_version_id"]: row["document_id"] for row in versions}
        owned_documents = {
            document_id: get_owned_document(db, user_id, document_id)
            for document_id in set(document_by_version.values())
        }
        if body.source_device_id is not None:
            require_owned_device(db, user_id, body.source_device_id)

        source_name = owned_documents[document_by_version[source_version_id]]["file_name"]
        notification = db.execute("""
            INSERT INTO notifications (user_id, source_document_version_id, source_device_id, title, message)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (source_document_version_id) DO NOTHING
            RETURNING notification_id
            """, (user_id, source_version_id, body.source_device_id, "관련 기록을 찾았어요",
                  f"{source_name}와 관련된 기록이 있어요.")).fetchone()
        if notification is None:
            return None

        notification_id = notification["notification_id"]
        with db.cursor() as cursor:
            cursor.executemany("""
                INSERT INTO notification_items
                    (notification_id, related_document_version_id, connection_reason, source_excerpt, related_excerpt)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (notification_id, related_document_version_id) DO NOTHING
                """, [
                (notification_id, item.related_document_version_id, item.connection_reason,
                 item.source_excerpt, item.related_excerpt)
                for item in body.related_documents
            ])
        return notification_id


def list_notifications(db, user_id: int, limit: int, offset: int, unread_only: bool,
                       device_id: UUID | None) -> dict:
    if device_id is not None:
        require_owned_device(db, user_id, device_id)

    # 목록과 집계를 한 쿼리에서 읽어 그 사이의 저장·읽음 변경으로 숫자가 어긋나지 않게 한다.
    rows = db.execute(f"""
        WITH visible AS (
            SELECT n.notification_id, n.title, n.message, n.source_device_id, n.created_at, n.read_at
            FROM notifications n
            WHERE n.user_id = %s AND (%s::uuid IS NULL OR n.source_device_id = %s)
              AND {HAS_RELATED_DOCUMENTS}
        ), counts AS (
            SELECT COUNT(*) AS total_count, COUNT(*) FILTER (WHERE read_at IS NULL) AS unread_count
            FROM visible
        ), page AS (
            SELECT * FROM visible WHERE NOT %s OR read_at IS NULL
            ORDER BY created_at DESC, notification_id DESC
            LIMIT %s OFFSET %s
        )
        SELECT counts.total_count, counts.unread_count, page.*,
            (SELECT COUNT(*) FROM notification_items i
             WHERE i.notification_id = page.notification_id) AS related_document_count
        FROM counts LEFT JOIN page ON TRUE
        ORDER BY page.created_at DESC, page.notification_id DESC
        """, (user_id, device_id, device_id, unread_only, limit, offset)).fetchall()

    return {
        "notifications": [row for row in rows if row["notification_id"] is not None],
        "total_count": rows[0]["total_count"],
        "unread_count": rows[0]["unread_count"],
        "limit": limit,
        "offset": offset,
    }


def get_notification(db, user_id: int, notification_id: UUID) -> dict:
    rows = db.execute("""
        SELECT n.notification_id, n.title, n.message, n.source_device_id, n.created_at, n.read_at,
            jsonb_build_object(
                'document_id', source_document.document_id, 'document_version_id', source_version.document_version_id,
                'file_name', source_document.file_name, 'version', source_version.version_no
            ) AS source_document,
            jsonb_build_object(
                'document_id', related_document.document_id, 'document_version_id', related_version.document_version_id,
                'file_name', related_document.file_name, 'version', related_version.version_no,
                'connection_reason', item.connection_reason, 'source_excerpt', item.source_excerpt,
                'related_excerpt', item.related_excerpt
            ) AS related_document
        FROM notifications n
        JOIN document_versions source_version ON source_version.document_version_id = n.source_document_version_id
        JOIN documents source_document ON source_document.document_id = source_version.document_id
        JOIN notification_items item ON item.notification_id = n.notification_id
        JOIN document_versions related_version ON related_version.document_version_id = item.related_document_version_id
        JOIN documents related_document ON related_document.document_id = related_version.document_id
        WHERE n.user_id = %s AND n.notification_id = %s
        ORDER BY item.notification_item_id
        """, (user_id, notification_id)).fetchall()
    if not rows:
        raise HTTPException(404, "알림을 찾을 수 없습니다.")
    notification = rows[0].copy()
    notification.pop("related_document")
    notification["related_documents"] = [row["related_document"] for row in rows]
    return notification


def mark_notification_read(db, user_id: int, notification_id: UUID) -> dict:
    # 한 UPDATE 안에서 기존 값을 보존해 동시에 요청해도 최초 읽음 시각이 유지된다.
    notification = db.execute(f"""
        UPDATE notifications n SET read_at = COALESCE(n.read_at, clock_timestamp())
        WHERE n.user_id = %s AND n.notification_id = %s AND {HAS_RELATED_DOCUMENTS}
        RETURNING n.notification_id, n.read_at
        """, (user_id, notification_id)).fetchone()
    if notification is None:
        raise HTTPException(404, "알림을 찾을 수 없습니다.")
    return notification
