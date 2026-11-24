.PHONY: test-local

test-local:
	python -m pytest -q --disable-warnings test/test_embedding_pipeline.py

.PHONY: test-compare

test-compare:
	python -m pytest -q --disable-warnings test/test_embedding_pipeline.py --compare-modal
