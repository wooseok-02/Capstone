from pathlib import Path
from typing import BinaryIO

from langchain_unstructured import UnstructuredLoader

# 파일을 가져와서 Document로 변환
def load_file(file: BinaryIO, file_name: str):
    loader = UnstructuredLoader(
        file=file,
        metadata_filename=file_name,
        partition_via_api=False,
    )
    return loader.load()



# 로드 확인용 경로
FILE_PATH = Path(__file__).resolve().parents[2] / "test" / "sample.md"

# 실제 로드 됐는지 확인
if __name__ == "__main__":
    from time import perf_counter

    path = FILE_PATH

    with path.open("rb") as file:
        load_start = perf_counter()
        documents = load_file(file, path.name)
        load_elapsed = perf_counter() - load_start

    print(f"로드 소요 시간: {load_elapsed:.6f}초")
    print(f"로드 결과: Document {len(documents)}개")
    for index, document in enumerate(documents, start=1):
        print(f"\n--- Document {index} ---")
        print("메타데이터:", document.metadata)
        print("본문:")
        print(document.page_content)
