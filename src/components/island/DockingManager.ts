import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { DockPosition } from "../../types";
import { stateManager } from "../../core/StateManager";

export interface DockingManagerCallbacks {
  onDockPositionChanged?: (pos: DockPosition) => void;
}

export class DockingManager {
  private islandContainer: HTMLElement | null = null;
  private notchPill: HTMLElement | null = null;
  private hubHeader: HTMLElement | null = null;
  private currentDockPosition: DockPosition = { type: "TopCenter" };
  private dragDebounceTimer: number | null = null;
  private callbacks: DockingManagerCallbacks;

  constructor(callbacks: DockingManagerCallbacks = {}) {
    this.callbacks = callbacks;
  }

  public initDom(): void {
    this.islandContainer = document.getElementById("island-container");
    this.notchPill = document.getElementById("notch-pill");
    this.hubHeader = document.getElementById("hub-header");

    this.bindEvents();
    this.setupListeners();
    this.restoreInitialDock();
  }

  public getDockPosition(): DockPosition {
    return this.currentDockPosition;
  }

  public async setDockPosition(pos: DockPosition): Promise<void> {
    this.currentDockPosition = pos;
    this.applyDockClass(pos);
    stateManager.saveSettings({ dockPosition: pos });
    try {
      await invoke("set_dock_position", { position: pos });
    } catch (err) {
      console.error("Error al fijar posición de la isla:", err);
    }
  }

  public applyDockClass(pos: DockPosition): void {
    if (!this.islandContainer) return;

    this.islandContainer.classList.remove(
      "dock-top-center",
      "dock-top-left",
      "dock-top-right",
      "dock-vertical-left",
      "dock-vertical-right"
    );

    switch (pos.type) {
      case "TopCenter":
        this.islandContainer.classList.add("dock-top-center");
        break;
      case "TopLeft":
        this.islandContainer.classList.add("dock-top-left");
        break;
      case "TopRight":
        this.islandContainer.classList.add("dock-top-right");
        break;
      case "LeftEdge":
        this.islandContainer.classList.add("dock-vertical-left");
        break;
      case "RightEdge":
        this.islandContainer.classList.add("dock-vertical-right");
        break;
    }
  }

  private async restoreInitialDock(): Promise<void> {
    const settings = stateManager.getSettings();
    if (settings.dockPosition) {
      this.currentDockPosition = settings.dockPosition;
      try {
        await invoke("set_dock_position", { position: this.currentDockPosition });
      } catch (err) {
        console.debug("Error al restaurar posición de dock:", err);
      }
    } else {
      try {
        const initialDock = await invoke<DockPosition>("get_dock_position");
        if (initialDock) {
          this.currentDockPosition = initialDock;
        }
      } catch (err) {
        console.debug("Error al consultar dock position inicial:", err);
      }
    }
    this.applyDockClass(this.currentDockPosition);
  }

  private setupListeners(): void {
    listen<DockPosition>("dock-position-changed", (event) => {
      const newPos = event.payload;
      this.currentDockPosition = newPos;
      stateManager.saveSettings({ dockPosition: newPos });
      this.applyDockClass(newPos);
      if (this.callbacks.onDockPositionChanged) {
        this.callbacks.onDockPositionChanged(newPos);
      }
    });
  }

  private bindEvents(): void {
    if (!this.notchPill) return;

    let isMouseDown = false;
    let hasDragged = false;
    let startScreenX = 0;
    let startScreenY = 0;

    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("button, input, select, .action-btn, .tab-item, .pane-header-bar, .resize-handle")) {
        return;
      }
      isMouseDown = true;
      hasDragged = false;
      startScreenX = e.screenX;
      startScreenY = e.screenY;
    };

    const onMouseMove = async (e: MouseEvent) => {
      if (!isMouseDown) return;
      const dist = Math.hypot(e.screenX - startScreenX, e.screenY - startScreenY);
      if (!hasDragged && dist > 5) {
        hasDragged = true;
        try {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          await getCurrentWindow().startDragging();
        } catch (err) {
          console.debug("Error al iniciar arrastre nativo:", err);
        }
      }
    };

    const onMouseUp = async () => {
      if (isMouseDown && hasDragged) {
        isMouseDown = false;
        hasDragged = false;
        try {
          const newPos = await invoke<DockPosition>("snap_window_to_nearest_edge");
          this.currentDockPosition = newPos;
          stateManager.saveSettings({ dockPosition: newPos });
          this.applyDockClass(newPos);
          if (this.callbacks.onDockPositionChanged) {
            this.callbacks.onDockPositionChanged(newPos);
          }
        } catch (err) {
          console.error("Error al aplicar snap magnético:", err);
        }
      } else {
        isMouseDown = false;
        hasDragged = false;
      }
    };

    this.notchPill.addEventListener("mousedown", onMouseDown);
    if (this.hubHeader) {
      this.hubHeader.addEventListener("mousedown", onMouseDown);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    listen("tauri://move", () => {
      if (hasDragged || isMouseDown) {
        if (this.dragDebounceTimer) clearTimeout(this.dragDebounceTimer);
        this.dragDebounceTimer = window.setTimeout(async () => {
          isMouseDown = false;
          hasDragged = false;
          try {
            const newPos = await invoke<DockPosition>("snap_window_to_nearest_edge");
            this.currentDockPosition = newPos;
            stateManager.saveSettings({ dockPosition: newPos });
            this.applyDockClass(newPos);
            if (this.callbacks.onDockPositionChanged) {
              this.callbacks.onDockPositionChanged(newPos);
            }
          } catch (err) {
            console.debug("Snap post-move:", err);
          }
        }, 160);
      }
    });
  }
}
