"""Cloudflare R2(S3 호환) 서명 URL 발급과 객체 확인.

서명 URL은 응답으로만 돌려주고 DB나 로그에 남기지 않는다.
"""
from functools import lru_cache

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from fastapi import HTTPException

from ..config import Settings


def storage_configured(settings: Settings) -> bool:
    return all((settings.r2_endpoint_url, settings.r2_access_key_id, settings.r2_secret_access_key, settings.r2_bucket))


def require_storage(settings: Settings) -> None:
    if not storage_configured(settings):
        raise HTTPException(503, "파일 저장소가 설정되지 않았습니다.")


@lru_cache
def _client(endpoint_url: str, access_key_id: str, secret_access_key: str, region: str):
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key,
        region_name=region,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}, retries={"max_attempts": 3}),
    )


def client(settings: Settings):
    return _client(settings.r2_endpoint_url, settings.r2_access_key_id, settings.r2_secret_access_key, settings.r2_region)


def presign_put(settings: Settings, object_key: str, content_type: str) -> str:
    # Content-Type이 서명에 포함되므로 앱은 응답의 upload_headers를 그대로 보내야 한다.
    return client(settings).generate_presigned_url(
        "put_object",
        Params={"Bucket": settings.r2_bucket, "Key": object_key, "ContentType": content_type},
        ExpiresIn=settings.upload_url_expires,
    )


def presign_get(settings: Settings, object_key: str, expires_in: int) -> str:
    return client(settings).generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.r2_bucket, "Key": object_key},
        ExpiresIn=expires_in,
    )


def object_size(settings: Settings, object_key: str) -> int | None:
    """객체 크기를 돌려준다. 객체가 없으면 None이다."""
    try:
        head = client(settings).head_object(Bucket=settings.r2_bucket, Key=object_key)
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") in {"404", "NoSuchKey", "NotFound"}:
            return None
        raise HTTPException(502, "파일 저장소에 연결하지 못했습니다.") from None
    return int(head["ContentLength"])
