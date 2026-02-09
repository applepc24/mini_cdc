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

export type CsvUploadOut = {
  id: number;
  owner_id: number;
  file_name: string;
  status: string;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  created_at?: string | null;
  updated_at?: string | null;
};

export type CsvUploadItemOut = {
  id: number;
  upload_id: number;
  owner_id: number;
  product_id: number;
  before_qty?: number | null;
  after_qty?: number | null;
  delta_qty?: number | null;
  issue_code: string;
  issue_msg?: string | null;
  created_at?: string | null;
  product_name?: string | null;
  product_category?: string | null;
};

export type CsvUploadDetailOut = {
  upload: CsvUploadOut;
  items: CsvUploadItemOut[];
  items_count: number;
};
