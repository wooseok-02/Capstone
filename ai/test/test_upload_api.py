from io import BytesIO

from fastapi.testclient import TestClient
from langchain_core.documents import Document

from api.upload import app


REQUEST = {
    "document_version_id": "version-1",
    "file_name": "sample.md",
    "mime_type": "text/markdown",
    "download_url": "https://example.com/signed-file",
    "expires_in": 600,
}


def test_upload_returns_chunks_and_embeddings(monkeypatch):
    import api.upload as upload

    monkeypatch.setattr(upload, "urlopen", lambda url, timeout: BytesIO(b"sample content"), raising=False)
    monkeypatch.setattr(upload, "load_file", lambda file, name: [Document(page_content="sample content")])
    monkeypatch.setattr(upload, "chunk_documents", lambda documents, chunk_size, chunk_overlap: [Document(page_content="sample")])
    monkeypatch.setattr(upload, "embed_documents", lambda chunks: [[0.1, -0.2]])

    response = TestClient(app).post("/upload", json=REQUEST)

    assert response.status_code == 200
    assert response.json() == {
        "document_version_id": "version-1",
        "status": "success",
        "embedding_model": upload.MODEL_NAME,
        "embedding_dim": 2,
        "chunks": [{"chunk_index": 0, "chunk_text": "sample", "embedding": [0.1, -0.2]}],
    }


def test_upload_logs_download_failure_and_returns_failed(monkeypatch, caplog):
    import api.upload as upload

    def fail_download(url, timeout):
        raise OSError("download failed")

    monkeypatch.setattr(upload, "urlopen", fail_download, raising=False)

    response = TestClient(app).post("/upload", json=REQUEST)

    assert response.status_code == 200
    assert response.json() == {"document_version_id": "version-1", "status": "failed"}
    assert "download" in caplog.text
