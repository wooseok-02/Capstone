import math
from time import perf_counter

import pytest
from langchain_core.documents import Document

from service.load.file_loader import FILE_PATH, load_file
from service.load.file_chunker import chunk_documents
from service.load.embedding import embed_documents, load_embedding_model


def test_fixed_file_pipeline(capfd: pytest.CaptureFixture[str]) -> None:
    input_files = [FILE_PATH]
    file_count = len(input_files)
    total_size = sum(path.stat().st_size for path in input_files)

    with FILE_PATH.open("rb") as file:
        start = perf_counter()
        documents = load_file(file, FILE_PATH.name)
        load_elapsed = perf_counter() - start

    assert documents
    assert all(isinstance(document, Document) for document in documents)
    assert all(document.page_content.strip() for document in documents)
    assert all(document.metadata["filename"] == FILE_PATH.name for document in documents)
    # 원본의 각 문단이 추출 결과에 포함되는지 확인한다.
    original = FILE_PATH.read_text(encoding="utf-8")
    extracted = " ".join(" ".join(document.page_content.split()) for document in documents)
    for paragraph in original.split("\n\n"):
        expected = " ".join(paragraph.strip().lstrip("# ").split())
        if expected:
            assert expected in extracted

    start = perf_counter()
    chunks = chunk_documents(documents, chunk_size=100, chunk_overlap=50)
    chunk_elapsed = perf_counter() - start

    assert chunks
    assert all(0 < len(chunk.page_content) <= 100 for chunk in chunks)
    assert all(chunk.metadata["filename"] == FILE_PATH.name for chunk in chunks)

    start = perf_counter()
    model = load_embedding_model()
    model_elapsed = perf_counter() - start

    start = perf_counter()
    vectors = embed_documents(chunks, model=model)
    embedding_elapsed = perf_counter() - start

    assert len(vectors) == len(chunks)
    assert all(len(vector) == 384 for vector in vectors)
    assert all(math.isfinite(value) for vector in vectors for value in vector)
    assert all(any(value != 0 for value in vector) for vector in vectors)

    # 라이브러리 로그와 진행률은 숨기고 요청한 요약만 출력한다.
    capfd.readouterr()
    with capfd.disabled():
        print('=====================')
        print(f"파일 개수: {file_count}개")
        print(f"파일 총용량: {total_size:,} bytes ({total_size / 1024:.2f} KiB)")
        print(f"로드 소요 시간: {load_elapsed:.6f}초")
        print(f"청킹 소요 시간: {chunk_elapsed:.6f}초")
        print(f"모델 로딩 소요 시간: {model_elapsed:.6f}초")
        print(f"실제 임베딩 소요 시간: {embedding_elapsed:.6f}초")
        print(f"청크 {len(chunks)}개 → 벡터 {len(vectors)}개")
        print('=====================')
