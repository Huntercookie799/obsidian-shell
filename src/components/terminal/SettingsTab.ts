import { invoke } from "@tauri-apps/api/core";
import { isEnabled as isAutostartEnabled, enable as enableAutostart, disable as disableAutostart } from "@tauri-apps/plugin-autostart";
import { CollapsedWidgetType, DockPosition, MonitorInfo } from "../../types";
import { stateManager } from "../../core/StateManager";
import { AppearanceManager } from "../popovers/AppearanceManager";

export interface SettingsTabCallbacks {
  onDockPositionChange?: (dock: DockPosition) => void;
  onWidgetChange?: (widget: CollapsedWidgetType) => void;
  onClock24hChange?: (is24h: boolean) => void;
  onAutoHideChange?: (enabled: boolean, minutes: number) => void;
}

export class SettingsTab {
  private containerEl: HTMLElement | null = null;
  private appearanceManager: AppearanceManager | null = null;

  // Form elements
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
  private callbacks: SettingsTabCallbacks;

  constructor(callbacks: SettingsTabCallbacks = {}, appearanceManager: AppearanceManager | null = null) {
    this.callbacks = callbacks;
    this.appearanceManager = appearanceManager;
  }

  public setAppearanceManager(manager: AppearanceManager): void {
    this.appearanceManager = manager;
  }

