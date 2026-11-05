import { invoke } from "@tauri-apps/api/core";
import { stateManager } from "../../core/StateManager";

export interface ResizeManagerCallbacks {
  isExpanded: () => boolean;
  onResizing: () => void;
  onResizeEnd: () => void;
}

export class ResizeManager {
  private islandContainer: HTMLElement | null = null;
  private handleLeft: HTMLElement | null = null;
  private handleRight: HTMLElement | null = null;
  private handleBottom: HTMLElement | null = null;
  private handleCorner: HTMLElement | null = null;
  private handleCornerLeft: HTMLElement | null = null;
  private callbacks: ResizeManagerCallbacks;

  constructor(callbacks: ResizeManagerCallbacks) {
    this.callbacks = callbacks;
  }

  public initDom(): void {
    this.islandContainer = document.getElementById("island-container");
    this.handleLeft = document.getElementById("resize-left");
    this.handleRight = document.getElementById("resize-right");
    this.handleBottom = document.getElementById("resize-bottom");
    this.handleCorner = document.getElementById("resize-corner");
    this.handleCornerLeft = document.getElementById("resize-corner-left");

    if (!this.islandContainer) {
      return;
    }

    this.bindEvents();
    this.restoreSavedDimensions();
  }

  public restoreSavedDimensions(): void {
    if (!this.islandContainer) return;
    const settings = stateManager.getSettings();
    if (settings.expandedWidth || settings.expandedHeight) {
      const expW = settings.expandedWidth || 850;
      const expH = settings.expandedHeight || 360;
      this.islandContainer.style.setProperty("--expanded-width", `${expW}px`);
      this.islandContainer.style.setProperty("--expanded-height", `${expH}px`);
      invoke("set_expanded_dimensions", { width: expW, height: expH }).catch((err) => {
        console.debug("Error al sincronizar dimensiones expandidas iniciales:", err);
      });
    }
  }

  private bindEvents(): void {
    if (!this.islandContainer) return;

    let isResizing = false;
    let resizeType: "left" | "right" | "bottom" | "corner" | "corner-left" | null = null;
    let startX = 0;
    let startY = 0;
    let startW = 0;
    let startH = 0;
    let currentNewW = 0;
    let currentNewH = 0;
    let activeHandleEl: HTMLElement | null = null;

    const onMouseDown = (type: "left" | "right" | "bottom" | "corner" | "corner-left", handleEl: HTMLElement, e: MouseEvent) => {
      if (!this.callbacks.isExpanded()) return;
      e.preventDefault();
      e.stopPropagation();

      isResizing = true;
      resizeType = type;
      activeHandleEl = handleEl;
      activeHandleEl.classList.add("active");

      startX = e.clientX;
      startY = e.clientY;
      startW = this.islandContainer!.offsetWidth;
      startH = this.islandContainer!.offsetHeight;
      currentNewW = startW;
      currentNewH = startH;

      document.body.style.userSelect = "none";
      if (type === "left" || type === "right") document.body.style.cursor = "ew-resize";
      else if (type === "bottom") document.body.style.cursor = "ns-resize";
      else if (type === "corner") document.body.style.cursor = "se-resize";
      else if (type === "corner-left") document.body.style.cursor = "sw-resize";

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isResizing || !resizeType || !this.islandContainer) return;
      e.preventDefault();

      if (resizeType === "right" || resizeType === "corner") {
        const deltaX = e.clientX - startX;
        currentNewW = Math.min(2400, Math.max(400, Math.round(startW + deltaX)));
        this.islandContainer.style.setProperty("--expanded-width", `${currentNewW}px`);
      } else if (resizeType === "left" || resizeType === "corner-left") {
        const deltaX = startX - e.clientX;
        currentNewW = Math.min(2400, Math.max(400, Math.round(startW + deltaX)));
        this.islandContainer.style.setProperty("--expanded-width", `${currentNewW}px`);
      }

      if (resizeType === "bottom" || resizeType === "corner" || resizeType === "corner-left") {
        const deltaY = e.clientY - startY;
        currentNewH = Math.min(1200, Math.max(200, Math.round(startH + deltaY)));
        this.islandContainer.style.setProperty("--expanded-height", `${currentNewH}px`);
      }

      // Reajuste fluido en tiempo real
      this.callbacks.onResizing();
    };

    const onMouseUp = async () => {
      if (!isResizing || !this.islandContainer) return;
      isResizing = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);

      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      if (activeHandleEl) {
        activeHandleEl.classList.remove("active");
        activeHandleEl = null;
      }

      const finalW = currentNewW || this.islandContainer.offsetWidth;
      const finalH = currentNewH || this.islandContainer.offsetHeight;

      stateManager.saveSettings({
        expandedWidth: finalW,
        expandedHeight: finalH,
      });

      try {
        await invoke("set_expanded_dimensions", {
          width: finalW,
          height: finalH,
        });
      } catch (err) {
        console.debug("Error al persistir dimensiones de ventana expandida:", err);
      }

      // Sincronización PTY definitiva y auto-anclaje al final del buffer
      this.callbacks.onResizeEnd();
    };

    this.handleLeft?.addEventListener("mousedown", (e) => onMouseDown("left", this.handleLeft!, e));
    this.handleRight?.addEventListener("mousedown", (e) => onMouseDown("right", this.handleRight!, e));
    this.handleBottom?.addEventListener("mousedown", (e) => onMouseDown("bottom", this.handleBottom!, e));
    this.handleCornerLeft?.addEventListener("mousedown", (e) => onMouseDown("corner-left", this.handleCornerLeft!, e));
    this.handleCorner?.addEventListener("mousedown", (e) => onMouseDown("corner", this.handleCorner!, e));
  }
}
