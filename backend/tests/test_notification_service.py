import os
import unittest
from uuid import uuid4

import psycopg
from fastapi import HTTPException
from psycopg.rows import dict_row

from backend.app.models.notification import NotificationCreate, RelatedDocumentResult
from backend.app.services.notification_service import create_notification


class NotificationDatabaseFixture(unittest.TestCase):
    def setUp(self):
        test_database_url = os.getenv("NOTIFICATION_TEST_DATABASE_URL")
        if not test_database_url:
            self.skipTest("별도 테스트 DB의 NOTIFICATION_TEST_DATABASE_URL을 설정하세요.")
        self.db = self.enterContext(psycopg.connect(test_database_url, row_factory=dict_row, connect_timeout=5))
        self.enterContext(self.db.transaction(force_rollback=True))
        self.user_id = self._create_user()
        self.folder_id = self._create_folder(self.user_id)
        self.source_version = self._create_version(self.folder_id, "운영체제 정리.md")
        self.related_version = self._create_version(self.folder_id, "스케줄링 과제.md")

    def _create_user(self):
        return self.db.execute("""
            INSERT INTO users (provider, provider_user_id) VALUES ('GOOGLE', %s) RETURNING id
            """, (str(uuid4()),)).fetchone()["id"]

    def _create_folder(self, user_id):
        return self.db.execute("""
            INSERT INTO folders (user_id, folder_name) VALUES (%s, '알림 테스트') RETURNING folder_id
            """, (user_id,)).fetchone()["folder_id"]

    def _create_version(self, folder_id, name, version_no=1):
        document_id = self.db.execute("""
            INSERT INTO documents (folder_id, relative_path, file_name)
            VALUES (%s, %s, %s) RETURNING document_id
            """, (folder_id, name, name)).fetchone()["document_id"]
        return self.db.execute("""
            INSERT INTO document_versions (document_id, version_no, object_key, file_size, sha256, mime_type, status)
            VALUES (%s, %s, %s, 100, %s, 'text/markdown', 'ready') RETURNING document_version_id
            """, (document_id, version_no, f"test/{document_id}", "a" * 64)).fetchone()["document_version_id"]

    def _create_device(self, user_id):
        return self.db.execute("""
            INSERT INTO devices (user_id, device_name) VALUES (%s, '테스트 PC') RETURNING device_id
            """, (user_id,)).fetchone()["device_id"]

    def _sample_result(self, **overrides):
        body = {
            "source_document_version_id": self.source_version,
            "related_documents": [RelatedDocumentResult(
                related_document_version_id=self.related_version,
                connection_reason="두 문서 모두 라운드 로빈을 설명합니다.",
                source_excerpt="타임 퀀텀",
                related_excerpt="시간 할당량",
            )],
        }
        return NotificationCreate(**(body | overrides))

    def _notifications(self):
        return self.db.execute("SELECT * FROM notifications WHERE user_id = %s", (self.user_id,)).fetchall()

    def _items(self, notification_id):
        return self.db.execute(
            "SELECT * FROM notification_items WHERE notification_id = %s", (notification_id,),
        ).fetchall()


