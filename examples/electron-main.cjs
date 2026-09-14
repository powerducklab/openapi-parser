/**
 * Electron main process demo (CommonJS).
 *
 * Works because this package ships a CJS build with the ESM-only Scalar
 * dependencies bundled in. The main process never sees an ESM specifier.
 */

const { app, BrowserWindow, ipcMain } = require("electron");
const {
  OpenApiUpgradeError,
  upgradeOasTo32,
} = require("@powerduckie/openapi-parser");

/**
 * Renderer sends a raw document, main returns either the upgraded document or
 * a structured failure. Errors are flattened because Error instances do not
 * survive the IPC boundary intact.
 */
ipcMain.handle("openapi:upgrade", async (_event, document) => {
  try {
    const upgraded = await upgradeOasTo32(document);
    return { ok: true, document: upgraded };
  } catch (error) {
    if (error instanceof OpenApiUpgradeError) {
      return {
        ok: false,
        message: error.message,
        issues: error.issues.map(
          (issue) => issue.message ?? JSON.stringify(issue),
        ),
      };
    }
    return { ok: false, message: String(error), issues: [] };
  }
});

const createWindow = () => {
  const window = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  void window.loadFile("index.html");
};

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
