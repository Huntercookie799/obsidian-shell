import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { isEnabled as isAutostartEnabled, enable as enableAutostart, disable as disableAutostart } from "@tauri-apps/plugin-autostart";
import { createTerminalInstance, fitSafely, hexToRgb, stripAnsi, updateTerminalAccentTheme } from "./components/TerminalView";
import { CollapsedWidgetType, CustomProfile, IslandMode, ObsidianSettings, PtyStatus, SessionSnapshot, SnapshotPane, SnapshotTab, SystemMetrics, TerminalPane, TerminalTab } from "./types";
import { updateManager } from "./updater/UpdateManager";

class VayliIslandApp {
  private currentMode: IslandMode = "collapsed";
  private tabs: Map<string, TerminalTab> = new Map();
  private unlisteners: Map<string, UnlistenFn[]> = new Map();
  private activeTabId: string | null = null;
  private tabCounter = 0;
  private paneCounter = 0;

  // Timers for hover glance, activity tracking, auto-collapse, clock, metrics and auto-save
  private hoverTimer: number | null = null;
  private leaveTimer: number | null = null;
  private autoCollapseTimer: number | null = null;
  private clockTimer: number | null = null;
  private metricsTimer: number | null = null;
  private autoSaveTimer: number | null = null;
  private fullscreenCheckTimer: number | null = null;
  private isSavingSnapshot = false;
  private activityTimers: Map<string, number> = new Map();

  // Settings & Custom Profiles persisted in localStorage
  private settings: ObsidianSettings = {
    autoCollapseOnLeave: true,
    restoreSessionOnStartup: true,
    showOverFullscreen: false,
    collapsedWidget: "pty_status",
    clock24h: true,
    accentColor: "#FF6B00",
  };
  private customProfiles: CustomProfile[] = [];

  // DOM Elements
  private islandContainer!: HTMLElement;
  private rimLight!: HTMLElement;
  private notchPill!: HTMLElement;
  private statusOrb!: HTMLElement;
  private ttyBadge!: HTMLElement;
  private currentProcessEl!: HTMLElement;
  private notchGlance!: HTMLElement;
  private glanceOrb!: HTMLElement;
  private glanceTitle!: HTMLElement;
  private glanceStatusTag!: HTMLElement;
  private glanceSnippet!: HTMLElement;
  private tabsListEl!: HTMLElement;
  private viewportEl!: HTMLElement;
  private btnAddTab!: HTMLButtonElement;
  private btnCollapse!: HTMLButtonElement;
  private btnShellMenu!: HTMLButtonElement;
  private btnSettings!: HTMLButtonElement;
  private btnToggleSearch!: HTMLButtonElement;
  private btnSplitVertical!: HTMLButtonElement;
  private btnSplitHorizontal!: HTMLButtonElement;

  // Search Bar DOM
  private searchBar!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private btnSearchPrev!: HTMLButtonElement;
  private btnSearchNext!: HTMLButtonElement;
  private btnSearchClose!: HTMLButtonElement;

  // Popover, Profile & Settings DOM
  private shellMenuPopover!: HTMLElement;
  private settingsPopover!: HTMLElement;
  private toggleAutoCollapse!: HTMLInputElement;
  private toggleAutostart!: HTMLInputElement;
  private toggleRestoreSession!: HTMLInputElement;
  private toggleShowOverFullscreen!: HTMLInputElement;
  private inputAccentPicker!: HTMLInputElement;
  private selectCollapsedWidget!: HTMLSelectElement;
  private settingClockRow!: HTMLElement;
  private toggleClock24h!: HTMLInputElement;

  // Collapsed Pill Widgets DOM
  private widgetPty!: HTMLElement;
  private widgetClock!: HTMLElement;
  private clockTimeEl!: HTMLElement;
  private widgetMetrics!: HTMLElement;
  private pillCpuEl!: HTMLElement;
  private pillRamEl!: HTMLElement;
  private widgetLivelog!: HTMLElement;
  private pillLogProcEl!: HTMLElement;
  private pillLogSnippetEl!: HTMLElement;

  private customProfilesContainer!: HTMLElement;
  private inputProfileName!: HTMLInputElement;
  private inputProfileCmd!: HTMLInputElement;
  private inputProfileCwd!: HTMLInputElement;
  private btnSaveProfile!: HTMLButtonElement;
  private btnVersionBadge!: HTMLButtonElement;
  private versionText!: HTMLElement;
  private popoverVersionText!: HTMLElement;
  private btnPopoverUpdate!: HTMLButtonElement;

  public async init() {
    this.cacheDom();
    await this.loadSettings();
    this.loadCustomProfiles();
    this.bindEvents();
    this.listenToBackendState();

    // Initialize Auto-Updater & Version Manager
    await this.initUpdater();

    // Check if session restoration is enabled and attempt restoring snapshot
    let restored = false;
    if (this.settings.restoreSessionOnStartup) {
      restored = await this.restoreSession();
    }

    // Spawn initial default terminal session if not restored
    if (!restored) {
      await this.createTab();
    }

    // Set initial collapsed geometry
    await this.setMode("collapsed");

    // Iniciar chequeo periódico de oclusión sobre aplicaciones en pantalla completa
    this.startFullscreenCheckLoop();
  }