  public async initDom(container: HTMLElement): Promise<void> {
    this.containerEl = container;
    this.render();
    await this.syncValuesFromSettings();
    this.bindEvents();
    await this.refreshMonitorsList();
    if (this.appearanceManager) {
      this.appearanceManager.initDom();
    }
  }

  
  private render(): void {
    if (!this.containerEl) return;

    this.containerEl.innerHTML = `
      <div class="settings-tab-content">
        <!-- Settings Tab Navigation -->
        <nav class="settings-tab-nav" role="tablist" aria-label="Categorías de ajustes">
          <button class="settings-tab-btn active" role="tab" aria-selected="true" data-tab="general" aria-controls="panel-general">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>
            <span>General</span>
          </button>
          <button class="settings-tab-btn" role="tab" aria-selected="false" data-tab="appearance" aria-controls="panel-appearance">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            <span>Apariencia</span>
          </button>
          <button class="settings-tab-btn" role="tab" aria-selected="false" data-tab="docking" aria-controls="panel-docking">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M12 2v20M2 12h20"/></svg>
            <span>Anclaje</span>
          </button>
          <button class="settings-tab-btn" role="tab" aria-selected="false" data-tab="behavior" aria-controls="panel-behavior">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
            <span>Comportamiento</span>
          </button>
        </nav>

        <!-- General Panel -->
        <div class="settings-tab-panel active" id="panel-general" role="tabpanel" aria-labelledby="tab-general">
          <div class="setting-item">
            <div class="setting-text">
              <span class="setting-title">Auto-ocultar al quitar cursor</span>
              <span class="setting-subtitle">Repliega a píldora tras 300ms</span>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" id="toggle-auto-collapse" checked />
              <span class="toggle-slider"></span>
            </label>
          </div>

          <!-- Ocultamiento por Inactividad -->
          <div class="setting-item">
            <div class="setting-text">
              <span class="setting-title">Ocultar por inactividad</span>
              <span class="setting-subtitle">Oculta la ventana tras tiempo sin interacción</span>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" id="toggle-auto-hide-idle" />
              <span class="toggle-slider"></span>
            </label>
          </div>

          <div class="setting-item column" id="setting-auto-hide-idle-row" style="display: none;">
            <div class="setting-text">
              <span class="setting-title">Tiempo de inactividad</span>
              <span class="setting-subtitle">Minutos en reposo antes de ocultar</span>
            </div>
            <select id="select-auto-hide-idle-mins" class="setting-select">
              <option value="1">1 minuto</option>
              <option value="3" selected>3 minutos</option>
              <option value="5">5 minutos</option>
              <option value="10">10 minutos</option>
            </select>
          </div>

          <div class="setting-item">
            <div class="setting-text">
              <span class="setting-title">Arrancar con el sistema</span>
              <span class="setting-subtitle">Iniciar ObsidianShell al iniciar sesión</span>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" id="toggle-autostart" />
              <span class="toggle-slider"></span>
            </label>
          </div>

          <div class="setting-item">
            <div class="setting-text">
              <span class="setting-title">Restaurar sesión al iniciar</span>
              <span class="setting-subtitle">Recupera pestañas, paneles y buffer previo</span>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" id="toggle-restore-session" checked />
              <span class="toggle-slider"></span>
            </label>
          </div>

          <div class="setting-item">
            <div class="setting-text">
              <span class="setting-title">Mostrar sobre pantalla completa</span>
              <span class="setting-subtitle">Mantener visible sobre juegos y videos</span>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" id="toggle-show-over-fullscreen" />
              <span class="toggle-slider"></span>
            </label>
          </div>

          <div class="setting-item">
            <div class="setting-text">
              <span class="setting-title">Notificaciones de agentes CLI</span>
              <span class="setting-subtitle">Detecta preguntas y tareas completadas</span>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" id="toggle-cli-notifications" checked />
              <span class="toggle-slider"></span>
            </label>
          </div>

          <div class="setting-item">
            <div class="setting-text">
              <span class="setting-title">Sonido suave de notificación</span>
              <span class="setting-subtitle">Tono sutil al terminar o requerir confirmación</span>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" id="toggle-notification-sound" checked />
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>

        <!-- Appearance Panel -->
        <div class="settings-tab-panel" id="panel-appearance" role="tabpanel" aria-labelledby="tab-appearance" hidden>
          <div class="setting-item column" id="setting-accent-section">
            <div class="setting-text">
              <span class="setting-title">Color de acento</span>
              <span class="setting-subtitle">Personaliza la tonalidad de la barra y terminales</span>
            </div>
            <div class="accent-palette-row">
              <button class="color-swatch active" data-color="#FF6B00" style="background-color: #FF6B00;" title="Naranja Obsidiana (#FF6B00)"></button>
              <button class="color-swatch" data-color="#8B5CF6" style="background-color: #8B5CF6;" title="Violeta Cuarzo (#8B5CF6)"></button>
              <button class="color-swatch" data-color="#06B6D4" style="background-color: #06B6D4;" title="Cian Eléctrico (#06B6D4)"></button>
              <button class="color-swatch" data-color="#10B981" style="background-color: #10B981;" title="Verde Esmeralda (#10B981)"></button>
              <button class="color-swatch" data-color="#F43F5E" style="background-color: #F43F5E;" title="Carmesí Neón (#F43F5E)"></button>
              <button class="color-swatch" data-color="#E4E4E7" style="background-color: #E4E4E7;" title="Monocromo Plata (#E4E4E7)"></button>
              <label class="color-picker-label" title="Color personalizado">
                <input type="color" id="input-accent-picker" value="#FF6B00" class="color-picker-input" />
                <span class="color-picker-preview" id="color-picker-preview"></span>
              </label>
            </div>
          </div>

          <!-- Sección Apariencia y Fondo -->
          <div class="setting-item column" id="setting-appearance-section">
            <div class="setting-text">
              <span class="setting-title">Apariencia y Fondo</span>
              <span class="setting-subtitle">Transparencia, desenfoque y wallpaper de la terminal</span>
            </div>

            <!-- Opacidad del fondo -->
            <div class="setting-slider-group">
              <div class="setting-slider-header">
                <span class="slider-label">Opacidad del fondo</span>
                <span class="slider-value" id="label-terminal-opacity">70%</span>
              </div>
              <input type="range" id="input-terminal-opacity" min="0.2" max="1.0" step="0.05" value="0.70" class="setting-range" />
            </div>

            <!-- Desenfoque del fondo (Blur) -->
            <div class="setting-slider-group">
              <div class="setting-slider-header">
                <span class="slider-label">Desenfoque del fondo (Blur)</span>
                <span class="slider-value" id="label-terminal-blur">14px</span>
              </div>
              <input type="range" id="input-terminal-blur" min="0" max="30" step="1" value="14" class="setting-range" />
            </div>

            <!-- Imagen de fondo (Wallpaper) -->
            <div class="setting-wallpaper-group">
              <div class="setting-slider-header">
                <span class="slider-label">Imagen de fondo</span>
                <span class="wallpaper-status-badge" id="label-wallpaper-status">Sin imagen</span>
              </div>
              <div class="setting-actions-row">
                <button type="button" class="setting-action-button" id="btn-select-wallpaper">Elegir imagen...</button>
                <button type="button" class="setting-action-button danger hidden" id="btn-remove-wallpaper">Quitar imagen</button>
              </div>
              <input type="file" id="input-wallpaper-file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" style="display: none;" />
            </div>
          </div>
        </div>

        <!-- Docking Panel -->
        <div class="settings-tab-panel" id="panel-docking" role="tabpanel" aria-labelledby="tab-docking" hidden>
          <div class="setting-item column" id="setting-dock-row">
            <div class="setting-text">
              <span class="setting-title">Posición de la isla</span>
              <span class="setting-subtitle">Zona de anclaje magnético en la pantalla</span>
            </div>
            <select id="select-dock-position" class="setting-select">
              <option value="TopCenter">Centro Superior (Por defecto)</option>
              <option value="TopLeft">Esquina Superior Izquierda</option>
              <option value="TopRight">Esquina Superior Derecha</option>
              <option value="LeftEdge">Lateral Izquierdo (Vertical)</option>
              <option value="RightEdge">Lateral Derecho (Vertical)</option>
            </select>
          </div>

          <div class="setting-item column" id="setting-monitor-row">
            <div class="setting-text">
              <span class="setting-title">Pantalla del Notch</span>
              <span class="setting-subtitle">Selecciona el monitor donde se mantendrá la Dynamic Island</span>
            </div>
            <select id="select-active-monitor" class="setting-select">
              <option value="0">Cargando pantallas...</option>
            </select>
          </div>
        </div>

        <!-- Behavior Panel -->
        <div class="settings-tab-panel" id="panel-behavior" role="tabpanel" aria-labelledby="tab-behavior" hidden>
          <div class="setting-item column">
            <div class="setting-text">
              <span class="setting-title">Widget en modo píldora</span>
              <span class="setting-subtitle">Información mostrada en reposo (260x34)</span>
            </div>
            <select id="select-collapsed-widget" class="setting-select">
              <option value="pty_status">Sesiones PTY activas (Por defecto)</option>
              <option value="clock">Reloj digital en tiempo real</option>
              <option value="system_metrics">Uso de CPU y Memoria RAM</option>
              <option value="live_log">Log vivo / Última salida ANSI</option>
            </select>
          </div>

          <div class="setting-item" id="setting-clock-row" style="display: none;">
            <div class="setting-text">
              <span class="setting-title">Formato de 24 horas</span>
              <span class="setting-subtitle">Desactivar para formato 12h (AM/PM)</span>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" id="toggle-clock-24h" checked />
              <span class="toggle-slider"></span>
            </label>
          </div>

          <div class="setting-item column" id="setting-recent-folders-section">
            <div class="setting-text">
              <span class="setting-title">Carpetas recientes</span>
              <span class="setting-subtitle">Historial de directorios de trabajo</span>
            </div>
            <div class="setting-actions-row">
              <button type="button" class="setting-action-button" id="btn-settings-open-folder">Abrir carpeta...</button>
              <button type="button" class="setting-action-button danger" id="btn-settings-clear-folders">Limpiar</button>
            </div>
          </div>
        </div>
      </div>
    `;

    // Cache DOM elements
    this.toggleAutoCollapse = this.containerEl.querySelector("#toggle-auto-collapse");
    this.toggleAutoHideIdle = this.containerEl.querySelector("#toggle-auto-hide-idle");
    this.selectAutoHideIdleMins = this.containerEl.querySelector("#select-auto-hide-idle-mins");
    this.settingAutoHideIdleRow = this.containerEl.querySelector("#setting-auto-hide-idle-row");
    this.toggleAutostart = this.containerEl.querySelector("#toggle-autostart");
    this.toggleRestoreSession = this.containerEl.querySelector("#toggle-restore-session");
    this.toggleShowOverFullscreen = this.containerEl.querySelector("#toggle-show-over-fullscreen");
    this.selectDockPosition = this.containerEl.querySelector("#select-dock-position");
    this.selectActiveMonitor = this.containerEl.querySelector("#select-active-monitor");
    this.selectCollapsedWidget = this.containerEl.querySelector("#select-collapsed-widget");
    this.toggleClock24h = this.containerEl.querySelector("#toggle-clock-24h");
    this.toggleCliNotifications = this.containerEl.querySelector("#toggle-cli-notifications");
    this.toggleNotificationSound = this.containerEl.querySelector("#toggle-notification-sound");

    // Bind settings tab navigation
    this.bindSettingsTabNavigation();
  }

