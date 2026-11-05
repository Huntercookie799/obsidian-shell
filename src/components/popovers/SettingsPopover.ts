import { invoke } from "@tauri-apps/api/core";
import { isEnabled as isAutostartEnabled, enable as enableAutostart, disable as disableAutostart } from "@tauri-apps/plugin-autostart";
import { CollapsedWidgetType, DockPosition, MonitorInfo } from "../../types";
import { stateManager } from "../../core/StateManager";

export interface SettingsPopoverCallbacks {
  onDockPositionChange?: (dock: DockPosition) => void;
  onWidgetChange?: (widget: CollapsedWidgetType) => void;
  onClock24hChange?: (is24h: boolean) => void;
  onAutoHideChange?: (enabled: boolean, minutes: number) => void;
}

export class SettingsPopover {
  private popoverEl: HTMLElement | null = null;
  private toggleAutoCollapse: HTMLInputElement | null = null;
  private toggleAutoHideIdle: HTMLInputElement | null = null;
  private selectAutoHideIdleMins: HTMLSelectElement | null = null;
  private settingAutoHideIdleRow: HTMLElement | null = null;
  private toggleAutostart: HTMLInputElement | null = null;
  private toggleRestoreSession: HTMLInputElement | null = null;
  private toggleShowOverFullscreen: HTMLInputElement | null = null;
  private selectDockPosition: HTMLSelectElement | null = null;
  private selectActiveMonitor: HTMLSelectElement | null = null;
  private selectCollapsedWidget: HTMLSelectElement | null = null;
  private toggleClock24h: HTMLInputElement | null = null;
  private toggleCliNotifications: HTMLInputElement | null = null;
  private toggleNotificationSound: HTMLInputElement | null = null;
  private callbacks: SettingsPopoverCallbacks;

  constructor(callbacks: SettingsPopoverCallbacks = {}) {
    this.callbacks = callbacks;
  }

  public async initDom(): Promise<void> {
    this.popoverEl = document.getElementById("settings-popover");
    this.toggleAutoCollapse = document.getElementById("toggle-auto-collapse") as HTMLInputElement;
    this.toggleAutoHideIdle = document.getElementById("toggle-auto-hide-idle") as HTMLInputElement;
    this.selectAutoHideIdleMins = document.getElementById("select-auto-hide-idle-mins") as HTMLSelectElement;
    this.settingAutoHideIdleRow = document.getElementById("setting-auto-hide-idle-row");
    this.toggleAutostart = document.getElementById("toggle-autostart") as HTMLInputElement;
    this.toggleRestoreSession = document.getElementById("toggle-restore-session") as HTMLInputElement;
    this.toggleShowOverFullscreen = document.getElementById("toggle-show-over-fullscreen") as HTMLInputElement;
    this.selectDockPosition = document.getElementById("select-dock-position") as HTMLSelectElement;
    this.selectActiveMonitor = document.getElementById("select-active-monitor") as HTMLSelectElement;
    this.selectCollapsedWidget = document.getElementById("select-collapsed-widget") as HTMLSelectElement;
    this.toggleClock24h = document.getElementById("toggle-clock-24h") as HTMLInputElement;
    this.toggleCliNotifications = document.getElementById("toggle-cli-notifications") as HTMLInputElement;
    this.toggleNotificationSound = document.getElementById("toggle-notification-sound") as HTMLInputElement;

    await this.syncValuesFromSettings();
    this.bindEvents();
    await this.refreshMonitorsList();
  }

