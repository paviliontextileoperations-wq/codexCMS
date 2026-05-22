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
  };
}
