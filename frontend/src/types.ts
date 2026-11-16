export interface Brand {
  id: string;
  name: string;
  code: string;
  logo_url?: string | null;
  color: string;
  currency: string;
  timezone: string;
  tax_rate: number;
  service_charge_rate: number;
}

export interface Outlet {
  id: string;
  name: string;
  code: string;
  address: string;
  phone: string;
  timezone: string;
}

export interface PosClient {
  id: string;
  code: string;
  name: string;
  kind: 'cashier' | 'order_station' | string;
  second_display: boolean;
  slideshow_interval_seconds: number;
  settings: Record<string, unknown>;
  app_version?: string;
}

export interface ProductGroup {
  id: string;
  name: string;
  color: string;
  icon: string;
  sort_order: number;
}

export interface Product {
  id: string;
  group_id: string;
  sku: string;
  name: string;
  description: string;
  price_cents: number;
  image_url?: string | null;
  color: string;
  emoji: string;
  sort_order: number;
}

export interface SalesMode {
  id: string;
  name: string;
  code: string;
  icon: string;
  color: string;
  template: 'table_service' | 'fast_food' | string;
  sort_order: number;
}

export interface FloorTable {
  id: string;
  table_type: string;
  number: string;
  name: string;
  seats: number;
  zone: string;
  sort_order: number;
}

export interface PaymentGroup {
  id: string;
  name: string;
  sort_order: number;
}

export interface PaymentType {
  id: string;
  group_id: string;
  code: string;
  name: string;
  method: string;
  icon: string;
  requires_reference: boolean;
  open_drawer: boolean;
  surcharge_rate: number;
  sort_order: number;
}

export interface Printer {
  id: string;
  name: string;
  purpose: string;
  ip: string;
  port: number;
  paper_width: number;
  model: string;
}

export interface Promotion {
  id: string;
  name: string;
  code: string;
  type: 'percentage' | 'fixed' | 'bogo' | string;
  scope: 'bill' | 'product' | 'group' | string;
  target_ids: string[];
  value: number;
  min_subtotal_cents: number;
  max_discount_cents: number | null;
  start_at?: string | null;
  end_at?: string | null;
  auto_apply: boolean;
}

export interface PosUser {
  id: string;
  nik: string;
  name: string;
  pin_hash?: string;
  role_id: string;
  role_name: string;
  is_admin: boolean;
  permissions: string[];
  avatar_color: string;
  brand_id?: string | null;
  outlet_id?: string | null;
}

export interface DisplayAsset {
  id: string;
  name: string;
  file_path: string;
  mime_type: string;
  size_bytes: number;
  checksum: string;
  sort_order: number;
  url: string;
}

export interface Bootstrap {
  client: PosClient;
  brand: Brand;
  outlet: Outlet;
  product_groups: ProductGroup[];
  products: Product[];
  sales_modes: SalesMode[];
  tables: FloorTable[];
  payment_groups: PaymentGroup[];
  payment_types: PaymentType[];
  printers: Printer[];
  promotions: Promotion[];
  users: PosUser[];
  display_assets: DisplayAsset[];
  server_time: string;
}

export interface CartLine {
  id: string;
  product: Product;
  qty: number;
  note: string;
}

export interface PaymentEntry {
  id: string;
  paymentType: PaymentType;
  amount_cents: number;
  reference: string;
}

export interface TicketItem {
  id: string;
  product_id: string | null;
  sku: string;
  name: string;
  qty: number;
  unit_price_cents: number;
  total_cents: number;
  note: string;
}

export interface OpenTicket {
  id: string;
  ticket_no: string;
  status: 'open' | 'claimed' | 'paid' | 'cancelled' | string;
  brand_id: string;
  outlet_id: string;
  client_id: string;
  created_by?: string | null;
  created_by_name: string;
  table_id?: string | null;
  table_name: string;
  sales_mode_id?: string | null;
  sales_mode_name: string;
  customer_name: string;
  note: string;
  subtotal_cents: number;
  created_at: string;
  claimed_by_name?: string;
  bill_id?: string | null;
  items: TicketItem[];
}

export interface Totals {
  subtotal_cents: number;
  promo_discount_cents: number;
  manual_discount_cents: number;
  discount_cents: number;
  service_cents: number;
  tax_cents: number;
  surcharge_cents: number;
  rounding_cents: number;
  total_cents: number;
}

export interface CompletedSale {
  client_bill_id: string;
  bill_no: string;
  brand: Brand;
  outlet: Outlet;
  client: PosClient;
  user: PosUser;
  ticket_id?: string;
  table_id?: string | null;
  table_name: string;
  sales_mode_id?: string | null;
  sales_mode_name: string;
  customer_name: string;
  note: string;
  created_at: string;
  paid_at: string;
  items: Array<{
    product_id?: string | null;
    sku: string;
    name: string;
    qty: number;
    unit_price_cents: number;
    discount_cents: number;
    total_cents: number;
    note: string;
  }>;
  payments: Array<{
    payment_type_id?: string | null;
    method: string;
    name: string;
    amount_cents: number;
    reference: string;
  }>;
  subtotal_cents: number;
  discount_cents: number;
  service_cents: number;
  tax_cents: number;
  rounding_cents: number;
  total_cents: number;
  paid_cents: number;
  change_cents: number;
  payment_summary: string;
  synced: boolean;
  ticket_no?: string;
}

export interface TicketReceipt {
  ticket_no: string;
  brand: Brand;
  outlet: Outlet;
  client: PosClient;
  user: PosUser;
  table_name: string;
  sales_mode_name: string;
  customer_name: string;
  note: string;
  items: TicketItem[];
  subtotal_cents: number;
  created_at: string;
}
