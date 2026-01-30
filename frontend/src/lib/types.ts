export interface Product {
  product_id: string;
  name: string;
  category: string;
  price: number;
  qty: number;
  updated_at: string;
}

export type ProductCreateInput = {
  name: string;
  category: string;
  price: number;
  qty: number;
};

export type ProductUpdateInput = {
  name: string;
  category: string;
  price: number;
};

export interface StockHistory {
  id: string;
  product_id: string;
  type: "in" | "out";
  quantity: number;
  note: string;
  created_at: string;
}

export type ProductInput = ProductCreateInput | ProductUpdateInput;

export type StockStatus = "out-of-stock" | "danger" | "warning" | "normal";

export interface Settings {
  threshold: number;
  itemsPerPage: number;
  theme: "light" | "dark" | "system";
}

export interface Toast {
  id: string;
  type: "success" | "error" | "warning" | "info";
  message: string;
}
