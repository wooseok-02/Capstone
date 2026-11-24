from service.load import embedding


def test_embedding_model_uses_configured_device(monkeypatch):
    arguments = {}

    def capture_model(**kwargs):
        arguments.update(kwargs)
        return object()

    monkeypatch.setenv("EMBEDDING_DEVICE", "cuda")
    monkeypatch.setattr(embedding, "HuggingFaceEmbeddings", capture_model)

    embedding.load_embedding_model()

    assert arguments["model_kwargs"]["device"] == "cuda"
