from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

# 입력 : 로드(Document)파일, 청크 사이즈, 오버랩
def chunk_documents(
    documents: list[Document], chunk_size: int, chunk_overlap: int
) -> list[Document]:
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
    )
    return splitter.split_documents(documents)


# 로드된게 제대로 청킹으로 이어지는 지 확인
if __name__ == "__main__":
    from time import perf_counter


    if __package__:
        from .file_loader import FILE_PATH, load_file
    else:
        from file_loader import FILE_PATH, load_file

    # 테스트용 인수값
    path = FILE_PATH
    chunk_size = 100
    chunk_overlap = 50

    with path.open("rb") as file:
        load_start = perf_counter()
        documents = load_file(file, path.name)
        load_elapsed = perf_counter() - load_start

    chunk_start = perf_counter()
    chunks = chunk_documents(documents, chunk_size, chunk_overlap)
    chunk_elapsed = perf_counter() - chunk_start

    print(f"로드 소요 시간: {load_elapsed:.6f}초")
    print(f"청킹 소요 시간: {chunk_elapsed:.6f}초")
    print(f"로드 결과: Document {len(documents)}개")
    print(f"청킹 결과: 청크 {len(chunks)}개")
    for index, chunk in enumerate(chunks, start=1):
        print(f"\n--- 청크 {index} / {len(chunk.page_content)}글자 ---")
        print("메타데이터:", chunk.metadata)
        print("본문:")
        print(chunk.page_content)
