import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

logger = logging.getLogger("tardmart")

from app.database import engine, Base
import app.models.sale_payment  # noqa: F401 — registers SalePayment with Base.metadata
import app.models.expense       # noqa: F401 — registers Expense with Base.metadata


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Idempotent column additions for schema evolution
        for stmt in [
            "ALTER TABLE po_line_items ADD COLUMN IF NOT EXISTS brand VARCHAR(100)",
            "ALTER TABLE po_line_items ADD COLUMN IF NOT EXISTS model_name_str VARCHAR(100)",
            "ALTER TABLE po_line_items ADD COLUMN IF NOT EXISTS storage_str VARCHAR(50)",
            "ALTER TABLE po_line_items ADD COLUMN IF NOT EXISTS colour_str VARCHAR(50)",
            "ALTER TABLE sales ADD COLUMN IF NOT EXISTS salesperson_name VARCHAR(200)",
            "ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50)",
            "ALTER TABLE sales ADD COLUMN IF NOT EXISTS sales_channel VARCHAR(50)",
            "ALTER TABLE sales ADD COLUMN IF NOT EXISTS discount NUMERIC(12,2) NOT NULL DEFAULT 0",
            "ALTER TABLE sales ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 0",
            "ALTER TABLE po_line_items ADD COLUMN IF NOT EXISTS initial_status VARCHAR(30)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS allowed_modules TEXT",
        ]:
            await conn.execute(text(stmt))
    yield


app = FastAPI(
    title="Tardmart Refurb & Resale",
    version="1.0.0",
    lifespan=lifespan,
)

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    body = None
    try:
        body = await request.json()
    except Exception:
        pass
    logger.error("422 Validation error on %s %s | body=%s | errors=%s", request.method, request.url.path, body, exc.errors())
    return JSONResponse(status_code=422, content={"detail": exc.errors()})


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── routers ──────────────────────────────────────────────────────────────────
from app.routers import (
    auth, devices, parts, purchase_orders,
    refurb_jobs, sales, customers, suppliers, users, returns, reports, phone_models, expenses,
)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(devices.router, prefix="/api/devices", tags=["devices"])
app.include_router(parts.router, prefix="/api/parts", tags=["parts"])
app.include_router(purchase_orders.router, prefix="/api/purchase-orders", tags=["purchase-orders"])
app.include_router(refurb_jobs.router, prefix="/api/refurb-jobs", tags=["refurb-jobs"])
app.include_router(sales.router, prefix="/api/sales", tags=["sales"])
app.include_router(customers.router, prefix="/api/customers", tags=["customers"])
app.include_router(suppliers.router, prefix="/api/suppliers", tags=["suppliers"])
app.include_router(users.router, prefix="/api/users", tags=["users"])
app.include_router(returns.router, prefix="/api/returns", tags=["returns"])
app.include_router(reports.router, prefix="/api/reports", tags=["reports"])
app.include_router(phone_models.router, prefix="/api/phone-models", tags=["phone-models"])
app.include_router(expenses.router, prefix="/api/expenses", tags=["expenses"])


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "tardmart-api"}
