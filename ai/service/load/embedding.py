from langchain_core.documents import Document
from langchain_huggingface import HuggingFaceEmbeddings

MODEL_NAME = "sentence-transformers/paraphrase-MiniLM-L3-v2"


def load_embedding_model() -> HuggingFaceEmbeddings:
    return HuggingFaceEmbeddings(
        model_name=MODEL_NAME,
        model_kwargs={"device": "cpu"},
    )


def embed_documents(
    documents: list[Document], model: HuggingFaceEmbeddings | None = None
) -> list[list[float]]:
    if model is None:
        model = load_embedding_model()
    texts = [document.page_content for document in documents]
    return model.embed_documents(texts)


# 고정 파일로 로드 → 청킹 → 임베딩 결과 확인
if __name__ == "__main__":
    from time import perf_counter

    import math

    if __package__:
        from .file_loader import FILE_PATH, load_file
        from .file_chunker import chunk_documents
    else:
        from file_loader import FILE_PATH, load_file
        from file_chunker import chunk_documents

    with FILE_PATH.open("rb") as file:
        load_start = perf_counter()
        documents = load_file(file, FILE_PATH.name)
        load_elapsed = perf_counter() - load_start

    chunk_start = perf_counter()
    chunks = chunk_documents(documents, chunk_size=100, chunk_overlap=50)
    chunk_elapsed = perf_counter() - chunk_start
    model_start = perf_counter()
    model = load_embedding_model()
    model_elapsed = perf_counter() - model_start

    embedding_start = perf_counter()
    vectors = embed_documents(chunks, model=model)
    embedding_elapsed = perf_counter() - embedding_start

    assert len(vectors) == len(chunks)
    assert all(len(vector) == 384 for vector in vectors)
    assert all(math.isfinite(value) for vector in vectors for value in vector)

    print(f"로드 소요 시간: {load_elapsed:.6f}초")
    print(f"청킹 소요 시간: {chunk_elapsed:.6f}초")
    print(f"모델 로딩 소요 시간: {model_elapsed:.6f}초")
    print(f"실제 임베딩 소요 시간: {embedding_elapsed:.6f}초")
    print("임베딩 인터페이스: LangChain HuggingFaceEmbeddings")
    print(f"모델: {MODEL_NAME}")
    print(f"청크 {len(chunks)}개 → 벡터 {len(vectors)}개")
