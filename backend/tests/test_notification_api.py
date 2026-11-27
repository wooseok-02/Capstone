from contextlib import contextmanager
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient

from backend.app.config import Settings, get_settings
from backend.app.core.security import ACCESS_AUDIENCE, encode_token
from backend.app.main import app
from backend.app.models.notification import RelatedDocumentResult
from backend.app.services.notification_service import create_notification
from test_notification_service import NotificationDatabaseFixture


NOTIFICATIONS = "/api/v1/notifications"


class NotificationApiTest(NotificationDatabaseFixture):
    def setUp(self):
        super().setUp()
        self.settings = Settings(database_url="", jwt_secret="notification-test-secret-with-more-than-32-bytes")
        self.enterContext(patch.dict(app.dependency_overrides, {get_settings: lambda: self.settings}))
        self.enterContext(patch("backend.app.core.auth.connect", self._connect))
        self.enterContext(patch("backend.app.routers.notifications.connect", self._connect))
        self.client = self.enterContext(TestClient(app))
        self.headers = self._auth_headers(self.user_id)

    @contextmanager
    def _connect(self, settings):
        # HTTP 라우터와 인증 의존성은 실제 SQL을 실행하고, 테스트 종료 시 함께 롤백한다.
        with self.db.transaction():
            yield self.db

    def _auth_headers(self, user_id):
        session = self.db.execute("""
            INSERT INTO refresh_token (user_id, token_hash, expires_at)
            VALUES (%s, %s, CURRENT_TIMESTAMP + INTERVAL '1 hour') RETURNING id
            """, (user_id, uuid4().hex * 2)).fetchone()
        token = encode_token(self.settings, ACCESS_AUDIENCE, 600, {"sub": str(user_id), "sid": str(session["id"])})
        return {"Authorization": f"Bearer {token}"}

    def _save(self, **overrides):
        return create_notification(self.db, self.user_id, self._sample_result(**overrides))

    def _list(self, **params):
        response = self.client.get(NOTIFICATIONS, headers=self.headers, params=params)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_lists_only_current_users_notifications_and_counts(self):
        own_id = self._save()
        other_user = self._create_user()
        other_folder = self._create_folder(other_user)
        other_source = self._create_version(other_folder, "다른 회원의 원본.md")
        other_related = self._create_version(other_folder, "다른 회원의 관련 문서.md")
        create_notification(self.db, other_user, self._sample_result(
            source_document_version_id=other_source,
            related_documents=[RelatedDocumentResult(related_document_version_id=other_related, connection_reason="관련 내용")],
        ))

        data = self._list()
        self.assertEqual((data["total_count"], data["unread_count"]), (1, 1))
        [item] = data["notifications"]
        self.assertEqual(item["notification_id"], str(own_id))
        self.assertEqual(item["related_document_count"], 1)
        self.assertFalse(item["is_read"])
        self.assertIsNone(item["source_device_id"])

    def test_detail_returns_versioned_documents_without_marking_read(self):
        related_version = self._create_version(self.folder_id, "과제 개정판.md", version_no=3)
        notification_id = self._save(related_documents=[RelatedDocumentResult(
            related_document_version_id=related_version, connection_reason="같은 주제를 설명해요.",
            source_excerpt="기준 구절", related_excerpt="관련 구절",
        )])
        response = self.client.get(f"{NOTIFICATIONS}/{notification_id}", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data["source_document"]["file_name"], "운영체제 정리.md")
        self.assertEqual(data["source_document"]["document_version_id"], str(self.source_version))
        self.assertEqual(data["source_document"]["version"], 1)
        [related] = data["related_documents"]
        related_document_id = self.db.execute(
            "SELECT document_id FROM document_versions WHERE document_version_id = %s", (related_version,),
        ).fetchone()["document_id"]
        self.assertEqual(related["document_id"], str(related_document_id))
        self.assertEqual(related["document_version_id"], str(related_version))
        self.assertEqual(related["file_name"], "과제 개정판.md")
        self.assertEqual(related["version"], 3)
        self.assertEqual(related["connection_reason"], "같은 주제를 설명해요.")
        self.assertEqual((related["source_excerpt"], related["related_excerpt"]), ("기준 구절", "관련 구절"))
        self.assertFalse(data["is_read"])
        self.assertIsNone(self._notifications()[0]["read_at"])

    def test_blocks_access_without_login_and_other_users_detail_and_read(self):
        notification_id = self._save()
        path = f"{NOTIFICATIONS}/{notification_id}"
        other_headers = self._auth_headers(self._create_user())
        self.assertEqual(self.client.get(NOTIFICATIONS).status_code, 401)
        self.assertEqual(self.client.get(path, headers=other_headers).status_code, 404)
        self.assertEqual(self.client.patch(f"{path}/read", headers=other_headers).status_code, 404)
        self.assertIsNone(self._notifications()[0]["read_at"])

    def test_rejects_other_users_device_and_unknown_device(self):
        other_device = self._create_device(self._create_user())
        for device_id in (other_device, uuid4()):
            with self.subTest(device_id=device_id):
                response = self.client.get(NOTIFICATIONS, headers=self.headers, params={"device_id": str(device_id)})
                self.assertEqual(response.status_code, 404)

    def test_read_is_idempotent_and_unread_filter_does_not_change_total(self):
        first_id = self._save()
        second_version = self._create_version(self.folder_id, "후속 기록.md")
        second_id = self._save(source_document_version_id=second_version)
        path = f"{NOTIFICATIONS}/{first_id}/read"

        first = self.client.patch(path, headers=self.headers)
        second = self.client.patch(path, headers=self.headers)
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(second.status_code, 200, second.text)
        self.assertEqual(first.json(), second.json())
        self.assertTrue(first.json()["is_read"])
        self.assertIsNotNone(first.json()["read_at"])
        data = self._list(unread_only=True)
        self.assertEqual((data["total_count"], data["unread_count"]), (2, 1))
        self.assertEqual([item["notification_id"] for item in data["notifications"]], [str(second_id)])

    def test_filters_notifications_and_counts_by_reporting_device(self):
        first_device = self._create_device(self.user_id)
        second_device = self._create_device(self.user_id)
        first_id = self._save(source_device_id=first_device)
        second_version = self._create_version(self.folder_id, "다른 PC 기록.md")
        self._save(source_document_version_id=second_version, source_device_id=second_device)
        no_device_version = self._create_version(self.folder_id, "기기를 모르는 기록.md")
        self._save(source_document_version_id=no_device_version)

        data = self._list(device_id=str(first_device))
        self.assertEqual((data["total_count"], data["unread_count"]), (1, 1))
        [item] = data["notifications"]
        self.assertEqual((item["notification_id"], item["source_device_id"]), (str(first_id), str(first_device)))
        self.assertEqual(self._list()["total_count"], 3)

    def test_pagination_uses_created_at_and_id_tiebreaker(self):
        first = self._save()
        second = self._save(source_document_version_id=self._create_version(self.folder_id, "같은 시각.md"))
        newest = self._save(source_document_version_id=self._create_version(self.folder_id, "가장 최근 문서.md"))
        self.db.execute("""
            UPDATE notifications SET created_at = CURRENT_TIMESTAMP + INTERVAL '1 second'
            WHERE notification_id = %s
            """, (newest,))
        expected = [newest, *sorted((first, second), reverse=True)]
        for offset, expected_id in enumerate(expected):
            data = self._list(limit=1, offset=offset)
            self.assertEqual((data["total_count"], data["unread_count"]), (3, 3))
            self.assertEqual([item["notification_id"] for item in data["notifications"]], [str(expected_id)])
        empty_page = self._list(limit=1, offset=3)
        self.assertEqual(empty_page["notifications"], [])
        self.assertEqual(empty_page["total_count"], 3)

    def test_hides_notification_when_all_related_documents_are_removed(self):
        notification_id = self._save()
        self.db.execute("DELETE FROM document_versions WHERE document_version_id = %s", (self.related_version,))

        data = self._list()
        self.assertEqual((data["notifications"], data["total_count"], data["unread_count"]), ([], 0, 0))
        path = f"{NOTIFICATIONS}/{notification_id}"
        self.assertEqual(self.client.get(path, headers=self.headers).status_code, 404)
        self.assertEqual(self.client.patch(f"{path}/read", headers=self.headers).status_code, 404)
        self.assertIsNone(self._notifications()[0]["read_at"])
