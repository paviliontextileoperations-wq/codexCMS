import type { jsPDF } from "jspdf";

export type PdfAction = "download" | "preview" | "print";

const PREVIEW_ROOT_ID = "pavilion-pdf-preview-root";

function removeExistingPreview() {
  document.getElementById(PREVIEW_ROOT_ID)?.remove();
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function printBlob(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const frame = document.createElement("iframe");
  let cleaned = false;
  let cleanupTimer: number | undefined;

  frame.src = url;
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.setAttribute("aria-hidden", "true");

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    window.clearTimeout(cleanupTimer);
    frame.remove();
    URL.revokeObjectURL(url);
  };

  const cleanupSoon = () => {
    window.clearTimeout(cleanupTimer);
    cleanupTimer = window.setTimeout(cleanup, 300);
  };

  frame.onload = () => {
    window.setTimeout(() => {
      const printWindow = frame.contentWindow;
      if (!printWindow) {
        cleanup();
        return;
      }

      printWindow.addEventListener("afterprint", cleanupSoon, { once: true });
      window.addEventListener("focus", cleanupSoon, { once: true });
      printWindow.focus();
      printWindow.print();

      cleanupTimer = window.setTimeout(cleanup, 15000);
    }, 250);
  };
  frame.onerror = cleanup;

  document.body.appendChild(frame);
}

function previewBlob(blob: Blob, filename: string, title: string) {
  removeExistingPreview();

  const url = URL.createObjectURL(blob);
  const root = document.createElement("div");
  root.id = PREVIEW_ROOT_ID;
  root.style.position = "fixed";
  root.style.inset = "0";
  root.style.zIndex = "2147483647";
  root.style.background = "rgba(20, 20, 20, 0.72)";
  root.style.display = "flex";
  root.style.flexDirection = "column";
  root.style.padding = "24px";
  root.style.boxSizing = "border-box";

  const panel = document.createElement("div");
  panel.style.width = "min(1120px, 96vw)";
  panel.style.height = "min(92vh, 920px)";
  panel.style.margin = "auto";
  panel.style.background = "#f8f7f4";
  panel.style.border = "2px solid #111";
  panel.style.display = "flex";
  panel.style.flexDirection = "column";
  panel.style.boxShadow = "0 24px 80px rgba(0, 0, 0, 0.35)";

  const bar = document.createElement("div");
  bar.style.display = "flex";
  bar.style.alignItems = "center";
  bar.style.justifyContent = "space-between";
  bar.style.gap = "12px";
  bar.style.padding = "12px 16px";
  bar.style.borderBottom = "2px solid #111";
  bar.style.background = "#fff";

  const heading = document.createElement("div");
  heading.textContent = title;
  heading.style.font = "700 15px Arial, sans-serif";
  heading.style.color = "#111";

  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "8px";

  const makeButton = (label: string, primary = false) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.style.height = "34px";
    button.style.padding = "0 14px";
    button.style.border = "2px solid #111";
    button.style.background = primary ? "#111" : "#fff";
    button.style.color = primary ? "#fff" : "#111";
    button.style.font = "700 12px Arial, sans-serif";
    button.style.cursor = "pointer";
    return button;
  };

  const download = makeButton("PDF");
  download.onclick = () => downloadBlob(blob, filename);

  const print = makeButton("Print");
  print.onclick = () => printBlob(blob);

  const close = makeButton("Close", true);
  const cleanup = () => {
    root.remove();
    URL.revokeObjectURL(url);
    window.removeEventListener("keydown", onKeyDown);
  };
  close.onclick = cleanup;

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") cleanup();
  }

  const frame = document.createElement("iframe");
  frame.src = url;
  frame.title = title;
  frame.style.flex = "1";
  frame.style.width = "100%";
  frame.style.border = "0";
  frame.style.background = "#fff";

  actions.append(download, print, close);
  bar.append(heading, actions);
  panel.append(bar, frame);
  root.append(panel);
  document.body.appendChild(root);
  window.addEventListener("keydown", onKeyDown);
}

export function outputPdfDocument(doc: jsPDF, filename: string, action: PdfAction, title = filename) {
  if (action === "download") {
    doc.save(filename);
    return;
  }

  const blob = doc.output("blob");

  if (action === "print") {
    printBlob(blob);
    return;
  }

  previewBlob(blob, filename, title);
}
