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
import app.models.app_setting     # noqa: F401 — registers AppSetting with Base.metadata


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
            "ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(12,2) NOT NULL DEFAULT 0",
            "ALTER TABLE customers ADD COLUMN IF NOT EXISTS current_balance NUMERIC(12,2) NOT NULL DEFAULT 0",
            "ALTER TABLE devices ADD COLUMN IF NOT EXISTS parts_cost NUMERIC(10,2) NOT NULL DEFAULT 0",
            "ALTER TABLE devices ADD COLUMN IF NOT EXISTS external_cost NUMERIC(10,2) NOT NULL DEFAULT 0",
            "ALTER TABLE sale_line_items ADD COLUMN IF NOT EXISTS part_id UUID REFERENCES parts(id)",
            "ALTER TABLE sale_line_items ADD COLUMN IF NOT EXISTS notes TEXT",
            "ALTER TABLE sales ADD COLUMN IF NOT EXISTS notes TEXT",
            "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS part_id UUID REFERENCES parts(id)",
            "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS reference_type VARCHAR(20)",
            "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS reference_id VARCHAR(100)",
            "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS notes TEXT",
            "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id)",
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
            """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='email') THEN ALTER TABLE users RENAME COLUMN email TO username; END IF; EXCEPTION WHEN OTHERS THEN NULL; END $$""",
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
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='OPERATIONS' AND enumtypid=(SELECT oid FROM pg_type WHERE typname='userrole')) THEN ALTER TYPE userrole ADD VALUE 'OPERATIONS'; END IF; EXCEPTION WHEN OTHERS THEN NULL; END $$",
            # PO status expansion — legacy; type may not exist on fresh DBs (model uses native_enum=False)
            "DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_type WHERE typname='postatus') AND NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='ordered' AND enumtypid=(SELECT oid FROM pg_type WHERE typname='postatus')) THEN ALTER TYPE postatus ADD VALUE 'ordered'; END IF; EXCEPTION WHEN OTHERS THEN NULL; END $$",
            "DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_type WHERE typname='postatus') AND NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='partially_received' AND enumtypid=(SELECT oid FROM pg_type WHERE typname='postatus')) THEN ALTER TYPE postatus ADD VALUE 'partially_received'; END IF; EXCEPTION WHEN OTHERS THEN NULL; END $$",
            "DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_type WHERE typname='postatus') AND NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='fully_received' AND enumtypid=(SELECT oid FROM pg_type WHERE typname='postatus')) THEN ALTER TYPE postatus ADD VALUE 'fully_received'; END IF; EXCEPTION WHEN OTHERS THEN NULL; END $$",
            "DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_type WHERE typname='postatus') AND NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='closed_discrepancy' AND enumtypid=(SELECT oid FROM pg_type WHERE typname='postatus')) THEN ALTER TYPE postatus ADD VALUE 'closed_discrepancy'; END IF; EXCEPTION WHEN OTHERS THEN NULL; END $$",
            # Convert purchase_orders.status from native PostgreSQL enum to plain VARCHAR.
            # The Python model uses native_enum=False (stores as text) but the DB column may
            # still be the old postatus enum type which rejects values like 'ordered'/'ORDERED'.
            """DO $$ BEGIN
               IF EXISTS (
                 SELECT 1 FROM information_schema.columns
                 WHERE table_name='purchase_orders' AND column_name='status'
                 AND udt_name='postatus'
               ) THEN
                 ALTER TABLE purchase_orders
                   ALTER COLUMN status TYPE VARCHAR(30)
                   USING status::text;
               END IF;
               EXCEPTION WHEN OTHERS THEN NULL;
               END $$""",
            # Convert ALL other native PostgreSQL enum columns to VARCHAR so Python
            # native_enum=False models (which write lowercase text) don't get rejected.
            """DO $$ BEGIN
               IF EXISTS (
                 SELECT 1 FROM information_schema.columns
                 WHERE table_name='po_line_items' AND column_name='line_type'
                 AND udt_name NOT IN ('varchar','text')
               ) THEN
                 ALTER TABLE po_line_items ALTER COLUMN line_type TYPE VARCHAR(10) USING line_type::text;
               END IF;
               EXCEPTION WHEN OTHERS THEN NULL;
               END $$""",
            """DO $$ BEGIN
               IF EXISTS (
                 SELECT 1 FROM information_schema.columns
                 WHERE table_name='devices' AND column_name='grade'
                 AND udt_name NOT IN ('varchar','text')
               ) THEN
                 ALTER TABLE devices ALTER COLUMN grade TYPE VARCHAR(5) USING grade::text;
               END IF;
               EXCEPTION WHEN OTHERS THEN NULL;
               END $$""",
            """DO $$ BEGIN
               IF EXISTS (
                 SELECT 1 FROM information_schema.columns
                 WHERE table_name='devices' AND column_name='status'
                 AND udt_name NOT IN ('varchar','text')
               ) THEN
                 ALTER TABLE devices ALTER COLUMN status TYPE VARCHAR(30) USING status::text;
               END IF;
               EXCEPTION WHEN OTHERS THEN NULL;
               END $$""",
            """DO $$ BEGIN
               IF EXISTS (
                 SELECT 1 FROM information_schema.columns
                 WHERE table_name='devices' AND column_name='location'
                 AND udt_name NOT IN ('varchar','text')
               ) THEN
                 ALTER TABLE devices ALTER COLUMN location TYPE VARCHAR(30) USING location::text;
               END IF;
               EXCEPTION WHEN OTHERS THEN NULL;
               END $$""",
            """DO $$ BEGIN
               IF EXISTS (
                 SELECT 1 FROM information_schema.columns
                 WHERE table_name='users' AND column_name='role'
                 AND udt_name NOT IN ('varchar','text')
               ) THEN
                 ALTER TABLE users ALTER COLUMN role TYPE VARCHAR(20) USING role::text;
               END IF;
               EXCEPTION WHEN OTHERS THEN NULL;
               END $$""",
            """DO $$ BEGIN
               IF EXISTS (
                 SELECT 1 FROM information_schema.columns
                 WHERE table_name='refurb_jobs' AND column_name='status'
                 AND udt_name NOT IN ('varchar','text')
               ) THEN
                 ALTER TABLE refurb_jobs ALTER COLUMN status TYPE VARCHAR(20) USING status::text;
               END IF;
               EXCEPTION WHEN OTHERS THEN NULL;
               END $$""",
            """DO $$ BEGIN
               IF EXISTS (
                 SELECT 1 FROM information_schema.columns
                 WHERE table_name='refurb_jobs' AND column_name='outcome'
                 AND udt_name NOT IN ('varchar','text')
               ) THEN
                 ALTER TABLE refurb_jobs ALTER COLUMN outcome TYPE VARCHAR(20) USING outcome::text;
               END IF;
               EXCEPTION WHEN OTHERS THEN NULL;
               END $$""",
            # Normalise all status/role/grade/location values to lowercase after VARCHAR conversion.
            # Old PostgreSQL native enums stored the label as-is (e.g. 'ORDERED', 'AWAITING_REFURB').
            # Python models use lowercase values ('ordered', 'awaiting_refurb') so we must lowercase
            # existing rows once after the column type migration above.
            # Normalise to lowercase ONLY for columns whose Python enum values are lowercase.
            # Columns with UPPERCASE Python enum values (devices.status/location/grade, users.role)
            # must NOT be lowercased — their stored values must match the Python enum values exactly.
            "UPDATE purchase_orders SET status = LOWER(status) WHERE status ~ '[a-z]' IS FALSE AND status IS NOT NULL",
            "UPDATE po_line_items SET line_type = LOWER(line_type) WHERE line_type ~ '[a-z]' IS FALSE AND line_type IS NOT NULL",
            "UPDATE po_line_items SET item_status = LOWER(item_status) WHERE item_status IS NOT NULL AND item_status ~ '[a-z]' IS FALSE",
            "UPDATE refurb_jobs SET status = LOWER(status) WHERE status IS NOT NULL AND status ~ '[a-z]' IS FALSE",
            "UPDATE refurb_jobs SET outcome = LOWER(outcome) WHERE outcome IS NOT NULL AND outcome ~ '[a-z]' IS FALSE",
            # Drop orphaned native PostgreSQL enum types. After the columns were converted to
            # VARCHAR above, these types are no longer used by any column. However SQLAlchemy
            # still discovers them via pg_catalog at connection time and registers a result
            # processor that crashes with LookupError when reading back values like
            # 'fully_received'. Dropping them makes SQLAlchemy treat the columns as plain strings.
            "DO $$ BEGIN DROP TYPE IF EXISTS postatus CASCADE; EXCEPTION WHEN OTHERS THEN NULL; END $$",
            "DO $$ BEGIN DROP TYPE IF EXISTS jobstatus CASCADE; EXCEPTION WHEN OTHERS THEN NULL; END $$",
            "DO $$ BEGIN DROP TYPE IF EXISTS joboutcome CASCADE; EXCEPTION WHEN OTHERS THEN NULL; END $$",
            "DO $$ BEGIN DROP TYPE IF EXISTS polineitemstatus CASCADE; EXCEPTION WHEN OTHERS THEN NULL; END $$",
            "DO $$ BEGIN DROP TYPE IF EXISTS polinetype CASCADE; EXCEPTION WHEN OTHERS THEN NULL; END $$",
            "DO $$ BEGIN DROP TYPE IF EXISTS referencetype CASCADE; EXCEPTION WHEN OTHERS THEN NULL; END $$",
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
            # Data migrations wrapped in exception handlers — failures are logged but never crash startup
            """DO $$ BEGIN
               INSERT INTO po_received_devices
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
               AND NOT EXISTS (SELECT 1 FROM po_received_devices prd WHERE prd.imei = d.imei);
               EXCEPTION WHEN OTHERS THEN NULL;
               END $$""",
            """DO $$ BEGIN
               UPDATE po_line_items li
               SET received_qty = sub.cnt,
                   item_status = CASE WHEN sub.cnt >= li.quantity THEN 'fully_received' ELSE 'partially_received' END
               FROM (SELECT line_item_id, COUNT(*) AS cnt FROM po_received_devices GROUP BY line_item_id) sub
               WHERE li.id = sub.line_item_id AND li.received_qty = 0;
               EXCEPTION WHEN OTHERS THEN NULL;
               END $$""",
            """DO $$ BEGIN
               UPDATE devices d
               SET selling_price = prd.selling_price,
                   selling_price_set_at = prd.received_at
               FROM po_received_devices prd
               WHERE prd.device_id = d.id
               AND d.selling_price IS NULL
               AND prd.selling_price IS NOT NULL;
               EXCEPTION WHEN OTHERS THEN NULL;
               END $$""",
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
            "ALTER TABLE return_batches ADD COLUMN IF NOT EXISTS batch_number VARCHAR(50)",
            "ALTER TABLE return_batches ADD COLUMN IF NOT EXISTS original_sale_id UUID REFERENCES sales(id)",
            "ALTER TABLE return_batches ADD COLUMN IF NOT EXISTS date DATE NOT NULL DEFAULT CURRENT_DATE",
            "ALTER TABLE return_batches ADD COLUMN IF NOT EXISTS received_by_user_id UUID REFERENCES users(id)",
            "ALTER TABLE return_batches ADD COLUMN IF NOT EXISTS notes TEXT",
            "ALTER TABLE return_batches ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'received'",
            "ALTER TABLE return_batches ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW()",
            "ALTER TABLE return_rmas ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES return_batches(id)",
            "ALTER TABLE return_rmas ADD COLUMN IF NOT EXISTS replacement_device_id UUID REFERENCES devices(id)",
            "ALTER TABLE return_rmas ADD COLUMN IF NOT EXISTS condition_on_return TEXT",
            "ALTER TABLE return_rmas ADD COLUMN IF NOT EXISTS within_warranty BOOLEAN NOT NULL DEFAULT FALSE",
            "ALTER TABLE return_rmas ADD COLUMN IF NOT EXISTS restock_outcome VARCHAR(30)",
            "ALTER TABLE return_rmas ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(10,2)",
            "ALTER TABLE return_rmas ADD COLUMN IF NOT EXISTS handled_by_user_id UUID REFERENCES users(id)",
            "ALTER TABLE return_rmas ADD COLUMN IF NOT EXISTS notes TEXT",
            "ALTER TABLE return_rmas ADD COLUMN IF NOT EXISTS original_sale_id UUID REFERENCES sales(id)",
            # Convert native enum columns on return_rmas to VARCHAR (model uses native_enum=False)
            """DO $$ BEGIN
               IF EXISTS (
                 SELECT 1 FROM information_schema.columns
                 WHERE table_name='return_rmas' AND column_name='reason_code'
                 AND udt_name NOT IN ('varchar','text')
               ) THEN
                 ALTER TABLE return_rmas ALTER COLUMN reason_code TYPE VARCHAR(30) USING reason_code::text;
               END IF;
               EXCEPTION WHEN OTHERS THEN NULL;
               END $$""",
            """DO $$ BEGIN
               IF EXISTS (
                 SELECT 1 FROM information_schema.columns
                 WHERE table_name='return_rmas' AND column_name='resolution'
                 AND udt_name NOT IN ('varchar','text')
               ) THEN
                 ALTER TABLE return_rmas ALTER COLUMN resolution TYPE VARCHAR(30) USING resolution::text;
               END IF;
               EXCEPTION WHEN OTHERS THEN NULL;
               END $$""",
            """DO $$ BEGIN
               IF EXISTS (
                 SELECT 1 FROM information_schema.columns
                 WHERE table_name='return_rmas' AND column_name='restock_outcome'
                 AND udt_name NOT IN ('varchar','text')
               ) THEN
                 ALTER TABLE return_rmas ALTER COLUMN restock_outcome TYPE VARCHAR(30) USING restock_outcome::text;
               END IF;
               EXCEPTION WHEN OTHERS THEN NULL;
               END $$""",
            "DO $$ BEGIN DROP TYPE IF EXISTS returnreasoncode CASCADE; EXCEPTION WHEN OTHERS THEN NULL; END $$",
            "DO $$ BEGIN DROP TYPE IF EXISTS returnresolution CASCADE; EXCEPTION WHEN OTHERS THEN NULL; END $$",
            "DO $$ BEGIN DROP TYPE IF EXISTS restockoutcome CASCADE; EXCEPTION WHEN OTHERS THEN NULL; END $$",
            "DO $$ BEGIN DROP TYPE IF EXISTS returnbatchstatus CASCADE; EXCEPTION WHEN OTHERS THEN NULL; END $$",
            # Normalise return_rmas enum values: old native enums stored member NAMES
            # (FAULT_DEVELOPED); the Python enums expect values (fault_developed).
            # 'DOA' is uppercase in the Python enum too, so it must NOT be lowercased.
            "UPDATE return_rmas SET reason_code = LOWER(reason_code) WHERE reason_code IS NOT NULL AND reason_code <> 'DOA' AND reason_code ~ '[a-z]' IS FALSE",
            "UPDATE return_rmas SET resolution = LOWER(resolution) WHERE resolution IS NOT NULL AND resolution ~ '[a-z]' IS FALSE",
            "UPDATE return_rmas SET restock_outcome = LOWER(restock_outcome) WHERE restock_outcome IS NOT NULL AND restock_outcome ~ '[a-z]' IS FALSE",
            "UPDATE return_batches SET status = LOWER(status) WHERE status IS NOT NULL AND status ~ '[a-z]' IS FALSE",
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='reject' AND enumtypid=(SELECT oid FROM pg_type WHERE typname='returnresolution')) THEN ALTER TYPE returnresolution ADD VALUE 'reject'; END IF; EXCEPTION WHEN OTHERS THEN NULL; END $$",
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='scrap' AND enumtypid=(SELECT oid FROM pg_type WHERE typname='returnresolution')) THEN ALTER TYPE returnresolution ADD VALUE 'scrap'; END IF; EXCEPTION WHEN OTHERS THEN NULL; END $$",
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='awaiting_refurb' AND enumtypid=(SELECT oid FROM pg_type WHERE typname='restockoutcome')) THEN ALTER TYPE restockoutcome ADD VALUE 'awaiting_refurb'; END IF; EXCEPTION WHEN OTHERS THEN NULL; END $$",
            # New DeviceStatus values for QC workflow, returns and harvesting
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='AWAITING_QC' AND enumtypid=(SELECT oid FROM pg_type WHERE typname='devicestatus')) THEN ALTER TYPE devicestatus ADD VALUE 'AWAITING_QC'; END IF; EXCEPTION WHEN OTHERS THEN NULL; END $$",
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='FAILED_QC' AND enumtypid=(SELECT oid FROM pg_type WHERE typname='devicestatus')) THEN ALTER TYPE devicestatus ADD VALUE 'FAILED_QC'; END IF; EXCEPTION WHEN OTHERS THEN NULL; END $$",
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='STOCK_TO_RETURN' AND enumtypid=(SELECT oid FROM pg_type WHERE typname='devicestatus')) THEN ALTER TYPE devicestatus ADD VALUE 'STOCK_TO_RETURN'; END IF; EXCEPTION WHEN OTHERS THEN NULL; END $$",
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='HARVESTED' AND enumtypid=(SELECT oid FROM pg_type WHERE typname='devicestatus')) THEN ALTER TYPE devicestatus ADD VALUE 'HARVESTED'; END IF; EXCEPTION WHEN OTHERS THEN NULL; END $$",
            # New DeviceLocation for QC station
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='QC' AND enumtypid=(SELECT oid FROM pg_type WHERE typname='devicelocation')) THEN ALTER TYPE devicelocation ADD VALUE 'QC'; END IF; EXCEPTION WHEN OTHERS THEN NULL; END $$",
            # New JobStatus values for QC workflow
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='awaiting_qc' AND enumtypid=(SELECT oid FROM pg_type WHERE typname='jobstatus')) THEN ALTER TYPE jobstatus ADD VALUE 'awaiting_qc'; END IF; EXCEPTION WHEN OTHERS THEN NULL; END $$",
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='qc_failed' AND enumtypid=(SELECT oid FROM pg_type WHERE typname='jobstatus')) THEN ALTER TYPE jobstatus ADD VALUE 'qc_failed'; END IF; EXCEPTION WHEN OTHERS THEN NULL; END $$",
            # Auto-created flag on refurb jobs
            "ALTER TABLE refurb_jobs ADD COLUMN IF NOT EXISTS auto_created BOOLEAN NOT NULL DEFAULT FALSE",
            # Backfill: create refurb jobs for existing AWAITING_REFURB devices without an active job
            """DO $$ BEGIN
               INSERT INTO refurb_jobs (id, job_number, device_id, status, date_opened, auto_created, external_cost, created_at)
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
               );
               EXCEPTION WHEN OTHERS THEN NULL;
               END $$""",
    ]
    for stmt in _migrations:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(stmt))
        except Exception as exc:
            logger.warning("Migration skipped: %s | error: %s", stmt[:120], exc)
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
    label_templates, settings as settings_router,
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
app.include_router(settings_router.router, prefix="/api/settings", tags=["settings"])
app.include_router(label_templates.router, prefix="/api/label-templates", tags=["label-templates"])


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "tardmart-api"}
