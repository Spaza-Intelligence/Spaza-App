CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE shops (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    owner_name VARCHAR(150),
    phone VARCHAR(40),
    email VARCHAR(150),
    address TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('OWNER', 'MANAGER', 'CASHIER', 'ADMIN')),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE shop_users (
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (shop_id, user_id)
);

CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (shop_id, name)
);

CREATE TABLE suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(40),
    email VARCHAR(150),
    address TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
    name VARCHAR(150) NOT NULL,
    sku VARCHAR(80),
    barcode VARCHAR(100),
    unit VARCHAR(30) NOT NULL DEFAULT 'item',
    cost_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
    selling_price NUMERIC(12,2) NOT NULL CHECK (selling_price >= 0),
    quantity_on_hand INTEGER NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
    minimum_stock INTEGER NOT NULL DEFAULT 0 CHECK (minimum_stock >= 0),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (shop_id, sku),
    UNIQUE (shop_id, barcode)
);

CREATE TABLE purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(id),
    supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
    invoice_number VARCHAR(80),
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    notes TEXT
);

CREATE TABLE purchase_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_id UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_cost NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0),
    line_total NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_cost) STORED
);

CREATE TABLE sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(id),
    cashier_id UUID REFERENCES users(id) ON DELETE SET NULL,
    receipt_number VARCHAR(80) NOT NULL,
    subtotal NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    discount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
    total NUMERIC(12,2) NOT NULL CHECK (total >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'VOIDED', 'REFUNDED')),
    sold_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (shop_id, receipt_number)
);

CREATE TABLE sale_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
    cost_price NUMERIC(12,2) NOT NULL CHECK (cost_price >= 0),
    line_total NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED
);

CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    method VARCHAR(30) NOT NULL CHECK (method IN ('CASH', 'CARD', 'EFT', 'MOBILE_MONEY', 'CREDIT')),
    amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reference VARCHAR(100)
);

CREATE TABLE stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(id),
    product_id UUID NOT NULL REFERENCES products(id),
    movement_type VARCHAR(30) NOT NULL CHECK (movement_type IN ('PURCHASE', 'SALE', 'ADJUSTMENT', 'RETURN', 'DAMAGE')),
    quantity_change INTEGER NOT NULL CHECK (quantity_change <> 0),
    quantity_after INTEGER NOT NULL CHECK (quantity_after >= 0),
    reference_id UUID,
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(id),
    category VARCHAR(80) NOT NULL,
    description TEXT NOT NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
    recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(40),
    email VARCHAR(150),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE customer_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    sale_id UUID REFERENCES sales(id) ON DELETE SET NULL,
    transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('CHARGE', 'PAYMENT', 'ADJUSTMENT')),
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID REFERENCES shops(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(80) NOT NULL,
    entity_type VARCHAR(80),
    entity_id UUID,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_products_shop ON products(shop_id);
CREATE INDEX idx_products_low_stock ON products(shop_id, quantity_on_hand, minimum_stock);
CREATE INDEX idx_sales_shop_date ON sales(shop_id, sold_at);
CREATE INDEX idx_purchase_shop_date ON purchases(shop_id, purchased_at);
CREATE INDEX idx_stock_movements_product_date ON stock_movements(product_id, created_at);
CREATE INDEX idx_expenses_shop_date ON expenses(shop_id, expense_date);
CREATE INDEX idx_audit_logs_shop_date ON audit_logs(shop_id, created_at);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER shops_updated_at BEFORE UPDATE ON shops
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER products_updated_at BEFORE UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
