import hmac
from typing import Optional
from fastapi import Header, HTTPException, Request, status
from config import settings


async def verify_internal_secret(
    request: Request,
    x_internal_secret: Optional[str] = Header(default=None, alias="x-internal-secret"),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
) -> bool:
    """Enforce internal shared-secret authentication on /api/v1/* orchestration routes."""
    expected = (settings.INTERNAL_API_SECRET or "").strip()
    if not expected:
        if settings.INTERNAL_API_AUTH_BYPASS and settings.ENV.lower() != "production":
            return True
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Internal API authentication secret is not configured.",
        )

    candidate = (x_internal_secret or "").strip()
    if not candidate and authorization:
        parts = authorization.split(" ", 1)
        if len(parts) == 2 and parts[0].lower() == "bearer":
            candidate = parts[1].strip()

    if not candidate or not hmac.compare_digest(candidate, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing internal API authentication secret.",
        )
    return True