class NotificationServiceTest(NotificationDatabaseFixture):
    def test_saves_notification_with_multiple_related_documents_and_reporting_device(self):
        device_id = self._create_device(self.user_id)
        another_version = self._create_version(self.folder_id, "시험 노트.md")
        first_item = self._sample_result().related_documents[0]
        body = self._sample_result(source_device_id=device_id, related_documents=[first_item, RelatedDocumentResult(
            related_document_version_id=another_version, connection_reason="문맥 교환을 다룹니다.",
        )])

        notification_id = create_notification(self.db, self.user_id, body)

        [stored] = self._notifications()
        self.assertEqual(stored["notification_id"], notification_id)
        self.assertEqual(stored["source_document_version_id"], self.source_version)
        self.assertEqual(stored["source_device_id"], device_id)
        self.assertIn("운영체제 정리.md", stored["message"])
        self.assertIsNone(stored["read_at"])
        self.assertIsNotNone(stored["created_at"])
        items = {row["related_document_version_id"]: row for row in self._items(notification_id)}
        self.assertEqual(set(items), {self.related_version, another_version})
        self.assertEqual(items[self.related_version]["connection_reason"], first_item.connection_reason)
        self.assertEqual(items[self.related_version]["source_excerpt"], first_item.source_excerpt)
        self.assertEqual(items[self.related_version]["related_excerpt"], first_item.related_excerpt)

    def test_does_not_save_empty_results(self):
        self.assertIsNone(create_notification(self.db, self.user_id, self._sample_result(related_documents=[])))
        self.assertEqual(self._notifications(), [])

    def test_repeated_items_and_results_keep_the_original_notification(self):
        first_item = self._sample_result().related_documents[0]
        body = self._sample_result(related_documents=[first_item, first_item])
        notification_id = create_notification(self.db, self.user_id, body)
        self.db.execute("UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE notification_id = %s",
                        (notification_id,))

        self.assertIsNone(create_notification(self.db, self.user_id, body))
        [stored] = self._notifications()
        self.assertEqual(stored["notification_id"], notification_id)
        self.assertIsNotNone(stored["read_at"])
        self.assertIsNone(stored["source_device_id"])
        self.assertEqual(len(self._items(notification_id)), 1)

    def test_rejects_missing_and_other_users_document_versions(self):
        other_user_version = self._create_version(self._create_folder(self._create_user()), "다른 회원 문서.md")
        for version in (uuid4(), other_user_version):
            for body in (
                self._sample_result(source_document_version_id=version),
                self._sample_result(related_documents=[RelatedDocumentResult(
                    related_document_version_id=version, connection_reason="연결 이유",
                )]),
            ):
                with self.subTest(version=version, source=body.source_document_version_id):
                    with self.assertRaises(HTTPException) as error:
                        create_notification(self.db, self.user_id, body)
                    self.assertEqual(error.exception.status_code, 404)
        self.assertEqual(self._notifications(), [])

    def test_rejects_another_users_device(self):
        device_id = self._create_device(self._create_user())
        with self.assertRaises(HTTPException) as error:
            create_notification(self.db, self.user_id, self._sample_result(source_device_id=device_id))
        self.assertEqual(error.exception.status_code, 404)
        self.assertEqual(self._notifications(), [])

    def test_rolls_back_notification_and_earlier_item_if_later_item_fails(self):
        self.db.execute("""
            ALTER TABLE notification_items ADD CONSTRAINT test_reject_reason
                CHECK (connection_reason <> '테스트 실패') NOT VALID
            """)
        another_version = self._create_version(self.folder_id, "시험 노트.md")
        body = self._sample_result(related_documents=[
            self._sample_result().related_documents[0],
            RelatedDocumentResult(related_document_version_id=another_version, connection_reason="테스트 실패"),
        ])

        with self.assertRaises(psycopg.errors.CheckViolation):
            create_notification(self.db, self.user_id, body)

        self.assertEqual(self._notifications(), [])
        notification_id = create_notification(self.db, self.user_id, self._sample_result())
        [stored] = self._notifications()
        self.assertEqual(stored["notification_id"], notification_id)
        self.assertEqual(len(self._items(notification_id)), 1)

    def test_document_foreign_keys_remove_the_expected_rows(self):
        another_version = self._create_version(self.folder_id, "시험 노트.md")
        body = self._sample_result(related_documents=[
            self._sample_result().related_documents[0],
            RelatedDocumentResult(related_document_version_id=another_version, connection_reason="연결 이유"),
        ])
        notification_id = create_notification(self.db, self.user_id, body)

        self.db.execute("""
            DELETE FROM documents WHERE document_id = (
                SELECT document_id FROM document_versions WHERE document_version_id = %s
            )
            """, (self.related_version,))
        self.assertEqual(len(self._notifications()), 1)
        [remaining] = self._items(notification_id)
        self.assertEqual(remaining["related_document_version_id"], another_version)

        self.db.execute("""
            DELETE FROM documents WHERE document_id = (
                SELECT document_id FROM document_versions WHERE document_version_id = %s
            )
            """, (self.source_version,))
        self.assertEqual(self._notifications(), [])
        self.assertEqual(self._items(notification_id), [])