  private cacheDom() {
    this.islandContainer = document.getElementById("island-container")!;
    this.rimLight = document.getElementById("rim-light")!;
    this.notchPill = document.getElementById("notch-pill")!;
    this.statusOrb = document.getElementById("status-orb")!;
    this.ttyBadge = document.getElementById("tty-badge")!;
    this.currentProcessEl = document.getElementById("current-process")!;

    this.notchGlance = document.getElementById("notch-glance")!;
    this.glanceOrb = document.getElementById("glance-orb")!;
    this.glanceTitle = document.getElementById("glance-title")!;
    this.glanceStatusTag = document.getElementById("glance-status-tag")!;
    this.glanceSnippet = document.getElementById("glance-snippet")!;

    this.tabsListEl = document.getElementById("tabs-list")!;
    this.viewportEl = document.getElementById("terminal-viewport")!;
    this.btnAddTab = document.getElementById("btn-add-tab") as HTMLButtonElement;
    this.btnCollapse = document.getElementById("btn-collapse") as HTMLButtonElement;
    this.btnShellMenu = document.getElementById("btn-shell-menu") as HTMLButtonElement;
    this.btnSettings = document.getElementById("btn-settings") as HTMLButtonElement;
    this.btnToggleSearch = document.getElementById("btn-toggle-search") as HTMLButtonElement;
    this.btnSplitVertical = document.getElementById("btn-split-vertical") as HTMLButtonElement;
    this.btnSplitHorizontal = document.getElementById("btn-split-horizontal") as HTMLButtonElement;

    // Search Bar
    this.searchBar = document.getElementById("terminal-search-bar")!;
    this.searchInput = document.getElementById("search-input") as HTMLInputElement;
    this.btnSearchPrev = document.getElementById("btn-search-prev") as HTMLButtonElement;
    this.btnSearchNext = document.getElementById("btn-search-next") as HTMLButtonElement;
    this.btnSearchClose = document.getElementById("btn-search-close") as HTMLButtonElement;

    // Shell & Profiles & Settings Popovers
    this.shellMenuPopover = document.getElementById("shell-menu-popover")!;
    this.settingsPopover = document.getElementById("settings-popover")!;
    this.toggleAutoCollapse = document.getElementById("toggle-auto-collapse") as HTMLInputElement;
    this.toggleAutostart = document.getElementById("toggle-autostart") as HTMLInputElement;
    this.toggleRestoreSession = document.getElementById("toggle-restore-session") as HTMLInputElement;
    this.toggleShowOverFullscreen = document.getElementById("toggle-show-over-fullscreen") as HTMLInputElement;
    this.inputAccentPicker = document.getElementById("input-accent-picker") as HTMLInputElement;
    this.selectCollapsedWidget = document.getElementById("select-collapsed-widget") as HTMLSelectElement;
    this.settingClockRow = document.getElementById("setting-clock-row")!;
    this.toggleClock24h = document.getElementById("toggle-clock-24h") as HTMLInputElement;

    // Collapsed Pill Widgets
    this.widgetPty = document.getElementById("widget-pty")!;
    this.widgetClock = document.getElementById("widget-clock")!;
    this.clockTimeEl = document.getElementById("clock-time")!;
    this.widgetMetrics = document.getElementById("widget-metrics")!;
    this.pillCpuEl = document.getElementById("pill-cpu")!;
    this.pillRamEl = document.getElementById("pill-ram")!;
    this.widgetLivelog = document.getElementById("widget-livelog")!;
    this.pillLogProcEl = document.getElementById("pill-log-proc")!;
    this.pillLogSnippetEl = document.getElementById("pill-log-snippet")!;

    this.customProfilesContainer = document.getElementById("custom-profiles-container")!;
    this.inputProfileName = document.getElementById("input-profile-name") as HTMLInputElement;
    this.inputProfileCmd = document.getElementById("input-profile-cmd") as HTMLInputElement;
    this.inputProfileCwd = document.getElementById("input-profile-cwd") as HTMLInputElement;
    this.btnSaveProfile = document.getElementById("btn-save-profile") as HTMLButtonElement;

    this.btnVersionBadge = document.getElementById("btn-version-badge") as HTMLButtonElement;
    this.versionText = document.getElementById("version-text")!;
    this.popoverVersionText = document.getElementById("popover-version-text")!;
    this.btnPopoverUpdate = document.getElementById("btn-popover-update") as HTMLButtonElement;
  }

  private async loadSettings() {
    try {
      const raw = localStorage.getItem("obsidian_settings") || localStorage.getItem("vayli_settings");
      if (raw) {
        this.settings = { ...this.settings, ...JSON.parse(raw) };
      }
    } catch {
      // fallback to defaults
    }
    if (this.toggleAutoCollapse) {
      this.toggleAutoCollapse.checked = this.settings.autoCollapseOnLeave;
    }
    if (this.toggleRestoreSession) {
      this.toggleRestoreSession.checked = this.settings.restoreSessionOnStartup;
    }
    if (this.toggleShowOverFullscreen) {
      this.toggleShowOverFullscreen.checked = this.settings.showOverFullscreen ?? false;
    }
    try {
      await invoke("set_show_over_fullscreen", { enabled: !!this.settings.showOverFullscreen });
    } catch (err) {
      console.debug("Error al sincronizar visibilidad sobre pantalla completa inicial:", err);
    }
    if (this.selectCollapsedWidget) {
      this.selectCollapsedWidget.value = this.settings.collapsedWidget;
    }
    if (this.toggleClock24h) {
      this.toggleClock24h.checked = this.settings.clock24h;
    }

    try {
      const autostart = await isAutostartEnabled();
      if (this.toggleAutostart) {
        this.toggleAutostart.checked = autostart;
      }
    } catch (e) {
      console.debug("Autostart query status:", e);
    }

    // Aplicar color de acento persistido
    this.applyAccentColor(this.settings.accentColor || "#FF6B00");

    this.applyCollapsedWidget();
  }

  private saveSettings() {
    try {
      localStorage.setItem("obsidian_settings", JSON.stringify(this.settings));
    } catch (e) {
      console.warn("Failed to persist settings in localStorage:", e);
    }
  }

  private startFullscreenCheckLoop() {
    if (this.fullscreenCheckTimer) {
      clearInterval(this.fullscreenCheckTimer);
    }
    this.fullscreenCheckTimer = window.setInterval(async () => {
      // Chequeo ligero solo si la opción de mostrar sobre pantalla completa está desactivada (false)
      if (!this.settings.showOverFullscreen) {
        try {
          await invoke("check_fullscreen_occlusion");
        } catch {
          // Ignorar si la ventana no está disponible o en transición
        }
      }
    }, 1000);
  }

