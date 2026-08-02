import logging
import logging.config
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.config import settings

logging.config.dictConfig({
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "default": {
            "format": "%(asctime)s %(levelname)s %(name)s %(message)s",
            "datefmt": "%Y-%m-%dT%H:%M:%S",
        }
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "default",
        }
    },
    "root": {"handlers": ["console"], "level": settings.LOG_LEVEL},
    "loggers": {
        "uvicorn": {"propagate": True},
        "uvicorn.access": {"propagate": True},
        "sqlalchemy.engine": {"level": "WARNING", "propagate": True},
    },
})

logger = logging.getLogger("tardmart")

from app.database import engine, Base
import app.models.sale_payment  # noqa: F401 — registers SalePayment with Base.metadata
import app.models.expense       # noqa: F401 — registers Expense with Base.metadata
import app.models.return_rma    # noqa: F401 — registers ReturnBatch with Base.metadata
import app.models.label_template  # noqa: F401 — registers LabelTemplate with Base.metadata
import app.models.price_change    # noqa: F401 — registers PriceChange with Base.metadata
import app.models.purchase_order  # noqa: F401 — registers POReceivedDevice with Base.metadata


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Run create_all first in its own transaction
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Run each migration in its own transaction so DDL commits before next statement sees it.
    # This is critical for: CREATE UNIQUE INDEX → ON CONFLICT, ALTER TYPE ADD VALUE visibility.
    _migrations = [
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
            "ALTER TABLE phone_models ADD COLUMN IF NOT EXISTS ram VARCHAR(20)",
            "ALTER TABLE po_line_items ADD COLUMN IF NOT EXISTS ram_str VARCHAR(20)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS allowed_modules TEXT",
            # User management update: username, employee_id, must_change_password
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='email') THEN ALTER TABLE users RENAME COLUMN email TO username; END IF; END $$""",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_id VARCHAR(50)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE",
            # Inventory number for barcode system
            "ALTER TABLE devices ADD COLUMN IF NOT EXISTS inventory_number VARCHAR(20)",
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_devices_inventory_number ON devices (inventory_number) WHERE inventory_number IS NOT NULL",
            # Selling price fields on devices (set at intake by INVENTORY)
            "ALTER TABLE devices ADD COLUMN IF NOT EXISTS selling_price NUMERIC(10,2)",
            "ALTER TABLE devices ADD COLUMN IF NOT EXISTS selling_price_set_by UUID REFERENCES users(id)",
            "ALTER TABLE devices ADD COLUMN IF NOT EXISTS selling_price_set_at TIMESTAMP",
            # Cost price audit fields on devices (set by ADMIN/OPERATIONS)
            "ALTER TABLE devices ADD COLUMN IF NOT EXISTS cost_price_updated_by UUID REFERENCES users(id)",
            "ALTER TABLE devices ADD COLUMN IF NOT EXISTS cost_price_updated_at TIMESTAMP",
            # Selling price on PO line items
            "ALTER TABLE po_line_items ADD COLUMN IF NOT EXISTS selling_price NUMERIC(10,2)",
            # Add OPERATIONS to userrole enum
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='OPERATIONS' AND enumtypid=(SELECT oid FROM pg_type WHERE typname='userrole')) THEN ALTER TYPE userrole ADD VALUE 'OPERATIONS'; END IF; END $$",
            # PO status expansion — add new enum values safely
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='ordered' AND enumtypid=(SELECT oid FROM pg_type WHERE typname='postatus')) THEN ALTER TYPE postatus ADD VALUE 'ordered'; END IF; END $$",
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='partially_received' AND enumtypid=(SELECT oid FROM pg_type WHERE typname='postatus')) THEN ALTER TYPE postatus ADD VALUE 'partially_received'; END IF; END $$",
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='fully_received' AND enumtypid=(SELECT oid FROM pg_type WHERE typname='postatus')) THEN ALTER TYPE postatus ADD VALUE 'fully_received'; END IF; END $$",
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='closed_discrepancy' AND enumtypid=(SELECT oid FROM pg_type WHERE typname='postatus')) THEN ALTER TYPE postatus ADD VALUE 'closed_discrepancy'; END IF; END $$",
            # PO audit: who created it
            "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id)",
            # POLineItem receiving tracking
            "ALTER TABLE po_line_items ADD COLUMN IF NOT EXISTS received_qty INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE po_line_items ADD COLUMN IF NOT EXISTS item_status VARCHAR(30) NOT NULL DEFAULT 'pending'",
            "ALTER TABLE po_line_items ADD COLUMN IF NOT EXISTS discrepancy_notes TEXT",
            # POReceivedDevice table — tracks actual received units per line item
            """CREATE TABLE IF NOT EXISTS po_received_devices (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                po_id UUID NOT NULL REFERENCES purchase_orders(id),
                line_item_id UUID NOT NULL REFERENCES po_line_items(id),
                device_id UUID REFERENCES devices(id),
                imei VARCHAR(20) NOT NULL,
                actual_brand VARCHAR(100),
                actual_model_str VARCHAR(100),
                actual_ram_str VARCHAR(20),
                actual_storage_str VARCHAR(50),
                actual_colour_str VARCHAR(50),
                actual_grade VARCHAR(5),
                actual_condition VARCHAR(30),
                selling_price NUMERIC(10,2),
                received_by_user_id UUID REFERENCES users(id),
                received_at TIMESTAMP NOT NULL DEFAULT NOW(),
                notes TEXT,
                migrated BOOLEAN NOT NULL DEFAULT FALSE
            )""",
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_po_received_devices_imei ON po_received_devices (imei)",
            # Data migration: link existing devices to received records (idempotent via NOT EXISTS)
            """INSERT INTO po_received_devices
                (id, po_id, line_item_id, device_id, imei, actual_brand, actual_model_str,
                 actual_ram_str, actual_storage_str, actual_colour_str, actual_grade,
                 actual_condition, selling_price, received_at, migrated)
               SELECT
                 gen_random_uuid(),
                 d.purchase_order_id,
                 li.id,
                 d.id,
                 d.imei,
                 li.brand,
                 li.model_name_str,
                 li.ram_str,
                 li.storage_str,
                 li.colour_str,
                 li.grade,
                 COALESCE(li.initial_status, 'awaiting_refurb'),
                 COALESCE(li.selling_price, d.selling_price),
                 COALESCE(d.date_received::timestamp, NOW()),
                 TRUE
               FROM devices d
               JOIN po_line_items li ON li.po_id = d.purchase_order_id AND li.imei = d.imei
               WHERE d.purchase_order_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM po_received_devices prd WHERE prd.imei = d.imei)""",
            # Update received_qty on line items that have received devices
            """UPDATE po_line_items li
               SET received_qty = sub.cnt,
                   item_status = CASE WHEN sub.cnt >= li.quantity THEN 'fully_received' ELSE 'partially_received' END
               FROM (SELECT line_item_id, COUNT(*) AS cnt FROM po_received_devices GROUP BY line_item_id) sub
               WHERE li.id = sub.line_item_id AND li.received_qty = 0""",
            # Fix selling_price on existing devices from their line items
            """UPDATE devices d
               SET selling_price = prd.selling_price,
                   selling_price_set_at = prd.received_at
               FROM po_received_devices prd
               WHERE prd.device_id = d.id
               AND d.selling_price IS NULL
               AND prd.selling_price IS NOT NULL""",
            # Price changes audit table
            """CREATE TABLE IF NOT EXISTS price_changes (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                device_id UUID NOT NULL REFERENCES devices(id),
                imei VARCHAR(20) NOT NULL,
                user_id UUID NOT NULL REFERENCES users(id),
                user_role VARCHAR(30) NOT NULL,
                field VARCHAR(50) NOT NULL,
                old_value NUMERIC(10,2),
                new_value NUMERIC(10,2),
                action VARCHAR(30) NOT NULL,
                notes TEXT,
                timestamp TIMESTAMP NOT NULL DEFAULT NOW()
            )""",
            # Bulk returns / batch RMA
            """CREATE TABLE IF NOT EXISTS return_batches (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                batch_number VARCHAR(50) UNIQUE NOT NULL,
                original_sale_id UUID REFERENCES sales(id),
                customer_id UUID NOT NULL REFERENCES customers(id),
                date DATE NOT NULL,
                received_by_user_id UUID REFERENCES users(id),
                notes TEXT,
                status VARCHAR(30) NOT NULL DEFAULT 'received',
                created_at TIMESTAMP NOT NULL DEFAULT NOW()
            )""",
            "ALTER TABLE return_rmas ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES return_batches(id)",
            "ALTER TABLE return_rmas ADD COLUMN IF NOT EXISTS replacement_device_id UUID REFERENCES devices(id)",
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='reject' AND enumtypid=(SELECT oid FROM pg_type WHERE typname='returnresolution')) THEN ALTER TYPE returnresolution ADD VALUE 'reject'; END IF; END $$",
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='scrap' AND enumtypid=(SELECT oid FROM pg_type WHERE typname='returnresolution')) THEN ALTER TYPE returnresolution ADD VALUE 'scrap'; END IF; END $$",
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='awaiting_refurb' AND enumtypid=(SELECT oid FROM pg_type WHERE typname='restockoutcome')) THEN ALTER TYPE restockoutcome ADD VALUE 'awaiting_refurb'; END IF; END $$",
            # New DeviceStatus values for QC workflow, returns and harvesting
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='AWAITING_QC' AND enumtypid=(SELECT oid FROM pg_type WHERE typname='devicestatus')) THEN ALTER TYPE devicestatus ADD VALUE 'AWAITING_QC'; END IF; END $$",
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='FAILED_QC' AND enumtypid=(SELECT oid FROM pg_type WHERE typname='devicestatus')) THEN ALTER TYPE devicestatus ADD VALUE 'FAILED_QC'; END IF; END $$",
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='STOCK_TO_RETURN' AND enumtypid=(SELECT oid FROM pg_type WHERE typname='devicestatus')) THEN ALTER TYPE devicestatus ADD VALUE 'STOCK_TO_RETURN'; END IF; END $$",
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='HARVESTED' AND enumtypid=(SELECT oid FROM pg_type WHERE typname='devicestatus')) THEN ALTER TYPE devicestatus ADD VALUE 'HARVESTED'; END IF; END $$",
            # New DeviceLocation for QC station
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='QC' AND enumtypid=(SELECT oid FROM pg_type WHERE typname='devicelocation')) THEN ALTER TYPE devicelocation ADD VALUE 'QC'; END IF; END $$",
            # New JobStatus values for QC workflow
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='awaiting_qc' AND enumtypid=(SELECT oid FROM pg_type WHERE typname='jobstatus')) THEN ALTER TYPE jobstatus ADD VALUE 'awaiting_qc'; END IF; END $$",
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='qc_failed' AND enumtypid=(SELECT oid FROM pg_type WHERE typname='jobstatus')) THEN ALTER TYPE jobstatus ADD VALUE 'qc_failed'; END IF; END $$",
            # Auto-created flag on refurb jobs
            "ALTER TABLE refurb_jobs ADD COLUMN IF NOT EXISTS auto_created BOOLEAN NOT NULL DEFAULT FALSE",
            # Backfill: create refurb jobs for existing AWAITING_REFURB devices without an active job
            """INSERT INTO refurb_jobs (id, job_number, device_id, status, date_opened, auto_created, external_cost, created_at)
               SELECT
                 gen_random_uuid(),
                 'JOB-MIGR-' || ROW_NUMBER() OVER (ORDER BY d.created_at),
                 d.id,
                 'open',
                 CURRENT_DATE,
                 TRUE,
                 0.00,
                 NOW()
               FROM devices d
               WHERE d.status = 'AWAITING_REFURB'
               AND NOT EXISTS (
                 SELECT 1 FROM refurb_jobs rj
                 WHERE rj.device_id = d.id
                 AND rj.status NOT IN ('closed')
               )""",
    ]
    for stmt in _migrations:
        async with engine.begin() as conn:
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


_origins = settings.cors_origins_list
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    # credentials=True is incompatible with wildcard origins (Starlette raises 500).
    # The app uses Bearer tokens in Authorization header, not cookies, so this is only
    # needed in production where explicit origins are listed.
    allow_credentials="*" not in _origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── routers ──────────────────────────────────────────────────────────────────
from app.routers import (
    auth, devices, parts, purchase_orders,
    refurb_jobs, sales, customers, suppliers, users, returns, reports, phone_models, expenses,
    label_templates,
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
app.include_router(label_templates.router, prefix="/api/label-templates", tags=["label-templates"])


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "tardmart-api"}
