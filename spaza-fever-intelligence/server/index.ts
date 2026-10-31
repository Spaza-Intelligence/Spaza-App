import "dotenv/config";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Request, type Response } from "express";
import { Pool } from "pg";

const app = express();
const port = Number(process.env.PORT || 3001);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const sessions = new Map<string, { userId: string; shopId: string; expiresAt: number; role: "CUSTOMER" | "MANAGER" | "ADMIN" }>();
const cookieName = "spaza_session";
const sessionSecret = process.env.SESSION_SECRET || "development-only-change-me";
if (process.env.NODE_ENV === "production" && (sessionSecret === "development-only-change-me" || sessionSecret.length < 32)) throw new Error("Production requires SESSION_SECRET with at least 32 characters.");

type AppRole = "CUSTOMER" | "MANAGER" | "ADMIN";
interface User { id: string; fullName: string; email: string; role: AppRole; shopId: string; shopName: string; }

app.use(express.json());
app.get("/api/health", async (_req, res) => {
  try { await pool.query("SELECT 1"); res.json({ status: "ok", database: "connected", app: "Spaza FEVER Intelligence" }); }
  catch { res.status(503).json({ status: "degraded", database: "unavailable", app: "Spaza FEVER Intelligence" }); }
});

function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash || !/^[a-f0-9]{128}$/i.test(hash)) return false;
  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(hash, "hex"));
}
function signedToken(raw: string) { return `${raw}.${crypto.createHmac("sha256", sessionSecret).update(raw).digest("hex")}`; }
function parseCookies(req: Request) { return Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map((part) => { const [k, ...v] = part.trim().split("="); return [k, decodeURIComponent(v.join("="))]; })); }
function setSession(res: Response, userId: string, shopId: string, role: AppRole) {
  const raw = crypto.randomBytes(32).toString("hex");
  sessions.set(raw, { userId, shopId, role, expiresAt: Date.now() + 1000 * 60 * 60 * 12 });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${cookieName}=${encodeURIComponent(signedToken(raw))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${secure}`);
}
function clearSession(res: Response) { const secure = process.env.NODE_ENV === "production" ? "; Secure" : ""; res.setHeader("Set-Cookie", `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`); }
async function getCurrentUser(req: Request): Promise<User | null> {
  const token = parseCookies(req)[cookieName] || ""; const [raw, signature] = token.split(".");
  if (!raw || signature !== crypto.createHmac("sha256", sessionSecret).update(raw).digest("hex")) return null;
  const session = sessions.get(raw); if (!session || session.expiresAt < Date.now()) return null;
  const result = await pool.query(`SELECT u.id, u.full_name, u.email, u.role, su.shop_id, s.name AS shop_name FROM users u JOIN shop_users su ON su.user_id=u.id JOIN shops s ON s.id=su.shop_id WHERE u.id=$1 AND su.shop_id=$2 AND u.active=true AND s.active=true LIMIT 1`, [session.userId, session.shopId]);
  if (!result.rows[0]) return null;
  const row = result.rows[0]; return { id: row.id, fullName: row.full_name, email: row.email, role: roleFromDatabase(row.role), shopId: row.shop_id, shopName: row.shop_name };
}
function roleFromDatabase(role: string): AppRole { return role === "ADMIN" || role === "OWNER" ? "ADMIN" : role === "MANAGER" ? "MANAGER" : "CUSTOMER"; }
async function getApiKeyUser(req: Request): Promise<User | null> {
  const authorization = req.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const secret = match[1].trim();
  if (!secret || secret.length > 256) return null;
  const keyHash = crypto.createHash("sha256").update(secret).digest("hex");
  const result = await pool.query(`UPDATE api_keys k SET last_used_at=NOW() FROM users u JOIN shop_users su ON su.user_id=u.id JOIN shops s ON s.id=su.shop_id WHERE k.user_id=u.id AND k.shop_id=su.shop_id AND k.key_hash=$1 AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at>NOW()) AND u.active=true AND s.active=true RETURNING u.id,u.full_name,u.email,u.role,k.shop_id,s.name AS shop_name`, [keyHash]);
  const row = result.rows[0];
  if (!row) return null;
  return { id: row.id, fullName: row.full_name, email: row.email, role: roleFromDatabase(row.role), shopId: row.shop_id, shopName: row.shop_name };
}
function requireAuth(roles?: AppRole[], sessionOnly = false) { return async (req: Request, res: Response, next: () => void) => { try { const user = sessionOnly ? await getCurrentUser(req) : (req.get("authorization") ? await getApiKeyUser(req) : await getCurrentUser(req)); if (!user) return res.status(401).json({ error: "Please sign in first." }); if (roles && !roles.includes(user.role)) return res.status(403).json({ error: "You do not have access to this area." }); (req as Request & { user: User }).user = user; next(); } catch (error) { res.status(500).json({ error: "Unable to load your session." }); } }; }
const requireSessionAuth = (roles?: AppRole[]) => requireAuth(roles, true);

app.post("/api/auth/register", async (req, res) => {
  const { fullName, email, password } = req.body || {};
  if (typeof fullName !== "string" || !fullName.trim() || fullName.trim().length > 150 || typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email.trim()) || typeof password !== "string" || password.length < 12) return res.status(400).json({ error: "A name, valid email, and password of at least 12 characters are required." });
  // Public registration never trusts a role supplied by the caller.
  const appRole: AppRole = "CUSTOMER";
  const dbRole = "CASHIER";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const shop = (await client.query("SELECT id FROM shops WHERE active=true ORDER BY created_at LIMIT 1")).rows[0];
    if (!shop) throw new Error("No active shop exists in the database.");
    const inserted = await client.query("INSERT INTO users (full_name,email,password_hash,role) VALUES ($1,$2,$3,$4) RETURNING id", [fullName.trim(), email.trim().toLowerCase(), hashPassword(password), dbRole]);
    await client.query("INSERT INTO shop_users (shop_id,user_id) VALUES ($1,$2)", [shop.id, inserted.rows[0].id]);
    await client.query("INSERT INTO audit_logs (shop_id,user_id,action,entity_type,details) VALUES ($1,$2,'REGISTER','USER',$3)", [shop.id, inserted.rows[0].id, JSON.stringify({ role: appRole })]);
    await client.query("COMMIT"); setSession(res, inserted.rows[0].id, shop.id, appRole); res.status(201).json({ user: await getCurrentUser({ headers: { cookie: res.getHeader("Set-Cookie") as string } } as Request) });
  } catch (error: any) { await client.query("ROLLBACK"); res.status(error?.code === "23505" ? 409 : 400).json({ error: error?.code === "23505" ? "That email is already registered." : error?.message || "Could not create account." }); }
  finally { client.release(); }
});
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  try {
    const result = await pool.query("SELECT u.id,u.full_name,u.email,u.password_hash,u.role,su.shop_id FROM users u JOIN shop_users su ON su.user_id=u.id WHERE lower(u.email)=lower($1) AND u.active=true LIMIT 1", [email]);
    const row = result.rows[0]; if (!row || !verifyPassword(password || "", row.password_hash)) return res.status(401).json({ error: "Incorrect email or password." });
    const appRole: AppRole = row.role === "ADMIN" || row.role === "OWNER" ? "ADMIN" : row.role === "MANAGER" ? "MANAGER" : "CUSTOMER";
    setSession(res, row.id, row.shop_id, appRole); await pool.query("INSERT INTO audit_logs (shop_id,user_id,action,entity_type) VALUES ($1,$2,'LOGIN','USER')", [row.shop_id, row.id]);
    res.json({ user: { id: row.id, fullName: row.full_name, email: row.email, role: appRole, shopId: row.shop_id } });
  } catch { res.status(503).json({ error: "Database unavailable. Start PostgreSQL and try again." }); }
});
app.post("/api/auth/logout", (req, res) => { const token = parseCookies(req)[cookieName] || ""; sessions.delete(token.split(".")[0]); clearSession(res); res.json({ ok: true }); });
app.get("/api/auth/me", async (req, res) => { const user = await getCurrentUser(req); if (!user) return res.status(401).json({ error: "Not signed in" }); res.json({ user }); });
app.post("/api/auth/change-password", requireSessionAuth(), async (req, res) => {
  const user = (req as Request & { user: User }).user;
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== "string" || typeof newPassword !== "string" || newPassword.length < 12) return res.status(400).json({ error: "Enter your current password and a new password of at least 12 characters." });
  const result = await pool.query("SELECT password_hash FROM users WHERE id=$1 AND active=true", [user.id]);
  if (!result.rows[0] || !verifyPassword(currentPassword, result.rows[0].password_hash)) return res.status(401).json({ error: "Current password is incorrect." });
  await pool.query("UPDATE users SET password_hash=$1,updated_at=NOW() WHERE id=$2", [hashPassword(newPassword), user.id]);
  await pool.query("INSERT INTO audit_logs (shop_id,user_id,action,entity_type) VALUES ($1,$2,'CHANGE_PASSWORD','USER')", [user.shopId, user.id]);
  const currentRaw = (parseCookies(req)[cookieName] || "").split(".")[0];
  for (const [raw, session] of sessions) if (session.userId === user.id && raw !== currentRaw) sessions.delete(raw);
  res.json({ ok: true });
});

// API-key management is cookie-session-only: a Bearer key cannot mint or revoke keys.
app.get("/api/api-keys", requireSessionAuth(), async (req, res) => {
  const user = (req as Request & { user: User }).user;
  const result = await pool.query("SELECT id,name,key_prefix,created_at,last_used_at,expires_at,revoked_at FROM api_keys WHERE user_id=$1 AND shop_id=$2 ORDER BY created_at DESC", [user.id, user.shopId]);
  res.json({ keys: result.rows.map((row) => ({ id: row.id, name: row.name, keyPrefix: row.key_prefix, createdAt: row.created_at, lastUsedAt: row.last_used_at, expiresAt: row.expires_at, revokedAt: row.revoked_at })) });
});
app.post("/api/api-keys", requireSessionAuth(), async (req, res) => {
  const user = (req as Request & { user: User }).user;
  const name = String(req.body?.name || "").trim();
  const expirationDays = req.body?.expirationDays === null || req.body?.expirationDays === undefined || req.body?.expirationDays === "" ? null : Number(req.body.expirationDays);
  if (!name || name.length > 80) return res.status(400).json({ error: "A key name of 1–80 characters is required." });
  if (expirationDays !== null && (!Number.isInteger(expirationDays) || expirationDays < 1 || expirationDays > 365)) return res.status(400).json({ error: "Expiration must be between 1 and 365 days, or left blank." });
  const count = await pool.query("SELECT COUNT(*)::int AS count FROM api_keys WHERE user_id=$1 AND shop_id=$2 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>NOW())", [user.id, user.shopId]);
  if (count.rows[0].count >= 10) return res.status(409).json({ error: "You can have at most 10 active API keys for this shop. Revoke one before creating another." });
  const secret = `spaza_${crypto.randomBytes(32).toString("base64url")}`;
  const keyHash = crypto.createHash("sha256").update(secret).digest("hex");
  const expiresAt = expirationDays === null ? null : new Date(Date.now() + expirationDays * 24 * 60 * 60 * 1000);
  const result = await pool.query("INSERT INTO api_keys (user_id,shop_id,name,key_prefix,key_hash,expires_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,name,key_prefix,created_at,expires_at", [user.id, user.shopId, name, secret.slice(0, 14), keyHash, expiresAt]);
  const row = result.rows[0];
  res.status(201).json({ key: { id: row.id, name: row.name, keyPrefix: row.key_prefix, createdAt: row.created_at, expiresAt: row.expires_at }, secret, warning: "Copy this secret now. It cannot be shown again." });
});
app.delete("/api/api-keys/:id", requireSessionAuth(), async (req, res) => {
  const user = (req as Request & { user: User }).user;
  const result = await pool.query("UPDATE api_keys SET revoked_at=NOW() WHERE id=$1 AND user_id=$2 AND shop_id=$3 AND revoked_at IS NULL RETURNING id", [req.params.id, user.id, user.shopId]);
  if (!result.rows[0]) return res.status(404).json({ error: "Active API key not found." });
  res.json({ ok: true });
});

app.get("/api/dashboard", requireAuth(), async (req, res) => {
  const user = (req as Request & { user: User }).user;
  const [sales, products, lowStock, customers, users] = await Promise.all([
    pool.query("SELECT COALESCE(SUM(total),0) AS total, COUNT(*)::int AS count FROM sales WHERE shop_id=$1 AND status='COMPLETED' AND sold_at >= CURRENT_DATE", [user.shopId]),
    pool.query("SELECT COUNT(*)::int AS count, COALESCE(SUM(quantity_on_hand*cost_price),0) AS stock_value FROM products WHERE shop_id=$1 AND active=true", [user.shopId]),
    pool.query("SELECT id,name,sku,selling_price,quantity_on_hand,minimum_stock FROM products WHERE shop_id=$1 AND active=true AND quantity_on_hand <= minimum_stock ORDER BY quantity_on_hand ASC LIMIT 8", [user.shopId]),
    pool.query("SELECT COUNT(*)::int AS count FROM customers WHERE shop_id=$1 AND active=true", [user.shopId]),
    pool.query("SELECT COUNT(*)::int AS count FROM shop_users WHERE shop_id=$1", [user.shopId]),
  ]);
  res.json({ user, metrics: { salesToday: Number(sales.rows[0].total), transactionsToday: sales.rows[0].count, productCount: products.rows[0].count, stockValue: Number(products.rows[0].stock_value), customerCount: customers.rows[0].count, userCount: users.rows[0].count }, lowStock: lowStock.rows.map((p) => ({ ...p, sellingPrice: Number(p.selling_price), quantityOnHand: p.quantity_on_hand, minimumStock: p.minimum_stock })) });
});
app.get("/api/products", requireAuth(), async (req, res) => { const user = (req as Request & { user: User }).user; const result = await pool.query("SELECT p.id,p.name,p.sku,c.name AS category,p.selling_price,p.quantity_on_hand,p.minimum_stock FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.shop_id=$1 AND p.active=true ORDER BY p.name", [user.shopId]); res.json({ products: result.rows.map((p) => ({ ...p, sellingPrice: Number(p.selling_price), quantityOnHand: p.quantity_on_hand, minimumStock: p.minimum_stock })) }); });
app.post("/api/orders", requireAuth(["CUSTOMER"]), async (req, res) => { const user = (req as Request & { user: User }).user; const items = Array.isArray(req.body?.items) ? req.body.items : []; if (!items.length) return res.status(400).json({ error: "Your cart is empty." }); const client = await pool.connect(); try { await client.query("BEGIN"); let subtotal = 0; const lines: any[] = []; for (const item of items) { const p = (await client.query("SELECT id,name,selling_price,quantity_on_hand,cost_price FROM products WHERE id=$1 AND shop_id=$2 AND active=true FOR UPDATE", [item.productId, user.shopId])).rows[0]; const quantity = Math.max(1, Number(item.quantity)); if (!p || p.quantity_on_hand < quantity) throw new Error(`${p?.name || "Product"} does not have enough stock.`); subtotal += Number(p.selling_price) * quantity; lines.push({ ...p, quantity }); } const receipt = `WEB-${Date.now()}`; const sale = (await client.query("INSERT INTO sales (shop_id,cashier_id,receipt_number,subtotal,total) VALUES ($1,$2,$3,$4,$4) RETURNING id,total", [user.shopId, user.id, receipt, subtotal])).rows[0]; for (const p of lines) { await client.query("INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,cost_price) VALUES ($1,$2,$3,$4,$5)", [sale.id, p.id, p.quantity, p.selling_price, p.cost_price]); await client.query("UPDATE products SET quantity_on_hand=quantity_on_hand-$1 WHERE id=$2", [p.quantity, p.id]); await client.query("INSERT INTO stock_movements (shop_id,product_id,movement_type,quantity_change,quantity_after,reference_id,created_by) SELECT $1,id,'SALE',$2,quantity_on_hand,$3,$4 FROM products WHERE id=$5", [user.shopId, -p.quantity, sale.id, user.id, p.id]); } await client.query("INSERT INTO payments (sale_id,method,amount) VALUES ($1,'CASH',$2)", [sale.id, subtotal]); await client.query("COMMIT"); res.status(201).json({ receipt, total: Number(sale.total) }); } catch (error: any) { await client.query("ROLLBACK"); res.status(400).json({ error: error.message || "Could not place order." }); } finally { client.release(); } });
app.post("/api/ai/ask", requireAuth(), async (req, res) => { const user = (req as Request & { user: User }).user; const question = String(req.body?.question || "").trim(); if (!question) return res.status(400).json({ error: "Ask a question about your shop." }); const context = await pool.query("SELECT COUNT(*)::int AS products, COALESCE(SUM(quantity_on_hand*cost_price),0) AS stock_value, COUNT(*) FILTER (WHERE quantity_on_hand <= minimum_stock)::int AS low_stock FROM products WHERE shop_id=$1 AND active=true", [user.shopId]); const c = context.rows[0]; if (process.env.OPENAI_API_KEY) { try { const response = await fetch(`${process.env.OPENAI_API_BASE || "https://api.openai.com/v1"}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-5-mini", messages: [{ role: "system", content: `You are Spaza FEVER Intelligence. Shop context: ${c.products} active products, stock value ${c.stock_value}, ${c.low_stock} low-stock products. Give practical retail advice.` }, { role: "user", content: question }] }) }); const json: any = await response.json(); if (response.ok) return res.json({ answer: json.choices?.[0]?.message?.content || "I could not generate an answer." }); } catch {} } const low = Number(c.low_stock); const answer = low ? `Your shop has ${low} low-stock product${low === 1 ? "" : "s"}. I recommend checking replenishment before the next busy period. You currently have ${c.products} active products with stock value R${Number(c.stock_value).toFixed(2)}.` : `Stock is currently above the minimum levels across your active range. You have ${c.products} products and an estimated stock value of R${Number(c.stock_value).toFixed(2)}. Ask me about sales, stock, or reordering.`; res.json({ answer }); });

// Shop-management REST API. Every query is scoped through the signed session's shop_id.
app.get("/api/categories", requireAuth(), async (req, res) => { const user = (req as Request & { user: User }).user; const result = await pool.query("SELECT id,name,active FROM categories WHERE shop_id=$1 ORDER BY name", [user.shopId]); res.json({ categories: result.rows }); });
app.post("/api/categories", requireAuth(["MANAGER", "ADMIN"]), async (req, res) => { const user = (req as Request & { user: User }).user; const name = String(req.body?.name || "").trim(); if (!name) return res.status(400).json({ error: "Category name is required." }); try { const result = await pool.query("INSERT INTO categories (shop_id,name) VALUES ($1,$2) RETURNING id,name,active", [user.shopId, name]); res.status(201).json({ category: result.rows[0] }); } catch (error: any) { res.status(error?.code === "23505" ? 409 : 400).json({ error: "Category already exists or could not be created." }); } });
app.get("/api/suppliers", requireAuth(), async (req, res) => { const user = (req as Request & { user: User }).user; const result = await pool.query("SELECT id,name,phone,email,address,active FROM suppliers WHERE shop_id=$1 ORDER BY name", [user.shopId]); res.json({ suppliers: result.rows }); });
app.post("/api/suppliers", requireAuth(["MANAGER", "ADMIN"]), async (req, res) => { const user = (req as Request & { user: User }).user; const { name, phone, email, address } = req.body || {}; if (!name) return res.status(400).json({ error: "Supplier name is required." }); const result = await pool.query("INSERT INTO suppliers (shop_id,name,phone,email,address) VALUES ($1,$2,$3,$4,$5) RETURNING *", [user.shopId, name, phone || null, email || null, address || null]); res.status(201).json({ supplier: result.rows[0] }); });
app.post("/api/products", requireAuth(["MANAGER", "ADMIN"]), async (req, res) => { const user = (req as Request & { user: User }).user; const { name, sku, barcode, categoryId, supplierId, unit = "item", costPrice = 0, sellingPrice, quantityOnHand = 0, minimumStock = 0 } = req.body || {}; if (!name || sellingPrice === undefined) return res.status(400).json({ error: "Product name and selling price are required." }); try { const result = await pool.query("INSERT INTO products (shop_id,name,sku,barcode,category_id,supplier_id,unit,cost_price,selling_price,quantity_on_hand,minimum_stock) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *", [user.shopId, name, sku || null, barcode || null, categoryId || null, supplierId || null, unit, costPrice, sellingPrice, quantityOnHand, minimumStock]); await pool.query("INSERT INTO audit_logs (shop_id,user_id,action,entity_type,entity_id,details) VALUES ($1,$2,'CREATE','PRODUCT',$3,$4)", [user.shopId, user.id, result.rows[0].id, JSON.stringify({ name })]); res.status(201).json({ product: result.rows[0] }); } catch { res.status(400).json({ error: "Could not create product. Check SKU, barcode, prices, and references." }); } });
app.patch("/api/products/:id", requireAuth(["MANAGER", "ADMIN"]), async (req, res) => { const user = (req as Request & { user: User }).user; const allowed = ["name", "sku", "barcode", "category_id", "supplier_id", "unit", "cost_price", "selling_price", "minimum_stock", "active"]; const entries = Object.entries(req.body || {}).filter(([key, value]) => allowed.includes(key) && value !== undefined); if (!entries.length) return res.status(400).json({ error: "No editable product fields supplied." }); const set = entries.map(([key], index) => `${key}=$${index + 1}`).join(","); const values = entries.map(([, value]) => value); values.push(req.params.id, user.shopId); const result = await pool.query(`UPDATE products SET ${set},updated_at=NOW() WHERE id=$${values.length - 1} AND shop_id=$${values.length} RETURNING *`, values); if (!result.rows[0]) return res.status(404).json({ error: "Product not found." }); res.json({ product: result.rows[0] }); });
app.put("/api/products/:id", requireAuth(["MANAGER", "ADMIN"]), async (req, res) => { const user = (req as Request & { user: User }).user; const { name, sku, barcode, categoryId, supplierId, unit = "item", costPrice = 0, sellingPrice, minimumStock = 0, active = true } = req.body || {}; if (!name || sellingPrice === undefined) return res.status(400).json({ error: "Product name and selling price are required for a full update." }); const result = await pool.query("UPDATE products SET name=$1,sku=$2,barcode=$3,category_id=$4,supplier_id=$5,unit=$6,cost_price=$7,selling_price=$8,minimum_stock=$9,active=$10,updated_at=NOW() WHERE id=$11 AND shop_id=$12 RETURNING *", [name, sku || null, barcode || null, categoryId || null, supplierId || null, unit, costPrice, sellingPrice, minimumStock, active, req.params.id, user.shopId]); if (!result.rows[0]) return res.status(404).json({ error: "Product not found." }); res.json({ product: result.rows[0] }); });
app.delete("/api/products/:id", requireAuth(["MANAGER", "ADMIN"]), async (req, res) => { const user = (req as Request & { user: User }).user; const result = await pool.query("UPDATE products SET active=false,updated_at=NOW() WHERE id=$1 AND shop_id=$2 RETURNING id", [req.params.id, user.shopId]); if (!result.rows[0]) return res.status(404).json({ error: "Product not found." }); res.json({ ok: true }); });
app.get("/api/stock/movements", requireAuth(["MANAGER", "ADMIN"]), async (req, res) => { const user = (req as Request & { user: User }).user; const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30)); const result = await pool.query("SELECT sm.id,sm.movement_type,sm.quantity_change,sm.quantity_after,sm.notes,sm.created_at,p.name AS product_name,u.full_name AS created_by FROM stock_movements sm JOIN products p ON p.id=sm.product_id LEFT JOIN users u ON u.id=sm.created_by WHERE sm.shop_id=$1 ORDER BY sm.created_at DESC LIMIT $2", [user.shopId, limit]); res.json({ movements: result.rows }); });
app.post("/api/purchases", requireAuth(["MANAGER", "ADMIN"]), async (req, res) => { const user = (req as Request & { user: User }).user; const { supplierId, invoiceNumber, notes, items } = req.body || {}; if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "At least one purchase item is required." }); const client = await pool.connect(); try { await client.query("BEGIN"); let total = 0; const purchase = (await client.query("INSERT INTO purchases (shop_id,supplier_id,invoice_number,created_by,notes) VALUES ($1,$2,$3,$4,$5) RETURNING id", [user.shopId, supplierId || null, invoiceNumber || null, user.id, notes || null])).rows[0]; for (const item of items) { const quantity = Math.floor(Number(item.quantity)); const unitCost = Number(item.unitCost); if (!item.productId || quantity <= 0 || unitCost < 0) throw new Error("Invalid purchase item."); const product = (await client.query("SELECT id,quantity_on_hand FROM products WHERE id=$1 AND shop_id=$2 FOR UPDATE", [item.productId, user.shopId])).rows[0]; if (!product) throw new Error("Purchase product does not belong to this shop."); total += quantity * unitCost; const updated = (await client.query("UPDATE products SET quantity_on_hand=quantity_on_hand+$1,cost_price=$2,updated_at=NOW() WHERE id=$3 RETURNING quantity_on_hand", [quantity, unitCost, product.id])).rows[0]; await client.query("INSERT INTO purchase_items (purchase_id,product_id,quantity,unit_cost) VALUES ($1,$2,$3,$4)", [purchase.id, product.id, quantity, unitCost]); await client.query("INSERT INTO stock_movements (shop_id,product_id,movement_type,quantity_change,quantity_after,reference_id,created_by,notes) VALUES ($1,$2,'PURCHASE',$3,$4,$5,$6,$7)", [user.shopId, product.id, quantity, updated.quantity_on_hand, purchase.id, user.id, "Purchase received"]); } const saved = (await client.query("UPDATE purchases SET total_amount=$1 WHERE id=$2 RETURNING *", [total, purchase.id])).rows[0]; await client.query("COMMIT"); res.status(201).json({ purchase: saved }); } catch (error: any) { await client.query("ROLLBACK"); res.status(400).json({ error: error.message || "Could not record purchase." }); } finally { client.release(); } });
app.get("/api/sales", requireAuth(["MANAGER", "ADMIN"]), async (req, res) => { const user = (req as Request & { user: User }).user; const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30)); const result = await pool.query("SELECT s.id,s.receipt_number,s.subtotal,s.discount,s.total,s.status,s.sold_at,u.full_name AS cashier FROM sales s LEFT JOIN users u ON u.id=s.cashier_id WHERE s.shop_id=$1 ORDER BY s.sold_at DESC LIMIT $2", [user.shopId, limit]); res.json({ sales: result.rows.map((row) => ({ ...row, subtotal: Number(row.subtotal), discount: Number(row.discount), total: Number(row.total) })) }); });
app.get("/api/reports/summary", requireAuth(["MANAGER", "ADMIN"]), async (req, res) => { const user = (req as Request & { user: User }).user; const days = Math.min(90, Math.max(1, Number(req.query.days) || 30)); const [daily, best, expenses] = await Promise.all([pool.query("SELECT DATE(sold_at) AS date,COALESCE(SUM(total),0) AS revenue,COUNT(*)::int AS transactions FROM sales WHERE shop_id=$1 AND status='COMPLETED' AND sold_at >= CURRENT_DATE-$2::int GROUP BY DATE(sold_at) ORDER BY date", [user.shopId, days]), pool.query("SELECT p.id,p.name,SUM(si.quantity)::int AS units_sold,COALESCE(SUM(si.line_total),0) AS revenue FROM sale_items si JOIN sales s ON s.id=si.sale_id JOIN products p ON p.id=si.product_id WHERE s.shop_id=$1 AND s.status='COMPLETED' AND s.sold_at >= CURRENT_DATE-$2::int GROUP BY p.id,p.name ORDER BY units_sold DESC LIMIT 10", [user.shopId, days]), pool.query("SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE shop_id=$1 AND expense_date >= CURRENT_DATE-$2::int", [user.shopId, days])]); res.json({ daily: daily.rows.map((row) => ({ ...row, revenue: Number(row.revenue) })), bestSellers: best.rows.map((row) => ({ ...row, revenue: Number(row.revenue) })), expenses: Number(expenses.rows[0].total) }); });
app.get("/api/expenses", requireAuth(["MANAGER", "ADMIN"]), async (req, res) => { const user = (req as Request & { user: User }).user; const result = await pool.query("SELECT id,category,description,amount,expense_date,created_at FROM expenses WHERE shop_id=$1 ORDER BY expense_date DESC,created_at DESC LIMIT 100", [user.shopId]); res.json({ expenses: result.rows.map((row) => ({ ...row, amount: Number(row.amount) })) }); });
app.post("/api/expenses", requireAuth(["MANAGER", "ADMIN"]), async (req, res) => { const user = (req as Request & { user: User }).user; const { category, description, amount, expenseDate } = req.body || {}; if (!category || !description || Number(amount) <= 0) return res.status(400).json({ error: "Category, description, and a positive amount are required." }); const result = await pool.query("INSERT INTO expenses (shop_id,category,description,amount,expense_date,recorded_by) VALUES ($1,$2,$3,$4,COALESCE($5::date,CURRENT_DATE),$6) RETURNING *", [user.shopId, category, description, amount, expenseDate || null, user.id]); res.status(201).json({ expense: result.rows[0] }); });
app.get("/api/customers", requireAuth(), async (req, res) => { const user = (req as Request & { user: User }).user; const result = await pool.query("SELECT id,name,phone,email,active,created_at FROM customers WHERE shop_id=$1 ORDER BY name", [user.shopId]); res.json({ customers: result.rows }); });
app.post("/api/customers", requireAuth(), async (req, res) => { const user = (req as Request & { user: User }).user; const { name, phone, email } = req.body || {}; if (!name) return res.status(400).json({ error: "Customer name is required." }); const result = await pool.query("INSERT INTO customers (shop_id,name,phone,email) VALUES ($1,$2,$3,$4) RETURNING *", [user.shopId, name, phone || null, email || null]); res.status(201).json({ customer: result.rows[0] }); });
app.get("/api/users", requireSessionAuth(["ADMIN"]), async (req, res) => {
  const user = (req as Request & { user: User }).user;
  const result = await pool.query("SELECT u.id,u.full_name,u.email,u.role,u.active,u.created_at,su.joined_at FROM users u JOIN shop_users su ON su.user_id=u.id WHERE su.shop_id=$1 ORDER BY u.full_name", [user.shopId]);
  res.json({ users: result.rows.map((row) => ({ id: row.id, fullName: row.full_name, email: row.email, role: roleFromDatabase(row.role), active: row.active, createdAt: row.created_at, joinedAt: row.joined_at })) });
});
app.post("/api/users", requireSessionAuth(["ADMIN"]), async (req, res) => {
  const actor = (req as Request & { user: User }).user;
  const { fullName, email, password, role } = req.body || {};
  if (typeof fullName !== "string" || !fullName.trim() || fullName.trim().length > 150 || typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email.trim()) || typeof password !== "string" || password.length < 12 || !["CUSTOMER", "MANAGER", "ADMIN"].includes(role)) return res.status(400).json({ error: "Provide a name, valid email, password of at least 12 characters, and role CUSTOMER, MANAGER, or ADMIN." });
  const dbRole = role === "ADMIN" ? "ADMIN" : role === "MANAGER" ? "MANAGER" : "CASHIER";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query("INSERT INTO users (full_name,email,password_hash,role) VALUES ($1,$2,$3,$4) RETURNING id,full_name,email,role,active,created_at", [fullName.trim(), email.trim().toLowerCase(), hashPassword(password), dbRole]);
    const created = inserted.rows[0];
    await client.query("INSERT INTO shop_users (shop_id,user_id) VALUES ($1,$2)", [actor.shopId, created.id]);
    await client.query("INSERT INTO audit_logs (shop_id,user_id,action,entity_type,entity_id,details) VALUES ($1,$2,'CREATE_TEAM_MEMBER','USER',$3,$4)", [actor.shopId, actor.id, created.id, JSON.stringify({ email: created.email, role })]);
    await client.query("COMMIT");
    res.status(201).json({ user: { id: created.id, fullName: created.full_name, email: created.email, role: roleFromDatabase(created.role), active: created.active, createdAt: created.created_at } });
  } catch (error: any) {
    await client.query("ROLLBACK");
    res.status(error?.code === "23505" ? 409 : 400).json({ error: error?.code === "23505" ? "That email is already registered." : "Could not create team account." });
  } finally { client.release(); }
});
app.patch("/api/users/:id", requireSessionAuth(["ADMIN"]), async (req, res) => {
  const actor = (req as Request & { user: User }).user;
  const { role, active } = req.body || {};
  if ((role === undefined && active === undefined) || (role !== undefined && !["CUSTOMER", "MANAGER", "ADMIN"].includes(role)) || (active !== undefined && typeof active !== "boolean")) return res.status(400).json({ error: "Provide a valid role, active flag, or both." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [actor.shopId]);
    const target = (await client.query("SELECT u.id,u.role,u.active FROM users u JOIN shop_users su ON su.user_id=u.id WHERE u.id=$1 AND su.shop_id=$2 FOR UPDATE OF u", [req.params.id, actor.shopId])).rows[0];
    if (!target) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Team member not found in this shop." }); }
    const nextRole: AppRole = role ?? roleFromDatabase(target.role);
    const nextActive = active ?? target.active;
    if (target.id === actor.id && (nextRole !== "ADMIN" || !nextActive)) { await client.query("ROLLBACK"); return res.status(400).json({ error: "You cannot remove your own Admin access or deactivate your own account." }); }
    const removingAdmin = roleFromDatabase(target.role) === "ADMIN" && (nextRole !== "ADMIN" || !nextActive);
    if (removingAdmin) {
      const admins = await client.query("SELECT COUNT(*)::int AS count FROM users u JOIN shop_users su ON su.user_id=u.id WHERE su.shop_id=$1 AND u.active=true AND u.role IN ('ADMIN','OWNER') AND u.password_hash <> 'NOT_A_REAL_BCRYPT_HASH_CHANGE_THIS'", [actor.shopId]);
      if (Number(admins.rows[0].count) <= 1) { await client.query("ROLLBACK"); return res.status(409).json({ error: "The shop must retain at least one active Admin." }); }
    }
    const dbRole = nextRole === "ADMIN" ? "ADMIN" : nextRole === "MANAGER" ? "MANAGER" : "CASHIER";
    const updated = (await client.query("UPDATE users SET role=$1,active=$2,updated_at=NOW() WHERE id=$3 RETURNING id,full_name,email,role,active,created_at", [dbRole, nextActive, target.id])).rows[0];
    await client.query("INSERT INTO audit_logs (shop_id,user_id,action,entity_type,entity_id,details) VALUES ($1,$2,'UPDATE_TEAM_MEMBER','USER',$3,$4)", [actor.shopId, actor.id, target.id, JSON.stringify({ role: nextRole, active: nextActive })]);
    await client.query("COMMIT");
    res.json({ user: { id: updated.id, fullName: updated.full_name, email: updated.email, role: roleFromDatabase(updated.role), active: updated.active, createdAt: updated.created_at } });
  } catch {
    await client.query("ROLLBACK");
    res.status(400).json({ error: "Could not update team account." });
  } finally { client.release(); }
});
app.get("/api/audit-logs", requireSessionAuth(["ADMIN"]), async (req, res) => { const user = (req as Request & { user: User }).user; const result = await pool.query("SELECT al.id,al.action,al.entity_type,al.entity_id,al.details,al.created_at,u.full_name AS user_name FROM audit_logs al LEFT JOIN users u ON u.id=al.user_id WHERE al.shop_id=$1 ORDER BY al.created_at DESC LIMIT 100", [user.shopId]); res.json({ logs: result.rows }); });

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(currentDir, "../client");
if (process.env.NODE_ENV === "production") { app.use(express.static(clientDist)); app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html"))); }
app.listen(port, "0.0.0.0", () => console.log(`Spaza FEVER Intelligence API listening on port ${port}`));
