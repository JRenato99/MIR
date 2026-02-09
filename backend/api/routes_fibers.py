from fastapi import APIRouter, HTTPException
from core.db import fetch_all

router = APIRouter(prefix="/fibers", tags=["fibers"])


@router.get("/{fiber_id}/trace")
def trace_fiber(fiber_id: str):
    try:
        rows = fetch_all(
            "EXEC dbo.sp_trace_filament @start_fiber_id=:fid", fid=fiber_id
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB_ERROR_TRACE: {e}")

    if not rows:
        return {"fiber_id": fiber_id, "hops": []}

    return {"fiber_id": fiber_id, "hops": rows}


# Trazado desde puerto ODF
@router.get("/odf-ports/{port_id}/trace")
def trace_from_odf_port(port_id: str):
    # Busca el fiber_id asociado
    rows = fetch_all(
        """
        SELECT fiber_filament_id
        FROM dbo.odf_port_fiber
        WHERE odf_port_id = :pid
    """,
        pid=port_id,
    )
    if not rows:
        raise HTTPException(404, f"NO_FIBER_FOR_PORT {port_id}")
    fiber_id = rows[0]["fiber_filament_id"]
    return trace_fiber(fiber_id)


@router.get("/{fiber_id}/endpoints")
def fiber_endpoints(fiber_id: str):
    rows = fetch_all(
        """
        SELECT opf.odf_port_id, opf.fiber_filament_id, o.id AS odf_id, o.name AS odf_name, o.code AS odf_code, op.port_no
        FROM dbo.odf_port_fiber opf
        JOIN dbo.odf_port op ON op.id = opf.odf_port_id
        JOIN dbo.odf o       ON o.id  = op.odf_id
        WHERE opf.fiber_filament_id = :fid
    """,
        fid=fiber_id,
    )
    return {"fiber_id": fiber_id, "endpoints": rows}
