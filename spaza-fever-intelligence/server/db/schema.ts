/**
 * The authoritative schema is the uploaded PostgreSQL SQL package in
 * database/init/001_schema.sql. Runtime queries use parameterized SQL through pg.
 */
export type DbRole = "OWNER" | "MANAGER" | "CASHIER" | "ADMIN";
export type AppRole = "CUSTOMER" | "MANAGER" | "ADMIN";

export interface SessionUser {
  id: string;
  fullName: string;
  email: string;
  role: AppRole;
  shopId: string;
  shopName: string;
}