  public async syncValuesFromSettings(): Promise<void> {
    const settings = stateManager.getSettings();

    if (this.toggleAutoCollapse) {
      this.toggleAutoCollapse.checked = settings.autoCollapseOnLeave;
    }
    if (this.toggleAutoHideIdle) {
      this.toggleAutoHideIdle.checked = !!settings.autoHideEnabled;
    }
    if (this.selectAutoHideIdleMins) {
      this.selectAutoHideIdleMins.value = (settings.autoHideMinutes || 3).toString();
    }
    if (this.settingAutoHideIdleRow) {
      this.settingAutoHideIdleRow.style.display = settings.autoHideEnabled ? "flex" : "none";
    }
    if (this.toggleRestoreSession) {
      this.toggleRestoreSession.checked = settings.restoreSessionOnStartup;
    }
    if (this.toggleShowOverFullscreen) {
      this.toggleShowOverFullscreen.checked = settings.showOverFullscreen ?? false;
    }
    if (this.selectCollapsedWidget) {
      this.selectCollapsedWidget.value = settings.collapsedWidget;
    }
    if (this.toggleClock24h) {
      this.toggleClock24h.checked = settings.clock24h;
    }
    if (this.toggleCliNotifications) {
      this.toggleCliNotifications.checked = settings.cliNotifications !== false;
    }
    if (this.toggleNotificationSound) {
      this.toggleNotificationSound.checked = settings.notificationSound !== false;
    }

    try {
      const autostart = await isAutostartEnabled();
      if (this.toggleAutostart) {
        this.toggleAutostart.checked = autostart;
      }
    } catch (e) {
      console.debug("[SettingsPopover] Error al consultar autostart:", e);
    }
  }

  private bindEvents(): void {
    if (this.toggleAutoCollapse) {
      this.toggleAutoCollapse.addEventListener("change", () => {
        stateManager.saveSettings({ autoCollapseOnLeave: this.toggleAutoCollapse!.checked });
      });
    }

    if (this.toggleAutoHideIdle) {
      this.toggleAutoHideIdle.addEventListener("change", () => {
        const enabled = this.toggleAutoHideIdle!.checked;
        if (this.settingAutoHideIdleRow) {
          this.settingAutoHideIdleRow.style.display = enabled ? "flex" : "none";
        }
        stateManager.saveSettings({ autoHideEnabled: enabled });
        const mins = parseInt(this.selectAutoHideIdleMins?.value || "3", 10);
        this.callbacks.onAutoHideChange?.(enabled, mins);
      });
    }

    if (this.selectAutoHideIdleMins) {
      this.selectAutoHideIdleMins.addEventListener("change", () => {
        const mins = parseInt(this.selectAutoHideIdleMins!.value, 10);
        stateManager.saveSettings({ autoHideMinutes: mins });
        this.callbacks.onAutoHideChange?.(!!this.toggleAutoHideIdle?.checked, mins);
      });
    }

    if (this.toggleAutostart) {
      this.toggleAutostart.addEventListener("change", async () => {
        try {
          if (this.toggleAutostart!.checked) {
            await enableAutostart();
          } else {
            await disableAutostart();
          }
        } catch (err) {
          console.error("[SettingsPopover] Error al alternar autostart:", err);
        }
      });
    }

    if (this.toggleRestoreSession) {
      this.toggleRestoreSession.addEventListener("change", async () => {
        const enabled = this.toggleRestoreSession!.checked;
        stateManager.saveSettings({ restoreSessionOnStartup: enabled });
        if (!enabled) {
          try {
            await invoke("clear_session_snapshot");
          } catch (err) {
            console.debug("Error al limpiar instantánea de sesión:", err);
          }
        }
      });
    }

    if (this.toggleShowOverFullscreen) {
      this.toggleShowOverFullscreen.addEventListener("change", async () => {
        const enabled = this.toggleShowOverFullscreen!.checked;
        stateManager.saveSettings({ showOverFullscreen: enabled });
        try {
          await invoke("set_show_over_fullscreen", { enabled });
        } catch (err) {
          console.debug("Error al sincronizar show_over_fullscreen:", err);
        }
      });
    }

    if (this.selectDockPosition) {
      this.selectDockPosition.addEventListener("change", () => {
        const val = this.selectDockPosition!.value;
        let pos: DockPosition;
        if (val === "LeftEdge") {
          pos = { type: "LeftEdge", y_ratio: 0.5 };
        } else if (val === "RightEdge") {
          pos = { type: "RightEdge", y_ratio: 0.5 };
        } else if (val === "TopLeft") {
          pos = { type: "TopLeft" };
        } else if (val === "TopRight") {
          pos = { type: "TopRight" };
        } else {
          pos = { type: "TopCenter" };
        }
        stateManager.saveSettings({ dockPosition: pos });
        this.callbacks.onDockPositionChange?.(pos);
      });
    }

    if (this.selectActiveMonitor) {
      this.selectActiveMonitor.addEventListener("change", async () => {
        const idx = parseInt(this.selectActiveMonitor!.value, 10);
        stateManager.saveSettings({ targetMonitorIndex: idx });
        try {
          await invoke("set_active_monitor", { monitorIndex: idx });
        } catch (err) {
          console.error("Error al asignar pantalla activa:", err);
        }
      });
    }

    if (this.selectCollapsedWidget) {
      this.selectCollapsedWidget.addEventListener("change", () => {
        const widget = this.selectCollapsedWidget!.value as CollapsedWidgetType;
        stateManager.saveSettings({ collapsedWidget: widget });
        this.callbacks.onWidgetChange?.(widget);
      });
    }

    if (this.toggleClock24h) {
      this.toggleClock24h.addEventListener("change", () => {
        const is24h = this.toggleClock24h!.checked;
        stateManager.saveSettings({ clock24h: is24h });
        this.callbacks.onClock24hChange?.(is24h);
      });
    }

    if (this.toggleCliNotifications) {
      this.toggleCliNotifications.addEventListener("change", () => {
        stateManager.saveSettings({ cliNotifications: this.toggleCliNotifications!.checked });
      });
    }

    if (this.toggleNotificationSound) {
      this.toggleNotificationSound.addEventListener("change", () => {
        stateManager.saveSettings({ notificationSound: this.toggleNotificationSound!.checked });
      });
    }
  }

