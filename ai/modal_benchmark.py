"""실제 API와 분리된 로컬·Modal 임베딩 모델 비교 테스트 전용 앱."""

import modal

from modal_app import image

app = modal.App("capstone-ai-benchmark")


@app.function(
    image=image,
    cpu=2.0,
    memory=4096,
    timeout=600,
    min_containers=0,
    max_containers=1,
    scaledown_window=60,
)
def benchmark_file(
    file_bytes: bytes, file_name: str, chunk_size: int, chunk_overlap: int
) -> dict:
    import math
    from io import BytesIO
    from time import perf_counter

    from service.load.file_loader import load_file
    from service.load.file_chunker import chunk_documents
    from service.load.embedding import MODEL_NAME, embed_documents, load_embedding_model

    with BytesIO(file_bytes) as file:
        start = perf_counter()
        documents = load_file(file, file_name)
        load_elapsed = perf_counter() - start

    assert documents
    assert all(document.page_content.strip() for document in documents)
    assert all(document.metadata["filename"] == file_name for document in documents)

    start = perf_counter()
    chunks = chunk_documents(documents, chunk_size, chunk_overlap)
    chunk_elapsed = perf_counter() - start

    assert chunks
    assert all(0 < len(chunk.page_content) <= chunk_size for chunk in chunks)

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

    return {
        "file_count": 1,
        "total_size": len(file_bytes),
        "model_name": MODEL_NAME,
        "chunk_size": chunk_size,
        "chunk_overlap": chunk_overlap,
        "chunk_count": len(chunks),
        "vector_count": len(vectors),
        "timings": {
            "load": load_elapsed,
            "chunk": chunk_elapsed,
            "model_load": model_elapsed,
            "embedding": embedding_elapsed,
        },
    }
