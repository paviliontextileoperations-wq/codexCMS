export type Product = {
  id: string;
  barcode: string;
  name: string;
  sku: string;
  category: string;
  fineCategory?: string;
  category2?: string;
  category3?: string;
  description?: string;
  size?: string;
  color?: string;
  price: number;
  cost?: number;
  /** B2C markup as a decimal, e.g. 0.5 for +50%. Applied to price for B2C customers. */
  b2cMarkup?: number;
  /** Explicit B2C price override (otherwise derived from price * (1 + markup)). */
  b2cPrice?: number;
  /** Material composition entries; percentages should sum to 100. */
  composition?: { material: string; percentage: number }[];
  stock: number;
  lowStockThreshold: number;
  /** Optional secondary/external SKU (manufacturer, barcode reference, etc). */
  otherSku?: string;
  /** Weight in grams. */
  weight?: string;
  /** Per-variation length measurements. */
  lengthA?: string;
  lengthB?: string;
  lengthC?: string;
  lengthD?: string;
  lengthE?: string;
  lengthF?: string;
  lengthG?: string;
  lengthH?: string;
  /** Main product picture (data URL). Shared across all variations of the same model. */
  mainImage?: string;
  /** Per-variation/SKU picture (data URL). */
  image?: string;
  /** Temporary POS-created product awaiting product maintenance. */
  temporaryProduct?: boolean;
  maintenanceStatus?: "open" | "pending_approval" | "approved";
  maintenanceReason?: string;
  maintenanceNote?: string;
  maintenanceRequestedBy?: string;
  maintenanceApprovedBy?: string;
  maintenanceApprovedAt?: number;
  associatedSku?: string;
  createdAt: number;
  updatedAt?: number;
};

export const BUSINESS_TYPES = [
  "ESP AUTONOMO",
  "ESP EMPRESA",
  "EU VAT",
  "EU LOCAL",
  "INTERNATIONAL",
] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export type ClientType = "B2B" | "B2C";

/**
 * Document type produced by a sale.
 * - INVOICE: full B2B invoice (tax included)
 * - DELIVERY_NOTE: B2B "nota" delivery note (no tax)
 * - RECEIPT: B2C consumer receipt (tax included)
 * - PROFORMA: B2B proforma document that can later become an invoice
 */
export type SaleDocumentType = "INVOICE" | "DELIVERY_NOTE" | "RECEIPT" | "PROFORMA";

export type Address = {
  line1: string;
  line2?: string;
  additionalInfo?: string;
  postalCode: string;
  provinceState: string;
  country: string;
};

export type Customer = {
  id: string;
  /** Client classification. Defaults to B2B for legacy records. */
  clientType?: ClientType;
  name: string;
  surname?: string;
  businessType?: BusinessType;
  businessName?: string;
  email?: string;
  vatNumber?: string;
  /** Country dial code, e.g. "+34" */
  phoneCountryCode?: string;
  phoneNumber?: string;
  /** Combined display phone (kept in sync for search/back-compat). */
  phone: string;
  fiscalAddress?: Address;
  logisticsAddress?: Address;
  /** Legacy single-line address (kept for older sales records). */
  address?: string;
  /** Custom tax rate as a percentage (0-100). Overrides the default for the customer's clientType. */
  taxRate?: number;
  createdAt: number;
  updatedAt?: number;
};

export type SaleLine = {
  productId: string;
  barcode: string;
  name: string;
  size?: string;
  color?: string;
  unitPrice: number;
  quantity: number;
  /** Per-line discount as a percentage (0-100). Applied to unitPrice * quantity. */
  discountPct?: number;
};

export type PaymentStatus = "PAID" | "PARTIAL" | "OPEN";
export type PaymentMethod = "CASH" | "CARD" | "TRANSFER" | "OTHER";

export type PaymentEntry = {
  id: string;
  amount: number;
  method: PaymentMethod;
  note?: string;
  /** Optional explicit payment date (ms epoch). Falls back to createdAt for legacy records. */
  paymentDate?: number;
  /** Optional bank/card transaction reference. */
  reference?: string;
  createdAt: number;
};

/** Document workflow status, independent from payment & delivery. */
export type DocumentStatus = "draft" | "open" | "cancelled" | "converted";

/** Delivery / fulfilment status. */
export type DeliveryStatus =
  | "open"
  | "preparing"
  | "pending_pickup"
  | "product_sent"
  | "pending_reception"
  | "completed"
  | "pending_pickup_client"
  | "picked_up_client"
  | "not_prepared"
  | "prepared"
  | "delivered"
  | "returned";

