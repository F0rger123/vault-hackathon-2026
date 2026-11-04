"""HTTP API v1: download the fictional demo datasets as ZIPs (F12.16). Built by VAULT itself; no cloud."""

import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from backend.api.deps import get_conn, get_settings, require
from backend.core.config import Settings
from backend.security import audit
from backend.security.auth import Principal
from backend.workers import demo_dataset

router = APIRouter(prefix="/api/v1")
log = logging.getLogger(__name__)


@router.get("/demo/dataset/{kind}.zip")
def download_demo_dataset(
    kind: Literal["quick", "complete"],
    conn=Depends(get_conn),
    settings: Settings = Depends(get_settings),
    p: Principal = Depends(require("documents:read")),
):
    """The Quick or Complete demo dataset. The first Complete request generates the test set (about 30 s)."""
    target = f"demo-dataset:{kind}"
    action = "demo_dataset.download"
    try:
        built = demo_dataset.build(kind, settings.data_dir)
    except demo_dataset.DatasetUnavailable as exc:
        audit.record(conn, p.username, action, "error", target=target, detail={"reason": "unavailable"})
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # never show paths or internals to the client
        log.exception("demo dataset build failed")
        audit.record(conn, p.username, action, "error", target=target, detail={"reason": "error"})
        raise HTTPException(status_code=500, detail="the demo dataset could not be built; see the server log") from exc
    detail = {"files": built.files, "bytes": built.size, "sha256": built.sha256[:16], "excluded": len(built.excluded)}
    audit.record(conn, p.username, action, "allowed", target=target, detail=detail)
    return FileResponse(
        built.path,
        media_type="application/zip",
        filename=built.filename,
        headers={
            "X-Content-Type-Options": "nosniff",
            "X-Dataset-Files": str(built.files),
            "ETag": f'"{built.sha256[:32]}"',
        },
    )