  public syncDockPosition(dockType: string): void {
    if (this.selectDockPosition) {
      this.selectDockPosition.value = dockType;
    }
  }

  public syncActiveMonitor(monitorIndex: number): void {
    if (this.selectActiveMonitor) {
      this.selectActiveMonitor.value = monitorIndex.toString();
    }
  }

  public async refreshMonitorsList(): Promise<void> {
    if (!this.selectActiveMonitor) return;
    try {
      const monitors = await invoke<MonitorInfo[]>("get_available_monitors");
      const select = this.selectActiveMonitor;
      if (!select) return;
      select.innerHTML = "";

      if (!monitors || monitors.length === 0) {
        const opt = document.createElement("option");
        opt.value = "0";
        opt.textContent = "Pantalla principal";
        select.appendChild(opt);
        return;
      }

      monitors.forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m.index.toString();
        const primaryTag = m.is_primary ? " (Principal)" : "";
        opt.textContent = `Pantalla ${m.index + 1}: ${m.width}x${m.height}${primaryTag}`;
        if (m.is_current) {
          opt.selected = true;
        }
        select.appendChild(opt);
      });

      const settings = stateManager.getSettings();
      if (settings.targetMonitorIndex !== undefined && settings.targetMonitorIndex < monitors.length) {
        select.value = settings.targetMonitorIndex.toString();
      }
    } catch (err) {
      console.debug("[SettingsPopover] Error al cargar lista de pantallas disponibles:", err);
    }
  }

  public toggle(): void {
    if (!this.popoverEl) return;
    this.popoverEl.classList.toggle("hidden");
    if (!this.popoverEl.classList.contains("hidden")) {
      this.refreshMonitorsList();
    }
  }

  public show(): void {
    if (!this.popoverEl) return;
    this.popoverEl.classList.remove("hidden");
    this.refreshMonitorsList();
  }

  public hide(): void {
    if (!this.popoverEl) return;
    this.popoverEl.classList.add("hidden");
  }

  public isVisible(): boolean {
    return !!this.popoverEl && !this.popoverEl.classList.contains("hidden");
  }
}