/** High-level sales channel where the order originated. */
export type SalesChannel =
  | "physical_store"
  | "whatsapp"
  | "website"
  | "instagram"
  | "phone"
  | "b2b_direct"
  | "marketplace"
  | "other";

/** Recorded return / refund entry against a sale line. */
export type ReturnEntry = {
  id: string;
  productId: string;
  quantity: number;
  reason?:
    | "customer_changed_mind"
    | "defective"
    | "wrong_size"
    | "wrong_item"
    | "damaged"
    | "other";
  condition?: "resellable" | "damaged" | "repair_needed";
  refundAmount: number;
  refundMethod?: PaymentMethod;
  stockAction: "back_to_stock" | "repair" | "discard" | "no_stock_change";
  notes?: string;
  createdAt: number;
};

export type InventoryMovementType =
  | "sale"
  | "return"
  | "cancel_restore"
  | "adjustment"
  | "initial_import"
  | "inbound"
  | "outbound"
  | "stocktake"
  | "transfer";

export type InventoryReasonCategory =
  | "purchase_inbound"
  | "supplier_arrival"
  | "customer_return"
  | "sales_outbound"
  | "supplier_return"
  | "stocktake_correction"
  | "damaged_or_lost"
  | "sample_or_internal"
  | "warehouse_transfer"
  | "custom";

export type InventoryLocation = {
  productId: string;
  warehouse: string;
  location: string;
  updatedAt: number;
};

/** Stock movement record (sale, return, manual adjustment, inbound/outbound, stock count). */
export type InventoryMovement = {
  id: string;
  movementType: InventoryMovementType;
  documentId?: string;
  productId: string;
  sku?: string;
  previousQty?: number;
  quantityChange: number;
  newQty?: number;
  reason?: InventoryReasonCategory;
  warehouse?: string;
  location?: string;
  notes?: string;
  createdAt: number;
  updatedAt?: number;
};

export type Sale = {
  id: string;
  invoiceNumber: string;
  /** Which kind of document this sale represents. Defaults to INVOICE for legacy records. */
  documentType?: SaleDocumentType;
  /** Workflow status (draft/open/cancelled/converted). Defaults to "open". */
  documentStatus?: DocumentStatus;
  /** Delivery / fulfilment status. Defaults to "open" for invoice/receipt, "not_prepared" for delivery_note. */
  deliveryStatus?: DeliveryStatus;
  /** Optional payment due date (ms epoch). */
  dueDate?: number;
  /** Optional internal/printed invoice note. */
  invoiceNotes?: string;
  /** Optional invoice tax profile for filtering and exports. */
  invoiceTaxProfile?:
    | "standard"
    | "b2b_spain"
    | "b2b_eu_vat"
    | "b2b_international"
    | "b2c"
    | "no_tax"
    | "custom";
  /** Where this order came from (POS / phone / WhatsApp …). */
  salesChannel?: SalesChannel;
  /** If this document was generated from another (e.g. invoice from delivery note), the parent id. */
  sourceDocumentId?: string;
  /** True once the underlying stock movement has been booked. Prevents double-deduction on convert. */
  stockMovementCreated?: boolean;
  /** Cancellation audit trail. */
  cancelledAt?: number;
  cancelledBy?: string;
  cancellationReason?: string;
  /** Recorded returns / refunds against this sale. */
  returns?: ReturnEntry[];
  customerId: string;
  customerSnapshot: Pick<
    Customer,
    "name" | "phone" | "vatNumber" | "email" | "address"
  > & {
    businessName?: string;
    fiscalAddress?: Address;
    logisticsAddress?: Address;
  };
  lines: SaleLine[];
  subtotal: number;
  taxRate: number;
  tax: number;
  /** Optional split of the tax rate into base VAT + recargo surcharge (decimals, e.g. 0.21 / 0.052). */
  taxBreakdown?: {
    vat: number;
    surcharge: number;
    vatAmount: number;
    surchargeAmount: number;
  };
  /** Optional transport / shipping info attached to the sale. */
  transport?: {
    method: "PICKUP" | "DELIVERY";
    label: string;
    fee: number;
  };
  total: number;
  paymentStatus: PaymentStatus;
  amountPaid: number;
  amountDue: number;
  payments: PaymentEntry[];
  createdAt: number;
  updatedAt?: number;
};
