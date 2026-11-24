import modal

# Modal 서버에서 사용할 Python 및 문서 처리 환경
image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install(
        "libmagic1",
        "poppler-utils",
        "tesseract-ocr",
        "tesseract-ocr-kor",
        "libreoffice",
        "pandoc",
        "libgl1",
        "libglib2.0-0",
    )
    # torch와 torchvision을 같은 CPU 휠 저장소에서 함께 설치한다.
    .pip_install("torch", "torchvision", index_url="https://download.pytorch.org/whl/cpu")
    .pip_install(
        "fastapi==0.165.0",
        "python-multipart==0.0.34",
        "langchain-unstructured==1.0.1",
        "unstructured[all-docs]==0.18.32",
        "langchain-text-splitters==1.1.3",
        "langchain-huggingface==1.2.3",
        "sentence-transformers==6.3.0",
    )
    # 라이브러리 조합에 문제가 있으면 API 요청 전에 이미지 빌드에서 확인한다.
    .run_commands(
        "python -c 'import torch; import torchvision; "
        "from sentence_transformers import SentenceTransformer'"
    )
    .env({"NLTK_DATA": "/opt/nltk_data"})
    .run_commands(
        "python -m nltk.downloader -d /opt/nltk_data "
        "punkt_tab averaged_perceptron_tagger_eng"
    )
    # ai 디렉터리에서 배포할 때 기존 두 패키지를 함께 포함한다.
    # 여기에서 로컬의 파일을 읽는다.
    .add_local_python_source("api", "service", "schema")
)

app = modal.App("capstone-ai")


# GPU는 사용하지 않는다. 유휴 시 컨테이너를 0개까지 줄인다.
@app.function(
    image=image,
    cpu=2.0,
    memory=4096,
    timeout=1200,
    min_containers=0,
    max_containers=1,
    scaledown_window=60,
)
@modal.asgi_app()
def fastapi_app():
    from api.upload import app as web_app

    return web_app