  public applyAccentColor(hex: string) {
    const rgb = hexToRgb(hex) || { r: 255, g: 107, b: 0 };
    document.documentElement.style.setProperty("--accent-color", hex);
    document.documentElement.style.setProperty("--accent-rgb", `${rgb.r}, ${rgb.g}, ${rgb.b}`);

    // Actualizar en caliente el cursor y selección en todas las terminales abiertas
    this.tabs.forEach((tab) => {
      tab.panes.forEach((pane) => {
        updateTerminalAccentTheme(pane.terminal, hex);
      });
    });

    // Actualizar resaltado en las muestras circulares (swatches)
    const swatches = document.querySelectorAll<HTMLElement>(".color-swatch");
    swatches.forEach((swatch) => {
      const swatchColor = swatch.dataset.color?.toLowerCase();
      if (swatchColor === hex.toLowerCase()) {
        swatch.classList.add("active");
      } else {
        swatch.classList.remove("active");
      }
    });

    if (this.inputAccentPicker) {
      this.inputAccentPicker.value = hex;
    }
  }

  public applyCollapsedWidget() {
    const widget = this.settings.collapsedWidget;
    this.notchPill.dataset.widget = widget;

    // Toggle widget elements
    this.widgetPty.classList.toggle("hidden", widget !== "pty_status");
    this.widgetClock.classList.toggle("hidden", widget !== "clock");
    this.widgetMetrics.classList.toggle("hidden", widget !== "system_metrics");
    this.widgetLivelog.classList.toggle("hidden", widget !== "live_log");

    // Toggle 24h clock row in settings popover
    if (this.settingClockRow) {
      this.settingClockRow.style.display = widget === "clock" ? "flex" : "none";
    }

    // Manage Clock Timer
    if (widget === "clock") {
      this.updateClockWidget();
      if (!this.clockTimer) {
        this.clockTimer = window.setInterval(() => this.updateClockWidget(), 1000);
      }
    } else {
      if (this.clockTimer) {
        clearInterval(this.clockTimer);
        this.clockTimer = null;
      }
    }

    // Manage System Metrics Timer
    if (widget === "system_metrics") {
      this.fetchSystemMetrics();
      if (!this.metricsTimer) {
        this.metricsTimer = window.setInterval(() => this.fetchSystemMetrics(), 2000);
      }
    } else {
      if (this.metricsTimer) {
        clearInterval(this.metricsTimer);
        this.metricsTimer = null;
      }
    }

    // Update pill summary for pty_status or live_log
    this.updatePillSummary();
  }

  private updateClockWidget() {
    const now = new Date();
    if (this.settings.clock24h) {
      this.clockTimeEl.textContent = now.toTimeString().split(" ")[0]; // HH:MM:SS
    } else {
      let hours = now.getHours();
      const ampm = hours >= 12 ? "PM" : "AM";
      hours = hours % 12 || 12;
      const pad = (n: number) => n.toString().padStart(2, "0");
      this.clockTimeEl.textContent = `${pad(hours)}:${pad(now.getMinutes())}:${pad(now.getSeconds())} ${ampm}`;
    }
  }

  private async fetchSystemMetrics() {
    try {
      const metrics = await invoke<SystemMetrics>("get_system_metrics");
      this.pillCpuEl.textContent = `CPU ${Math.round(metrics.cpu_usage)}%`;
      const usedGb = (metrics.memory_used_mb / 1024).toFixed(1);
      this.pillRamEl.textContent = `RAM ${usedGb}G`;
    } catch (err) {
      console.debug("Failed to fetch system metrics:", err);
    }
  }

  private loadCustomProfiles() {
    try {
      const raw = localStorage.getItem("vayli_custom_profiles");
      if (raw) {
        this.customProfiles = JSON.parse(raw);
      }
    } catch {
      this.customProfiles = [];
    }
    this.renderCustomProfiles();
  }

  private saveCustomProfiles() {
    try {
      localStorage.setItem("vayli_custom_profiles", JSON.stringify(this.customProfiles));
    } catch (e) {
      console.warn("Failed to persist profiles in localStorage:", e);
    }
    this.renderCustomProfiles();
  }

