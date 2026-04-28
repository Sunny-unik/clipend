import {
  getCurrentWebviewWindow,
  WebviewWindow,
} from "@tauri-apps/api/webviewWindow";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { emitTo, listen } from "@tauri-apps/api/event";
import { currentMonitor } from "@tauri-apps/api/window";
import type { Clip } from "../types/clip";

const TOOLTIP_WIDTH = 400;
const TOOLTIP_HEIGHT = 300;
const GAP = 8;
const HIDE_DELAY_MS = 300;

let hideTimer: number | null = null;
let mouseOverTooltip = false;
let visible = false;
let listenersReady = false;

async function waitForTooltipWindow(timeoutMs = 2000): Promise<WebviewWindow | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const w = await WebviewWindow.getByLabel("tooltip");
    if (w) return w;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

export async function setupTooltipListeners() {
  if (listenersReady) return;
  listenersReady = true;
  await listen("tooltip-mouse-enter", () => {
    mouseOverTooltip = true;
    cancelPendingHide();
  });
  await listen("tooltip-mouse-leave", () => {
    mouseOverTooltip = false;
    scheduleHide();
  });
  // Rust forcibly hides the tooltip when the main window loses focus.
  // We need to mirror that into our local state, otherwise the next
  // showTooltip() short-circuits on the stale `visible` flag and the
  // tooltip never re-appears.
  await listen("tooltip-force-hidden", () => {
    visible = false;
    mouseOverTooltip = false;
    cancelPendingHide();
  });
}

export function cancelPendingHide() {
  if (hideTimer !== null) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }
}

export function scheduleHide() {
  cancelPendingHide();
  hideTimer = window.setTimeout(() => {
    hideTimer = null;
    if (!mouseOverTooltip) {
      hideTooltipNow().catch(() => {});
    }
  }, HIDE_DELAY_MS);
}

async function hideTooltipNow() {
  visible = false;
  const tooltip = await WebviewWindow.getByLabel("tooltip");
  if (!tooltip) return;
  await tooltip.hide();
  await emitTo("tooltip", "tooltip-clip", null);
}

export async function showTooltip(clip: Clip, rowRect: DOMRect) {
  cancelPendingHide();
  const tooltip = await waitForTooltipWindow();
  if (!tooltip) return;

  const main = getCurrentWebviewWindow();
  const [mainPos, mainSize, scale, monitor] = await Promise.all([
    main.outerPosition(),
    main.outerSize(),
    main.scaleFactor(),
    currentMonitor(),
  ]);

  const widthPx = Math.round(TOOLTIP_WIDTH * scale);
  const heightPx = Math.round(TOOLTIP_HEIGHT * scale);
  const gapPx = Math.round(GAP * scale);

  let x = mainPos.x + mainSize.width + gapPx;
  if (monitor) {
    const screenRight = monitor.position.x + monitor.size.width;
    if (x + widthPx > screenRight) {
      x = mainPos.x - widthPx - gapPx;
    }
    if (x < monitor.position.x) {
      x = Math.max(monitor.position.x, screenRight - widthPx);
    }
  } else if (x + widthPx > window.screen.width) {
    x = Math.max(0, mainPos.x - widthPx - gapPx);
  }

  const rowCenterCss = rowRect.top + rowRect.height / 2;
  let y = Math.round(mainPos.y + rowCenterCss * scale - heightPx / 2);
  if (monitor) {
    const screenTop = monitor.position.y;
    const screenBottom = monitor.position.y + monitor.size.height;
    if (y < screenTop) y = screenTop;
    if (y + heightPx > screenBottom) y = screenBottom - heightPx;
  }

  await emitTo("tooltip", "tooltip-clip", clip);
  await tooltip.setPosition(new PhysicalPosition(x, y));
  if (!visible) await tooltip.show();
  visible = true;
}

export function isTooltipVisible() {
  return visible;
}
