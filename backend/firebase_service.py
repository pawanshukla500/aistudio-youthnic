import json
import logging
from typing import Optional, List
from google.oauth2 import service_account
from google.cloud import storage

from config import settings

logger = logging.getLogger(__name__)

_storage_client: Optional[storage.Client] = None


def get_storage_client() -> Optional[storage.Client]:
    global _storage_client
    if _storage_client is None:
        if settings.FIREBASE_SERVICE_ACCOUNT:
            try:
                sa_info = json.loads(settings.FIREBASE_SERVICE_ACCOUNT)
                creds = service_account.Credentials.from_service_account_info(sa_info)
                _storage_client = storage.Client(project=settings.FIREBASE_PROJECT_ID, credentials=creds)
            except Exception as e:
                logger.warning(f"Could not initialize Firebase storage client: {e}")
                return None
        else:
            # When service account is not provided (e.g. local dev / test), avoid blocking on metadata server
            return None
    return _storage_client


def get_bucket():
    client = get_storage_client()
    if client is None:
        class DummyBucket:
            name = settings.FIREBASE_STORAGE_BUCKET
            def blob(self, path):
                class DummyBlob:
                    name = path
                    def upload_from_string(self, *args, **kwargs): pass
                    def download_as_bytes(self): return b""
                    def generate_signed_url(self, *args, **kwargs): return f"https://mock/{path}"
                return DummyBlob()
            def list_blobs(self, *args, **kwargs): return []
        return DummyBucket()
    return client.bucket(settings.FIREBASE_STORAGE_BUCKET)


def upload_bytes(storage_path: str, data: bytes, content_type: str = "image/jpeg") -> str:
    bucket = get_bucket()
    blob = bucket.blob(storage_path)
    blob.upload_from_string(data, content_type=content_type)
    # Generate public or download URL
    return f"https://firebasestorage.googleapis.com/v0/b/{settings.FIREBASE_STORAGE_BUCKET}/o/{storage_path.replace('/', '%2F')}?alt=media"


def download_bytes(storage_path: str, max_bytes: int = 20 * 1024 * 1024) -> bytes:
    bucket = get_bucket()
    blob = bucket.blob(storage_path)
    blob.reload()
    if blob.size is not None and int(blob.size) > max_bytes:
        raise RuntimeError(f"Firebase object exceeds {max_bytes} byte limit")
    data = blob.download_as_bytes()
    if len(data) > max_bytes:
        raise RuntimeError(f"Firebase object exceeds {max_bytes} byte limit")
    return data


def generate_signed_url(storage_path: str, expiration_seconds: int = 604800) -> str:
    bucket = get_bucket()
    blob = bucket.blob(storage_path)
    try:
        return blob.generate_signed_url(expiration=expiration_seconds, method="GET")
    except Exception:
        # Fallback to standard token media URL
        return f"https://firebasestorage.googleapis.com/v0/b/{settings.FIREBASE_STORAGE_BUCKET}/o/{storage_path.replace('/', '%2F')}?alt=media"


def list_objects(prefix: str, max_results: int = 50) -> List[str]:
    client = get_storage_client()
    blobs = client.list_blobs(settings.FIREBASE_STORAGE_BUCKET, prefix=prefix, max_results=max_results)
    return [b.name for b in blobs]
