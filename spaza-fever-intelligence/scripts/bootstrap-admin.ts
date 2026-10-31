import "dotenv/config";
import crypto from "node:crypto";
import { createInterface as createPromiseInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function readHidden(prompt: string): Promise<string> {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error("Run this command directly in an interactive terminal so the password can be hidden.");
  }
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
    };
    const onData = (buffer: Buffer) => {
      for (const char of buffer.toString("utf8")) {
        if (char === "\u0003") { cleanup(); stdout.write("\n"); reject(new Error("Cancelled.")); return; }
        if (char === "\r" || char === "\n") { cleanup(); stdout.write("\n"); resolve(value); return; }
        if (char === "\u007f" || char === "\b") { value = value.slice(0, -1); continue; }
        if (char >= " ") value += char;
      }
    };
    stdin.on("data", onData);
  });
}

function passwordHash(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

async function main() {
  const prompt = createPromiseInterface({ input: stdin, output: stdout });
  try {
    const fullName = (await prompt.question("Admin full name: ")).trim();
    const email = (await prompt.question("Admin email: ")).trim().toLowerCase();
    prompt.close();
    const password = await readHidden("Admin password (at least 12 characters): ");
    const confirmation = await readHidden("Confirm password: ");
    if (!fullName || fullName.length > 150) throw new Error("Enter a name between 1 and 150 characters.");
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 150) throw new Error("Enter a valid email address.");
    if (password.length < 12) throw new Error("Password must be at least 12 characters.");
    if (password !== confirmation) throw new Error("Passwords do not match.");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('spaza-fever-bootstrap-admin'))");
      const existing = await client.query("SELECT id FROM users WHERE active=true AND role IN ('ADMIN','OWNER') AND password_hash <> 'NOT_A_REAL_BCRYPT_HASH_CHANGE_THIS' LIMIT 1");
      if (existing.rows[0]) throw new Error("An active Admin already exists. Use that account to provision team members.");

      const seededOwner = (await client.query("SELECT u.id,su.shop_id FROM users u JOIN shop_users su ON su.user_id=u.id WHERE u.role='OWNER' AND u.password_hash='NOT_A_REAL_BCRYPT_HASH_CHANGE_THIS' ORDER BY su.joined_at LIMIT 1 FOR UPDATE OF u")).rows[0];
      let userId: string;
      let shopId: string;
      if (seededOwner) {
        userId = seededOwner.id;
        shopId = seededOwner.shop_id;
        await client.query("UPDATE users SET full_name=$1,email=$2,password_hash=$3,role='ADMIN',active=true,updated_at=NOW() WHERE id=$4", [fullName, email, passwordHash(password), userId]);
      } else {
        const shop = (await client.query("SELECT id FROM shops WHERE active=true ORDER BY created_at LIMIT 1 FOR UPDATE")).rows[0];
        if (!shop) throw new Error("No active shop exists. Initialize the database first.");
        shopId = shop.id;
        const created = await client.query("INSERT INTO users (full_name,email,password_hash,role) VALUES ($1,$2,$3,'ADMIN') RETURNING id", [fullName, email, passwordHash(password)]);
        userId = created.rows[0].id;
        await client.query("INSERT INTO shop_users (shop_id,user_id) VALUES ($1,$2)", [shopId, userId]);
      }
      await client.query("INSERT INTO audit_logs (shop_id,user_id,action,entity_type,details) VALUES ($1,$2,'BOOTSTRAP_ADMIN','USER',$3)", [shopId, userId, JSON.stringify({ email })]);
      await client.query("COMMIT");
      stdout.write(`Admin account created for ${email}. You can now sign in and provision the team.\n`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    prompt.close();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Could not bootstrap Admin.");
  process.exitCode = 1;
});
