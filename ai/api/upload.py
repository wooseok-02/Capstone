from typing import Annotated

from fastapi import FastAPI, File, Form, UploadFile

from service.load.file_loader import load_file
from service.load.file_chunker import chunk_documents
from service.load.embedding import embed_documents

app = FastAPI()

# 폴더 이름과 파일을 입력 받는다.
@app.post("/upload")
def receive_folder_file(folder_name: Annotated[str, Form()], file: Annotated[UploadFile, File()]) :
    documents = load_file(file.file, file.filename)
    chunks = chunk_documents(documents, chunk_size=100, chunk_overlap=50)
    vectors = embed_documents(chunks)

    return {
        "folder_name": folder_name,
        "file_name": file.filename,
    }
