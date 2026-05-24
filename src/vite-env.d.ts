/// <reference types="vite/client" />

interface Window {
  desktopApp?: {
    isDesktop: boolean;
    platform: NodeJS.Platform;
    databaseHealth: () => Promise<{
      ok: boolean;
      configured: boolean;
      message?: string;
      databaseName?: string;
      userName?: string;
    }>;
    cloudPull: (payload?: {
      keys?: string[];
      clientId?: string;
    }) => Promise<{
      ok: boolean;
      records: Array<{
        key: string;
        raw: string | null;
        updatedAt: string;
        clientId?: string | null;
      }>;
      serverTime: string;
    }>;
    cloudPush: (payload?: {
      clientId?: string;
      records?: Array<{
        key: string;
        raw: string | null;
      }>;
    }) => Promise<{
      ok: boolean;
      pushed: number;
      serverTime: string;
    }>;
    createImageUploadUrl: (payload: {
      fileName: string;
      contentType?: string;
    }) => Promise<{
      uploadUrl: string;
      method: "PUT";
      headers: Record<string, string>;
      expiresIn: number;
      asset: {
        productId?: string | null;
        skuId?: string | null;
        modelCode: string;
        skuCode: string;
        imageCode: string;
        imageRole: string;
        fileName: string;
        directoryKey: string;
        cloudKey: string;
        url: string;
        mimeType: string;
        bucketName: string;
        basePrefix: string;
      };
    }>;
    registerImageAsset: (payload: {
      asset: Record<string, unknown>;
    }) => Promise<{
      ok: boolean;
      asset: Record<string, unknown>;
    }>;
    saveInvoiceDocument: (payload: {
      sale: unknown;
      fileName: string;
      pdfBase64: string;
    }) => Promise<{
      ok: boolean;
      document?: Record<string, unknown>;
      url?: string;
    }>;
    saveOrderDocument: (payload: {
      sale: unknown;
      documentType: "SHIPPING_LABEL";
      documentNumber?: string;
      fileName: string;
      pdfBase64: string;
    }) => Promise<{
      ok: boolean;
      document?: Record<string, unknown>;
      url?: string;
    }>;
    adjustInventory: (payload: {
      id?: string;
      productId: string;
      sku?: string;
      movementType: string;
      previousQty?: number;
      quantityChange: number;
      newQty: number;
      reason?: string;
      warehouse?: string;
      location?: string;
      notes?: string;
      actor?: string;
      documentId?: string;
    }) => Promise<{
      ok: boolean;
      movement?: {
        id?: string;
        createdAt?: number;
        [key: string]: unknown;
      };
      previousQty?: number;
      quantityChange?: number;
      newQty?: number;
    }>;
    reconcileInventory: (payload?: {
      actor?: string;
    }) => Promise<{
      ok: boolean;
      balances?: number;
    }>;
    allocateSerial: (payload: {
      documentType: "INVOICE" | "RECEIPT" | "DELIVERY_NOTE" | "PROFORMA";
      prefix?: string;
      counter?: number;
    }) => Promise<{
      ok: boolean;
      documentType: string;
      serial: string;
      nextCounter: number;
    }>;
    saveSale: (payload: {
      sale: unknown;
      previousSale?: unknown;
      operation?: string;
      actor?: string;
    }) => Promise<{
      ok: boolean;
      sale?: unknown;
      orderId?: string;
      invoiceId?: string;
      serverTime?: string;
    }>;
  };
}
