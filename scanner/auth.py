from __future__ import annotations

import os
from typing import Any

import jwt
from fastapi import Header, HTTPException, status
from jwt import PyJWKClient

GOOGLE_SECURETOKEN_JWK_URL = (
    "https://www.googleapis.com/service_accounts/v1/jwk/"
    "securetoken@system.gserviceaccount.com"
)

_jwk_client: PyJWKClient | None = None


def _get_jwk_client() -> PyJWKClient:
    global _jwk_client
    if _jwk_client is None:
        _jwk_client = PyJWKClient(
            GOOGLE_SECURETOKEN_JWK_URL,
            cache_keys=True,
            lifespan=3600,
            timeout=5,
        )
    return _jwk_client


def _is_dev_unauth_allowed(firebase_project_id: str) -> bool:
    raw = os.getenv("ALLOW_DEV_UNAUTH")
    if raw is None or raw.strip() == "":
        return firebase_project_id == ""
    return raw.strip().lower() in {"1", "true", "yes"}


def verify_firebase_token(token: str, firebase_project_id: str) -> dict[str, Any]:
    if not firebase_project_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="FIREBASE_PROJECT_ID is not configured.",
        )

    try:
        signing_key = _get_jwk_client().get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=firebase_project_id,
            issuer=f"https://securetoken.google.com/{firebase_project_id}",
            options={"require": ["exp", "iat", "aud", "iss", "sub"]},
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid Firebase ID token: {exc}",
        ) from exc

    sub = claims.get("sub")
    if not isinstance(sub, str) or not sub.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Firebase ID token subject.",
        )

    return claims


async def require_auth(
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Verify Firebase RS256 Bearer token when configured, or allow local dev."""
    firebase_project_id = os.getenv("FIREBASE_PROJECT_ID", "").strip()
    allow_dev_unauth = _is_dev_unauth_allowed(firebase_project_id)

    token: str | None = None
    if authorization:
        scheme, _, credentials = authorization.partition(" ")
        if scheme.lower() == "bearer" and credentials.strip():
            token = credentials.strip()
        elif not allow_dev_unauth:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authorization header must use Bearer scheme.",
            )

    if token and firebase_project_id:
        return verify_firebase_token(token, firebase_project_id)

    if allow_dev_unauth:
        return {"sub": "dev-local", "dev": True}

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Missing Authorization Bearer token.",
    )
