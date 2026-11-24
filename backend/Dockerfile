FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# 코드가 backend.app 패키지로 import되므로 /srv/backend 아래에 둔다.
WORKDIR /srv

COPY requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt

COPY app backend/app

RUN useradd --system --uid 10001 --no-create-home appuser
USER appuser

EXPOSE 8000

# 인증 콜백 URL의 코드가 로그에 남지 않도록 요청 로그를 끈다.
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
