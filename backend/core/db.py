from sqlalchemy import create_engine, text
from urllib.parse import quote_plus
from .config import settings

# Windows Authentication (Trusted_Connection) SQL Server
ODBC_STR = (
    "DRIVER={ODBC Driver 17 for SQL Server};"
    f"SERVER={settings.DB_SERVER};"
    f"DATABASE={settings.DB_NAME};"
    "Trusted_Connection=yes;"
    "TrustServerCertificate=yes;"
)

_engine = None


def get_engine():
    global _engine
    if _engine is not None:
        return _engine
    try:
        _engine = create_engine(
            f"mssql+pyodbc:///?odbc_connect={quote_plus(ODBC_STR)}",
            pool_pre_ping=True,
        )
        return _engine
    except Exception as e:
        raise RuntimeError(
            "No se pudo crear el engine de SQL Server. Verifica:\n"
            f"- DRIVER 18 instalado (x64)\n"
            f"- SERVER={settings.DB_SERVER} / DB={settings.DB_NAME}\n"
            "- Usuario Windows con acceso (Trusted_Connection)\n"
            f"Detalle: {e!r}"
        ) from e


def fetch_all(sql: str, **params):  # Querys que si devuelven Data
    with get_engine().connect() as conn:
        return [dict(r) for r in conn.execute(text(sql), params).mappings()]


def execute(sql: str, **params):  # Querys que no devuelven Data
    with get_engine().begin() as conn:
        conn.execute(text(sql), params)