  private renderCustomProfiles() {
    this.customProfilesContainer.innerHTML = "";
    if (this.customProfiles.length === 0) {
      const emptyMsg = document.createElement("div");
      emptyMsg.style.cssText = "font-size: 10px; color: #52525B; padding: 4px;";
      emptyMsg.textContent = "No hay perfiles guardados.";
      this.customProfilesContainer.appendChild(emptyMsg);
      return;
    }

    this.customProfiles.forEach((profile) => {
      const item = document.createElement("div");
      item.className = "profile-item";

      const info = document.createElement("div");
      info.style.cssText = "display: flex; flex-direction: column; overflow: hidden;";
      const name = document.createElement("span");
      name.style.cssText = "font-weight: 600; color: #F4F4F6;";
      name.textContent = profile.name;
      const cmd = document.createElement("span");
      cmd.style.cssText = "font-family: var(--font-mono); font-size: 9px; color: #8E8E93;";
      cmd.textContent = profile.command + (profile.cwd ? ` [${profile.cwd}]` : "");
      info.appendChild(name);
      info.appendChild(cmd);

      const delBtn = document.createElement("button");
      delBtn.className = "profile-delete-btn";
      delBtn.innerHTML = "&times;";
      delBtn.title = "Delete profile";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.customProfiles = this.customProfiles.filter((p) => p.id !== profile.id);
        this.saveCustomProfiles();
      });

      item.appendChild(info);
      item.appendChild(delBtn);

      item.addEventListener("click", () => {
        this.shellMenuPopover.classList.add("hidden");
        this.createTab(profile.command, profile.cwd);
      });

      this.customProfilesContainer.appendChild(item);
    });
  }

  private async initUpdater() {
    await updateManager.init();

    updateManager.subscribe((state, label) => {
      this.versionText.textContent = label;
      this.btnVersionBadge.className = `version-badge ${state !== "idle" ? state : ""}`;

      const popoverLabel = state === "idle" ? `ObsidianShell v${updateManager.getVersion()}` : `ObsidianShell: ${label}`;
      this.popoverVersionText.textContent = popoverLabel;

      if (state === "available") {
        this.btnPopoverUpdate.textContent = "Instalar Actualización";
      } else if (state === "ready") {
        this.btnPopoverUpdate.textContent = "Reiniciar Aplicación";
      } else if (state === "downloading") {
        this.btnPopoverUpdate.textContent = label;
      } else {
        this.btnPopoverUpdate.textContent = "Buscar Actualizaciones";
      }
    });

    setTimeout(() => {
      updateManager.checkForAppUpdates(true);
    }, 2500);
  }

  private async listenToBackendState() {
    await listen<IslandMode>("island-state-changed", (event) => {
      this.setMode(event.payload, false);
    });
  }

  private bindEvents() {
    // 1. Hover-to-Glance Debounce (120ms ADN Vayli)
    this.notchPill.addEventListener("mouseenter", () => {
      if (this.currentMode === "collapsed") {
        if (this.leaveTimer) {
          clearTimeout(this.leaveTimer);
          this.leaveTimer = null;
        }
        this.hoverTimer = window.setTimeout(() => {
          if (this.currentMode === "collapsed") {
            this.setMode("glance");
          }
        }, 120);
      }
    });

    this.islandContainer.addEventListener("mouseenter", () => {
      if (this.autoCollapseTimer) {
        clearTimeout(this.autoCollapseTimer);
        this.autoCollapseTimer = null;
      }
    });

    this.islandContainer.addEventListener("mouseleave", () => {
      if (this.hoverTimer) {
        clearTimeout(this.hoverTimer);
        this.hoverTimer = null;
      }
      if (this.currentMode === "glance") {
        this.leaveTimer = window.setTimeout(() => {
          if (this.currentMode === "glance") {
            this.setMode("collapsed");
          }
        }, 200);
      } else if (this.currentMode === "expanded" && this.settings.autoCollapseOnLeave) {
        if (this.autoCollapseTimer) {
          clearTimeout(this.autoCollapseTimer);
        }
        this.autoCollapseTimer = window.setTimeout(() => {
          if (this.currentMode === "expanded") {
            this.setMode("collapsed");
          }
        }, 300);
      }
    });

    // 2. Click to Expand
    this.notchPill.addEventListener("click", () => {
      if (this.hoverTimer) clearTimeout(this.hoverTimer);
      this.setMode("expanded");
    });

    this.notchGlance.addEventListener("click", () => {
      if (this.leaveTimer) clearTimeout(this.leaveTimer);
      this.setMode("expanded");
    });

    // 3. Actions
    this.btnCollapse.addEventListener("click", (e) => {
      e.stopPropagation();
      this.setMode("collapsed");
    });

    this.btnAddTab.addEventListener("click", (e) => {
      e.stopPropagation();
      this.createTab();
    });

    this.btnSplitVertical.addEventListener("click", (e) => {
      e.stopPropagation();
      this.splitActiveTab("split-vertical");
    });

    this.btnSplitHorizontal.addEventListener("click", (e) => {
      e.stopPropagation();
      this.splitActiveTab("split-horizontal");
    });

    this.btnToggleSearch.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleSearchBar();
    });

    // 4. Buffer Search Events
    this.btnSearchClose.addEventListener("click", () => {
      this.closeSearchBar();
    });

    this.searchInput.addEventListener("input", () => {
      const activePane = this.getActivePane();
      if (activePane && this.searchInput.value) {
        activePane.searchAddon.findNext(this.searchInput.value, { incremental: true });
      }
    });

    this.btnSearchNext.addEventListener("click", () => {
      const activePane = this.getActivePane();
      if (activePane && this.searchInput.value) {
        activePane.searchAddon.findNext(this.searchInput.value);
      }
    });

    this.btnSearchPrev.addEventListener("click", () => {
      const activePane = this.getActivePane();
      if (activePane && this.searchInput.value) {
        activePane.searchAddon.findPrevious(this.searchInput.value);
      }
    });

    this.searchInput.addEventListener("keydown", (e) => {
      const activePane = this.getActivePane();
      if (!activePane) return;

      if (e.key === "Enter") {
        if (e.shiftKey) {
          activePane.searchAddon.findPrevious(this.searchInput.value);
        } else {
          activePane.searchAddon.findNext(this.searchInput.value);
        }
      } else if (e.key === "Escape") {
        this.closeSearchBar();
      }
    });

    // 5. Version Badge & Updater Interactions
    const onUpdateTrigger = (e: MouseEvent) => {
      e.stopPropagation();
      const state = updateManager.getState();
      if (state === "available") {
        updateManager.installUpdate();
      } else if (state === "ready") {
        updateManager.applyAndRelaunch();
      } else if (state !== "downloading" && state !== "checking") {
        updateManager.checkForAppUpdates(false);
      }
    };

    this.btnVersionBadge.addEventListener("click", onUpdateTrigger);
    this.btnPopoverUpdate.addEventListener("click", onUpdateTrigger);

    // 6. Shell Selection & Profile Creation
    this.btnShellMenu.addEventListener("click", (e) => {
      e.stopPropagation();
      this.settingsPopover.classList.add("hidden");
      this.shellMenuPopover.classList.toggle("hidden");
    });

    this.btnSettings.addEventListener("click", (e) => {
      e.stopPropagation();
      this.shellMenuPopover.classList.add("hidden");
      this.settingsPopover.classList.toggle("hidden");
    });

    this.settingsPopover.addEventListener("click", (e) => {
      e.stopPropagation();
    });

    this.toggleAutoCollapse.addEventListener("change", () => {
      this.settings.autoCollapseOnLeave = this.toggleAutoCollapse.checked;
      this.saveSettings();
    });

    this.toggleAutostart.addEventListener("change", async () => {
      try {
        if (this.toggleAutostart.checked) {
          await enableAutostart();
        } else {
          await disableAutostart();
        }
      } catch (err) {
        console.error("Failed to toggle autostart:", err);
        this.toggleAutostart.checked = !this.toggleAutostart.checked;
      }
    });

    this.selectCollapsedWidget.addEventListener("change", () => {
      this.settings.collapsedWidget = this.selectCollapsedWidget.value as CollapsedWidgetType;
      this.applyCollapsedWidget();
      this.saveSettings();
    });

    this.toggleClock24h.addEventListener("change", () => {
      this.settings.clock24h = this.toggleClock24h.checked;
      this.updateClockWidget();
      this.saveSettings();
    });

    this.shellMenuPopover.addEventListener("click", (e) => {
      e.stopPropagation();
      const target = (e.target as HTMLElement).closest(".menu-item") as HTMLElement | null;
      if (target && target.dataset.shell) {
        const shell = target.dataset.shell;
        this.shellMenuPopover.classList.add("hidden");
        this.createTab(shell);
      }
    });

    this.btnSaveProfile.addEventListener("click", () => {
      const name = this.inputProfileName.value.trim();
      const cmd = this.inputProfileCmd.value.trim();
      const cwd = this.inputProfileCwd.value.trim() || undefined;

      if (name && cmd) {
        this.customProfiles.push({
          id: `profile-${Date.now()}`,
          name,
          command: cmd,
          cwd,
        });
        this.inputProfileName.value = "";
        this.inputProfileCmd.value = "";
        this.inputProfileCwd.value = "";
        this.saveCustomProfiles();
      }
    });

    this.toggleRestoreSession.addEventListener("change", async () => {
      this.settings.restoreSessionOnStartup = this.toggleRestoreSession.checked;
      this.saveSettings();
      if (!this.settings.restoreSessionOnStartup) {
        try {
          await invoke("clear_session_snapshot");
        } catch (e) {
          console.debug("Error al limpiar instantánea de sesión:", e);
        }
      } else {
        this.scheduleAutoSave();
      }
    });

    if (this.toggleShowOverFullscreen) {
      this.toggleShowOverFullscreen.addEventListener("change", async () => {
        this.settings.showOverFullscreen = this.toggleShowOverFullscreen.checked;
        this.saveSettings();
        try {
          await invoke("set_show_over_fullscreen", { enabled: this.settings.showOverFullscreen });
        } catch (err) {
          console.error("Error al actualizar visibilidad sobre pantalla completa:", err);
        }
      });
    }

    // Escuchar solicitud de salida del System Tray
    listen("tray-quit-requested", async () => {
      if (this.settings.restoreSessionOnStartup) {
        await this.saveSessionSnapshot();
      }
      try {
        await invoke("quit_app_immediately");
      } catch (err) {
        console.error("Error al salir inmediatamente:", err);
      }
    });

    // Guardado de emergencia en evento beforeunload de la ventana
    window.addEventListener("beforeunload", () => {
      if (this.settings.restoreSessionOnStartup) {
        this.saveSessionSnapshot();
      }
    });

    // Selección reactiva de color de acento
    const swatches = document.querySelectorAll<HTMLElement>(".color-swatch");
    swatches.forEach((swatch) => {
      swatch.addEventListener("click", () => {
        const color = swatch.dataset.color;
        if (color) {
          this.settings.accentColor = color;
          this.applyAccentColor(color);
          this.saveSettings();
        }
      });
    });

    if (this.inputAccentPicker) {
      this.inputAccentPicker.addEventListener("input", () => {
        this.applyAccentColor(this.inputAccentPicker.value);
      });
      this.inputAccentPicker.addEventListener("change", () => {
        this.settings.accentColor = this.inputAccentPicker.value;
        this.applyAccentColor(this.inputAccentPicker.value);
        this.saveSettings();
      });
    }

    document.addEventListener("click", () => {
      this.shellMenuPopover.classList.add("hidden");
      this.settingsPopover.classList.add("hidden");
    });

    // Custom event dispatched from Xterm (Ctrl+W)
    window.addEventListener("vayli:close-active-pane", () => {
      this.closeActivePaneOrTab();
    });

    // 7. Anti-Flicker: Sincronización precisa con fin de animación CSS
    this.islandContainer.addEventListener("transitionend", (e) => {
      if (e.propertyName === "width" || e.propertyName === "height") {
        if (this.currentMode === "expanded") {
          this.fitActiveTabPanes();
        }
      }
    });

    // 8. Global Keyboard Shortcuts
    window.addEventListener("keydown", (e) => {
      // Escape collapses expanded island (or closes search bar / popovers)
      if (e.key === "Escape") {
        if (!this.searchBar.classList.contains("hidden")) {
          e.preventDefault();
          this.closeSearchBar();
          return;
        }
        if (!this.settingsPopover.classList.contains("hidden")) {
          e.preventDefault();
          this.settingsPopover.classList.add("hidden");
          return;
        }
        if (!this.shellMenuPopover.classList.contains("hidden")) {
          e.preventDefault();
          this.shellMenuPopover.classList.add("hidden");
          return;
        }
        if (this.currentMode !== "collapsed") {
          e.preventDefault();
          this.shellMenuPopover.classList.add("hidden");
          this.settingsPopover.classList.add("hidden");
          this.setMode("collapsed");
          return;
        }
      }

      // Ctrl+Shift+F: Toggle Search in Buffer
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        this.toggleSearchBar();
        return;
      }

      // Ctrl+Shift+D: Split Vertical
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        this.splitActiveTab("split-vertical");
        return;
      }

      // Ctrl+Shift+E: Split Horizontal
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        this.splitActiveTab("split-horizontal");
        return;
      }

      // Alt+Arrows: Focus navigation between split panes
      if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        this.navigateSplitPane();
        return;
      }

      // Ctrl+Shift+T: Open Quick Shell Launcher Popover
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        if (this.currentMode !== "expanded") {
          this.setMode("expanded").then(() => {
            this.shellMenuPopover.classList.toggle("hidden");
          });
        } else {
          this.shellMenuPopover.classList.toggle("hidden");
        }
        return;
      }

      // Ctrl+T: New Tab
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        this.createTab();
        return;
      }

      // Ctrl+W: Close Active Pane / Tab
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "w") {
        e.preventDefault();
        this.closeActivePaneOrTab();
        return;
      }
    });
  }

  public toggleSearchBar() {
    if (this.currentMode !== "expanded") {
      this.setMode("expanded").then(() => {
        this.searchBar.classList.remove("hidden");
        this.searchInput.focus();
        this.searchInput.select();
      });
    } else {
      this.searchBar.classList.toggle("hidden");
      if (!this.searchBar.classList.contains("hidden")) {
        this.searchInput.focus();
        this.searchInput.select();
      } else {
        const activePane = this.getActivePane();
        if (activePane) activePane.terminal.focus();
      }
    }
  }

  public closeSearchBar() {
    this.searchBar.classList.add("hidden");
    const activePane = this.getActivePane();
    if (activePane) {
      activePane.terminal.focus();
    }
  }

  public async setMode(mode: IslandMode, notifyBackend = true) {
    this.currentMode = mode;

    this.islandContainer.classList.remove("state-collapsed", "state-glance", "state-expanded");
    this.islandContainer.classList.add(`state-${mode}`);

    if (mode !== "expanded") {
      this.shellMenuPopover.classList.add("hidden");
      this.settingsPopover.classList.add("hidden");
      this.closeSearchBar();
    }

    if (notifyBackend) {
      try {
        await invoke("set_island_state", { state: mode });
      } catch (err) {
        console.warn("Failed to set island native window size:", err);
      }
    }

    if (mode === "expanded") {
      this.fitActiveTabPanes();
    }
  }

  public async createTab(shellPath?: string, cwd?: string): Promise<string> {
    this.tabCounter += 1;
    const tabIndex = this.tabCounter;
    const tabId = `tab-${tabIndex}`;

    const containerEl = document.createElement("div");
    containerEl.className = "tab-panes-container layout-single";
    containerEl.id = `container-${tabId}`;
    this.viewportEl.appendChild(containerEl);

    const defaultTitle = shellPath
      ? shellPath.split(/[/\\]/).pop() || shellPath
      : navigator.platform.includes("Win")
        ? "powershell"
        : "bash";

    const tab: TerminalTab = {
      id: tabId,
      title: `${tabIndex}: ${defaultTitle}`,
      layout: "single",
      panes: [],
      activePaneId: "",
      containerElement: containerEl,
    };

    this.tabs.set(tabId, tab);

    // Create the initial pane inside this tab
    await this.addPaneToTab(tab, shellPath, cwd);

    this.renderTabsList();
    this.switchTab(tabId);
    this.updatePillSummary();
    this.scheduleAutoSave();

    return tabId;
  }

  private async addPaneToTab(
    tab: TerminalTab,
    shellPath?: string,
    cwd?: string,
    initialBuffer?: string,
    overrideProcessName?: string
  ): Promise<TerminalPane> {
    this.paneCounter += 1;
    const paneId = `pane-${this.paneCounter}`;

    const cols = 80;
    const rows = 24;

    const sessionId = await invoke<string>("create_pty_session", {
      shellPath: shellPath ?? null,
      cwd: cwd ?? null,
      cols,
      rows,
    });

    const shellDisplay = overrideProcessName || (shellPath
      ? shellPath.split(/[/\\]/).pop() || shellPath
      : navigator.platform.includes("Win")
        ? "powershell"
        : "bash");

    const paneEl = document.createElement("div");
    paneEl.className = "terminal-pane active-pane";
    paneEl.id = paneId;
    tab.containerElement.appendChild(paneEl);

    const { terminal, fitAddon, searchAddon, serializeAddon, serializeBuffer, smartPaste, writeBatched, isUserScrolledUp, mount } =
      createTerminalInstance(sessionId, this.settings.accentColor);
    mount(paneEl);

    if (initialBuffer && initialBuffer.length > 0) {
      const restoredData = initialBuffer + "\r\n\x1b[90m── Sesión restaurada ──\x1b[0m\r\n";
      terminal.write(restoredData, () => {
        terminal.scrollToBottom();
      });
    }

    const pane: TerminalPane = {
      id: paneId,
      sessionId,
      processName: shellDisplay,
      shellPath,
      status: "idle",
      lastSnippet: initialBuffer ? "Sesión restaurada" : "Terminal lista",
      terminal,
      fitAddon,
      searchAddon,
      serializeAddon,
      serializeBuffer,
      smartPaste,
      writeBatched,
      isUserScrolledUp,
      element: paneEl,
    };

    // Pane micro-header bar (Shell tag + Close button)
    const headerBar = document.createElement("div");
    headerBar.className = "pane-header-bar";

    const shellTag = document.createElement("span");
    shellTag.className = "pane-shell-tag";
    shellTag.textContent = shellDisplay;

    const closeBtn = document.createElement("button");
    closeBtn.className = "pane-close-btn";
    closeBtn.innerHTML = "&times;";
    closeBtn.title = "Cerrar panel (Ctrl+W)";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.closePane(tab, pane);
    });

    headerBar.appendChild(shellTag);
    headerBar.appendChild(closeBtn);
    paneEl.appendChild(headerBar);

    // Click to focus this pane
    paneEl.addEventListener("click", () => {
      this.setActivePaneInTab(tab, paneId);
    });

    tab.panes.push(pane);
    this.setActivePaneInTab(tab, paneId);

    // Setup PTY Streaming & Status Listeners
    const outputUnlisten = await listen<string>(`pty-output-${sessionId}`, (event) => {
      pane.writeBatched(event.payload);

      const clean = stripAnsi(event.payload);
      if (clean.length > 0) {
        pane.lastSnippet = clean;
      }

      this.updatePaneStatus(tab, pane, "running");

      const prevTimer = this.activityTimers.get(sessionId);
      if (prevTimer) clearTimeout(prevTimer);

      const newTimer = window.setTimeout(() => {
        if (pane.status === "running") {
          this.updatePaneStatus(tab, pane, "idle");
        }
      }, 1500);

      this.activityTimers.set(sessionId, newTimer);
      this.scheduleAutoSave();
    });

    const statusUnlisten = await listen<PtyStatus>(`pty-status-${sessionId}`, (event) => {
      const exitCode = event.payload.exitCode;
      const status = exitCode === null || exitCode === 0 ? "done" : "error";
      this.updatePaneStatus(tab, pane, status);
      this.scheduleAutoSave();
    });

    this.unlisteners.set(sessionId, [outputUnlisten, statusUnlisten]);
    this.scheduleAutoSave();

    return pane;
  }

  public async splitActiveTab(layout: "split-vertical" | "split-horizontal") {
    if (!this.activeTabId) return;
    const tab = this.tabs.get(this.activeTabId);
    if (!tab) return;

    if (tab.panes.length >= 4) {
      return; // Maximum 4 split panes per tab for performance
    }

    tab.layout = layout;
    tab.containerElement.className = `tab-panes-container active layout-${layout}`;

    // Add new pane to tab
    await this.addPaneToTab(tab);

    this.fitActiveTabPanes();
    this.updatePillSummary();
    this.scheduleAutoSave();
  }

  public navigateSplitPane() {
    if (!this.activeTabId) return;
    const tab = this.tabs.get(this.activeTabId);
    if (!tab || tab.panes.length <= 1) return;

    const currentIndex = tab.panes.findIndex((p) => p.id === tab.activePaneId);
    const nextIndex = (currentIndex + 1) % tab.panes.length;
    const nextPane = tab.panes[nextIndex];
    this.setActivePaneInTab(tab, nextPane.id);
  }

  private setActivePaneInTab(tab: TerminalTab, paneId: string) {
    tab.activePaneId = paneId;
    tab.panes.forEach((p) => {
      if (p.id === paneId) {
        p.element.classList.add("active-pane");
        p.terminal.focus();
      } else {
        p.element.classList.remove("active-pane");
      }
    });

    if (tab.id === this.activeTabId) {
      this.updatePillSummary();
    }
  }

  private getActivePane(): TerminalPane | null {
    if (!this.activeTabId) return null;
    const tab = this.tabs.get(this.activeTabId);
    if (!tab) return null;
    return tab.panes.find((p) => p.id === tab.activePaneId) || tab.panes[0] || null;
  }

  public fitActiveTabPanes() {
    if (!this.activeTabId) return;
    const tab = this.tabs.get(this.activeTabId);
    if (!tab) return;

    requestAnimationFrame(() => {
      tab.panes.forEach((pane) => {
        fitSafely(pane.terminal, pane.fitAddon, pane.sessionId, pane.isUserScrolledUp());
      });
      const active = this.getActivePane();
      if (active) active.terminal.focus();
    });
  }

  public switchTab(tabId: string) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    this.activeTabId = tabId;

    this.tabs.forEach((t) => {
      if (t.id === tabId) {
        t.containerElement.classList.add("active");
      } else {
        t.containerElement.classList.remove("active");
      }
    });

    this.renderTabsList();
    this.updatePillSummary();
    this.scheduleAutoSave();

    if (this.currentMode === "expanded") {
      this.fitActiveTabPanes();
    }
  }

  public async closeActivePaneOrTab() {
    if (!this.activeTabId) return;
    const tab = this.tabs.get(this.activeTabId);
    if (!tab) return;

    if (tab.panes.length > 1) {
      // Close active pane only
      const pane = this.getActivePane();
      if (pane) {
        this.closePane(tab, pane);
      }
    } else {
      // Close entire tab
      this.closeTab(tab.id);
    }
  }

  private closePane(tab: TerminalTab, pane: TerminalPane) {
    const timer = this.activityTimers.get(pane.sessionId);
    if (timer) clearTimeout(timer);
    this.activityTimers.delete(pane.sessionId);

    const sessionUnlisteners = this.unlisteners.get(pane.sessionId);
    if (sessionUnlisteners) {
      sessionUnlisteners.forEach((fn) => fn());
      this.unlisteners.delete(pane.sessionId);
    }

    try {
      invoke("kill_pty_session", { sessionId: pane.sessionId }).catch(() => {});
    } catch {}

    pane.terminal.dispose();
    pane.element.remove();
    tab.panes = tab.panes.filter((p) => p.id !== pane.id);

    if (tab.panes.length === 1) {
      tab.layout = "single";
      tab.containerElement.className = "tab-panes-container active layout-single";
    }

    if (tab.panes.length === 0) {
      this.closeTab(tab.id);
      return;
    }

    if (tab.panes.length > 0) {
      this.setActivePaneInTab(tab, tab.panes[0].id);
      this.fitActiveTabPanes();
    }
    this.renderTabsList();
    this.updatePillSummary();
    this.scheduleAutoSave();
  }

  public async closeTab(tabId: string) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    // Close all panes inside this tab
    tab.panes.forEach((pane) => {
      const timer = this.activityTimers.get(pane.sessionId);
      if (timer) clearTimeout(timer);
      this.activityTimers.delete(pane.sessionId);

      const sessionUnlisteners = this.unlisteners.get(pane.sessionId);
      if (sessionUnlisteners) {
        sessionUnlisteners.forEach((fn) => fn());
        this.unlisteners.delete(pane.sessionId);
      }

      try {
        invoke("kill_pty_session", { sessionId: pane.sessionId }).catch(() => {});
      } catch {}

      pane.terminal.dispose();
    });

    tab.containerElement.remove();
    this.tabs.delete(tabId);

    if (this.tabs.size === 0) {
      await this.createTab();
    } else if (this.activeTabId === tabId) {
      const nextTabId = this.tabs.keys().next().value;
      if (nextTabId) {
        this.switchTab(nextTabId);
      }
    }

    this.renderTabsList();
    this.updatePillSummary();
    this.scheduleAutoSave();
  }

  public scheduleAutoSave() {
    if (!this.settings.restoreSessionOnStartup) return;
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
    }
    this.autoSaveTimer = window.setTimeout(() => {
      this.saveSessionSnapshot().catch((err) => {
        console.debug("[Snapshot] Auto-guardado diferido:", err);
      });
    }, 3000);
  }

  public async saveSessionSnapshot(): Promise<void> {
    if (!this.settings.restoreSessionOnStartup) return;
    if (this.isSavingSnapshot) return;
    this.isSavingSnapshot = true;

    try {
      const snapshotTabs: SnapshotTab[] = [];

      for (const [_, tab] of this.tabs.entries()) {
        const snapshotPanes: SnapshotPane[] = [];

        for (const pane of tab.panes) {
          let cwd: string | undefined;
          try {
            const queriedCwd = await invoke<string | null>("get_session_cwd", {
              sessionId: pane.sessionId,
            });
            if (queriedCwd) {
              cwd = queriedCwd;
            }
          } catch (e) {
            console.debug(`[Snapshot] Error al consultar CWD de sesión ${pane.sessionId}:`, e);
          }

          const serializedBuffer = pane.serializeBuffer ? pane.serializeBuffer(500) : "";

          snapshotPanes.push({
            id: pane.id,
            shellPath: pane.shellPath,
            processName: pane.processName,
            cwd,
            serializedBuffer,
          });
        }

        snapshotTabs.push({
          id: tab.id,
          title: tab.title,
          layout: tab.layout,
          activePaneId: tab.activePaneId,
          panes: snapshotPanes,
        });
      }

      if (snapshotTabs.length === 0) {
        return;
      }

      const snapshot: SessionSnapshot = {
        version: 1,
        timestamp: Date.now(),
        activeTabId: this.activeTabId || snapshotTabs[0].id,
        tabs: snapshotTabs,
      };

      await invoke("save_session_snapshot", {
        payload: JSON.stringify(snapshot),
      });
    } catch (err) {
      console.error("[Snapshot] Error al guardar la instantánea de sesión:", err);
    } finally {
      this.isSavingSnapshot = false;
    }
  }

  public async restoreSession(): Promise<boolean> {
    try {
      const rawSnapshot = await invoke<string | null>("load_session_snapshot");
      if (!rawSnapshot) return false;

      const snapshot: SessionSnapshot = JSON.parse(rawSnapshot);
      if (!snapshot.tabs || snapshot.tabs.length === 0) return false;

      for (const savedTab of snapshot.tabs) {
        this.tabCounter += 1;
        const tabIndex = this.tabCounter;
        const tabId = `tab-${tabIndex}`;

        const containerEl = document.createElement("div");
        const layout = savedTab.layout || "single";
        containerEl.className = `tab-panes-container layout-${layout}`;
        containerEl.id = `container-${tabId}`;
        this.viewportEl.appendChild(containerEl);

        const tab: TerminalTab = {
          id: tabId,
          title: savedTab.title || `${tabIndex}: terminal`,
          layout,
          panes: [],
          activePaneId: "",
          containerElement: containerEl,
        };

        this.tabs.set(tabId, tab);

        for (const savedPane of savedTab.panes) {
          await this.addPaneToTab(
            tab,
            savedPane.shellPath,
            savedPane.cwd,
            savedPane.serializedBuffer,
            savedPane.processName
          );
        }

        if (tab.panes.length > 0) {
          const activeIndex = savedTab.panes.findIndex((p) => p.id === savedTab.activePaneId);
          const targetPane = activeIndex >= 0 ? tab.panes[activeIndex] : tab.panes[0];
          this.setActivePaneInTab(tab, targetPane.id);
        }
      }

      this.renderTabsList();

      const targetTabId = snapshot.activeTabId && this.tabs.has(snapshot.activeTabId)
        ? snapshot.activeTabId
        : this.tabs.keys().next().value;

      if (targetTabId) {
        this.switchTab(targetTabId);
      }
      this.updatePillSummary();
      return true;
    } catch (err) {
      console.error("[Restauración] Error al restaurar sesión previa:", err);
      return false;
    }
  }

  private updatePaneStatus(tab: TerminalTab, pane: TerminalPane, status: "idle" | "running" | "done" | "error") {
    pane.status = status;
    if (this.activeTabId === tab.id && tab.activePaneId === pane.id) {
      this.updateRimLight(status);
      this.updatePillSummary();
    }

    const dot = document.querySelector(`.tab-item[data-tab-id="${tab.id}"] .tab-status-dot`);
    if (dot) {
      dot.className = `tab-status-dot ${status}`;
    }
  }

  private updateRimLight(status: "idle" | "running" | "done" | "error") {
    this.rimLight.className = `rim-light ${status}`;
    this.statusOrb.className = `status-orb ${status}`;
    this.glanceOrb.className = `status-orb ${status}`;
  }

  private updatePillSummary() {
    let totalPanes = 0;
    this.tabs.forEach((t) => (totalPanes += t.panes.length));
    this.ttyBadge.textContent = `${totalPanes} PTY`;

    const activePane = this.getActivePane();
    if (activePane) {
      const activeTab = this.tabs.get(this.activeTabId!);
      this.currentProcessEl.textContent = activePane.processName;
      this.glanceTitle.textContent = activeTab?.title || activePane.processName;
      this.glanceSnippet.textContent = activePane.lastSnippet || "Lista";
      this.glanceStatusTag.textContent = activePane.status.toUpperCase();
      this.glanceStatusTag.className = `glance-status-tag ${activePane.status}`;
      this.updateRimLight(activePane.status);

      // Update Live Log widget in pill mode
      if (this.pillLogProcEl && this.pillLogSnippetEl) {
        const shortProc = activePane.processName.replace(/\.exe$/i, "").slice(0, 10);
        this.pillLogProcEl.textContent = `${shortProc}:`;
        this.pillLogSnippetEl.textContent = activePane.lastSnippet || "Lista";
      }
    }
  }

  private renderTabsList() {
    this.tabsListEl.innerHTML = "";

    this.tabs.forEach((tab) => {
      const tabEl = document.createElement("div");
      tabEl.className = `tab-item ${tab.id === this.activeTabId ? "active" : ""}`;
      tabEl.dataset.tabId = tab.id;

      const activePane = tab.panes.find((p) => p.id === tab.activePaneId) || tab.panes[0];
      const status = activePane ? activePane.status : "idle";

      const dot = document.createElement("span");
      dot.className = `tab-status-dot ${status}`;

      const title = document.createElement("span");
      const splitIndicator = tab.panes.length > 1 ? ` (${tab.panes.length})` : "";
      title.textContent = tab.title + splitIndicator;

      const closeBtn = document.createElement("button");
      closeBtn.className = "tab-close-btn";
      closeBtn.innerHTML = "&times;";
      closeBtn.title = "Cerrar pestaña (Ctrl+W)";
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.closeTab(tab.id);
      });

      tabEl.appendChild(dot);
      tabEl.appendChild(title);
      tabEl.appendChild(closeBtn);

      tabEl.addEventListener("click", () => {
        this.switchTab(tab.id);
      });

      this.tabsListEl.appendChild(tabEl);
    });
  }
}

// Bootstrap application on DOM load
window.addEventListener("DOMContentLoaded", () => {
  const app = new VayliIslandApp();
  app.init().catch(console.error);
});
