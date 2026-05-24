const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");
const { databaseHealth } = require("./database.cjs");
const {
  adjustInventory,
  allocateSerial,
  apiRequest,
  cloudPull,
  cloudPush,
  reconcileInventoryBalances,
  saveSaleToDatabase,
} = require("./cloudSync.cjs");

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

ipcMain.handle("db:health", () => databaseHealth());
ipcMain.handle("cloud:pull", (_event, payload) => cloudPull(payload));
ipcMain.handle("cloud:push", (_event, payload) => cloudPush(payload));
ipcMain.handle("image:create-upload-url", async (_event, payload) => {
  const result = await apiRequest("/images/upload-url", payload);
  if (!result) throw new Error("API_BASE_URL is not configured.");
  return result;
});
ipcMain.handle("image:register-asset", async (_event, payload) => {
  const result = await apiRequest("/images/register", payload);
  if (!result) throw new Error("API_BASE_URL is not configured.");
  return result;
});
ipcMain.handle("invoice:save-document", async (_event, payload) => {
  const result = await apiRequest("/invoices/document", payload);
  if (!result) throw new Error("API_BASE_URL is not configured.");
  return result;
});
ipcMain.handle("order:save-document", async (_event, payload) => {
  const result = await apiRequest("/orders/document", payload);
  if (!result) throw new Error("API_BASE_URL is not configured.");
  return result;
});
ipcMain.handle("inventory:adjust", async (_event, payload) => {
  const result = await apiRequest("/inventory/adjust", payload);
  if (result) return result;
  return adjustInventory({ ...payload, skipApi: true });
});
ipcMain.handle("inventory:reconcile", async (_event, payload) => {
  const result = await apiRequest("/inventory/reconcile", payload);
  if (result) return result;
  return reconcileInventoryBalances({ ...payload, skipApi: true });
});
ipcMain.handle("serial:next", async (_event, payload) => {
  const result = await apiRequest("/serial/next", payload);
  if (result) return result;
  return allocateSerial({ ...payload, skipApi: true });
});
ipcMain.handle("sales:save", async (_event, payload) => {
  const result = await apiRequest("/sales/save", payload);
  if (result) return result;
  return saveSaleToDatabase({ ...payload, skipApi: true });
});

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1100,
    minHeight: 720,
    title: "Pavilion Textile CMS",
    backgroundColor: "#f8fafc",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("blob:") || url.startsWith("data:application/pdf")) {
      return { action: "allow" };
    }
    if (/^(https?:|mailto:)/i.test(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
    return;
  }

  mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