  private bindSettingsTabNavigation(): void {
    const tabButtons = this.containerEl?.querySelectorAll<HTMLButtonElement>(".settings-tab-btn");
    const tabPanels = this.containerEl?.querySelectorAll<HTMLElement>(".settings-tab-panel");

    tabButtons?.forEach((btn) => {
      btn.addEventListener("click", () => {
        const tabId = btn.dataset.tab;
        if (!tabId) return;

        // Update buttons
        tabButtons.forEach((b) => {
          b.classList.remove("active");
          b.setAttribute("aria-selected", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-selected", "true");

        // Update panels
        tabPanels?.forEach((panel) => {
          panel.classList.remove("active");
          panel.hidden = true;
        });
        const activePanel = this.containerEl?.querySelector<HTMLElement>(`#panel-${tabId}`);
        activePanel?.classList.add("active");
        if (activePanel) activePanel.hidden = false;
      });
    });
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
      console.debug("[SettingsTab] Error al consultar autostart:", e);
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
          console.error("[SettingsTab] Error al alternar autostart:", err);
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

    // Color swatches
    const swatches = this.containerEl?.querySelectorAll<HTMLElement>(".color-swatch");
    swatches?.forEach((swatch) => {
      swatch.addEventListener("click", () => {
        const color = swatch.dataset.color;
        if (color && this.appearanceManager) {
          this.appearanceManager.applyAccentColor(color);
          stateManager.saveSettings({ accentColor: color });
        }
      });
    });

    // Color picker
    const colorPicker = this.containerEl?.querySelector("#input-accent-picker") as HTMLInputElement;
    const appearanceManager = this.appearanceManager;
    if (colorPicker && appearanceManager) {
      colorPicker.addEventListener("input", () => {
        appearanceManager.applyAccentColor(colorPicker.value);
      });
      colorPicker.addEventListener("change", () => {
        stateManager.saveSettings({ accentColor: colorPicker.value });
      });
    }

    // Buttons for recent folders
    const btnOpenFolder = this.containerEl?.querySelector("#btn-settings-open-folder");
    const btnClearFolders = this.containerEl?.querySelector("#btn-settings-clear-folders");

    btnOpenFolder?.addEventListener("click", async () => {
      // This would need a callback to open folder dialog
      // For now, we can emit an event or use a callback
    });

    btnClearFolders?.addEventListener("click", () => {
      stateManager.saveSettings({ recentFolders: [] });
    });
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
      console.debug("[SettingsTab] Error al cargar lista de pantallas disponibles:", err);
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

  public syncClockVisibility(show: boolean): void {
    const clockRow = this.containerEl?.querySelector("#setting-clock-row") as HTMLElement;
    if (clockRow) {
      clockRow.style.display = show ? "flex" : "none";
    }
  }
}