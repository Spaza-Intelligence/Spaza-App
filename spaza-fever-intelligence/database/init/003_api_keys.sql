CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    name VARCHAR(80) NOT NULL,
    key_prefix VARCHAR(20) NOT NULL,
    key_hash CHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    CHECK (expires_at IS NULL OR expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_api_keys_owner_shop
    ON api_keys (user_id, shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_keys_active
    ON api_keys (key_hash)
    WHERE revoked_at IS NULL;
