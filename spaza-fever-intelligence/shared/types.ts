export type AppRole = "CUSTOMER" | "MANAGER" | "ADMIN";

export interface SessionUser {
  id: string;
  fullName: string;
  email: string;
  role: AppRole;
  shopId: string;
  shopName: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  sellingPrice: number;
  quantityOnHand: number;
  minimumStock: number;
}
