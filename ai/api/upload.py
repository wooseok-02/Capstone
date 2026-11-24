import logging
import shutil
from tempfile import SpooledTemporaryFile
from urllib.request import urlopen

from fastapi import FastAPI

from schema import (
    EmbeddingChunk,
    EmbeddingFailedResponse,
    EmbeddingRequest,
    EmbeddingResponse,
    EmbeddingSuccessResponse,
)
from service.load.file_loader import load_file
from service.load.file_chunker import chunk_documents
from service.load.embedding import MODEL_NAME, embed_documents

app = FastAPI()
logger = logging.getLogger(__name__)


@app.post("/upload", response_model=EmbeddingResponse)
def receive_folder_file(request: EmbeddingRequest) -> EmbeddingResponse:
    stage = "download"
    try:
        with SpooledTemporaryFile(max_size=8 * 1024 * 1024) as file:
            with urlopen(str(request.download_url), timeout=30) as source:
                shutil.copyfileobj(source, file)
            file.seek(0)

            stage = "load"
            documents = load_file(file, request.file_name)

        stage = "chunk"
        chunks = chunk_documents(documents, chunk_size=100, chunk_overlap=50)
        if not chunks:
            raise ValueError("No chunks were produced")

        stage = "embed"
        vectors = embed_documents(chunks)
        if len(vectors) != len(chunks) or not vectors:
            raise ValueError("Chunk and embedding counts do not match")
        dimension = len(vectors[0])
        if not dimension or any(len(vector) != dimension for vector in vectors):
            raise ValueError("Embedding dimensions do not match")

        stage = "response"
        return EmbeddingSuccessResponse(
            document_version_id=request.document_version_id,
            embedding_model=MODEL_NAME,
            embedding_dim=dimension,
            chunks=[
                EmbeddingChunk(
                    chunk_index=index,
                    chunk_text=chunk.page_content,
                    embedding=vector,
                )
                for index, (chunk, vector) in enumerate(zip(chunks, vectors))
            ],
        )
    except Exception:
        logger.exception(
            "Embedding request failed at %s for document_version_id=%s",
            stage,
            request.document_version_id,
        )
        return EmbeddingFailedResponse(document_version_id=request.document_version_id)
