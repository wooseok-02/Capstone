import modal

# CPU 앱과 같은 문서 처리 환경에 CUDA를 지원하는 PyTorch를 설치한다.
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
    .pip_install("torch", "torchvision")
    .pip_install(
        "fastapi==0.165.0",
        "python-multipart==0.0.34",
        "langchain-unstructured==1.0.1",
        "unstructured[all-docs]==0.18.32",
        "langchain-text-splitters==1.1.3",
        "langchain-huggingface==1.2.3",
        "sentence-transformers==6.3.0",
    )
    .run_commands(
        "python -c 'import torch; import torchvision; "
        "from sentence_transformers import SentenceTransformer'"
    )
    .env({"NLTK_DATA": "/opt/nltk_data", "EMBEDDING_DEVICE": "cuda"})
    .run_commands(
        "python -m nltk.downloader -d /opt/nltk_data "
        "punkt_tab averaged_perceptron_tagger_eng"
    )
    .add_local_python_source("api", "service", "schema")
)

app = modal.App("capstone-ai-gpu")


@app.function(
    image=image,
    gpu="T4",
    cpu=2.0,
    memory=4096,
    timeout=600,
    min_containers=0,
    max_containers=1,
    scaledown_window=60,
)
@modal.asgi_app()
def fastapi_app():
    import torch

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable in the GPU container")

    from api.upload import app as web_app

    return web_app
