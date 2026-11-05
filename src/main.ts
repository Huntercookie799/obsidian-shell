import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { updateTerminalAccentTheme, updateTerminalBackground } from "./components/TerminalView";
import { IslandMode, ObsidianSettings, TerminalPane } from "./types";
import { updateManager } from "./updater/UpdateManager";
import { formatPathSnippet, promptOpenFolder, promptSelectWallpaperImage } from "./utils/formatters";
import { AppearanceManager } from "./components/popovers/AppearanceManager";
import { FolderHistoryPopover } from "./components/popovers/FolderHistoryPopover";
import { ShellLauncherPopover } from "./components/popovers/ShellLauncherPopover";
import { SettingsPopover } from "./components/popovers/SettingsPopover";
import { PillWidgets } from "./components/widgets/PillWidgets";
import { TabManager } from "./components/terminal/TabManager";
import { SearchBar } from "./components/terminal/SearchBar";
import { IslandController } from "./components/island/IslandController";
import { DockingManager } from "./components/island/DockingManager";
import { ResizeManager } from "./components/island/ResizeManager";
import { stateManager } from "./core/StateManager";

export { formatPathSnippet, promptOpenFolder, promptSelectWallpaperImage };

class VayliIslandApp {
  private settings: ObsidianSettings = stateManager.getSettings();

  // Modular Component Controllers
  private appearanceManager!: AppearanceManager;
  private folderPopover!: FolderHistoryPopover;
  private shellPopover!: ShellLauncherPopover;
  private settingsPopoverController!: SettingsPopover;
  private pillWidgets!: PillWidgets;
  private tabManager!: TabManager;
  private searchBar!: SearchBar;
  private islandController!: IslandController;
  private dockingManager!: DockingManager;
  private resizeManager!: ResizeManager;

  // Header & Update DOM
  private btnVersionBadge!: HTMLButtonElement;
  private versionText!: HTMLElement;
  private popoverVersionText!: HTMLElement;
  private btnPopoverUpdate!: HTMLButtonElement;
  private btnAddTab!: HTMLButtonElement;
  private btnFolderMenu!: HTMLButtonElement;
  private btnShellMenu!: HTMLButtonElement;
  private btnSettings!: HTMLButtonElement;
  private btnToggleSearch!: HTMLButtonElement;
  private btnSplitVertical!: HTMLButtonElement;
  private btnSplitHorizontal!: HTMLButtonElement;

  public async init() {
    this.appearanceManager = new AppearanceManager({
      onAccentChange: (hex) => {
        this.tabManager.getAllTabs().forEach((tab) => {
          tab.panes.forEach((pane) => {
            updateTerminalAccentTheme(pane.terminal, hex);
          });
        });
      },
      onBackgroundChange: () => {
        this.tabManager.getAllTabs().forEach((tab) => {
          tab.panes.forEach((pane) => {
            updateTerminalBackground(pane.terminal, "transparent");
          });
        });
      },
    });

    this.folderPopover = new FolderHistoryPopover(async (folderPath) => {
      await this.openFolderInTerminal(folderPath);
    });

    this.shellPopover = new ShellLauncherPopover(async (cmd, cwd) => {
      await this.tabManager.createTab(cmd, cwd);
    });

    this.settingsPopoverController = new SettingsPopover({
      onDockPositionChange: async (pos) => {
        await this.dockingManager.setDockPosition(pos);
      },
      onWidgetChange: () => {
        this.pillWidgets.applyWidget(this.settings.collapsedWidget);
        this.updatePillSummary();
      },
      onClock24hChange: () => {
        this.pillWidgets.updateClock();
      },
      onAutoHideChange: (enabled) => {
        this.islandController.resetIdleTimer();
        if (!enabled) {
          this.islandController.showFromIdle();
        }
      },
    });

    this.pillWidgets = new PillWidgets();

    this.tabManager = new TabManager({
      getAccentColor: () => this.settings.accentColor || "#FF6B00",
      isExpanded: () => this.islandController.isExpanded(),
      onPillSummaryUpdate: () => this.updatePillSummary(),
      onRimLightUpdate: (status) => this.islandController.updateRimLight(status),
      onCliNotification: (notif) => {
        this.islandController.handleCliNotification(notif);
        if (this.islandController.isExpanded() && notif.tabId !== this.tabManager.getActiveTabId()) {
          const dot = document.querySelector(`.tab-item[data-tab-id="${notif.tabId}"] .tab-status-dot`);
          if (dot) {
            dot.className = `tab-status-dot ${notif.type === "eleccion" ? "warning" : "success"}`;
          }
        }
      },
      onDismissCliNotification: (collapse) => this.islandController.dismissCliNotification(collapse),
      getActiveCliNotification: () => this.islandController.getActiveCliNotification(),
      isRestoreSessionEnabled: () => !!this.settings.restoreSessionOnStartup,
    });

    this.searchBar = new SearchBar({
      getActivePane: () => this.tabManager.getActivePane(),
      onRequestExpand: async () => {
        if (!this.islandController.isExpanded()) {
          await this.islandController.setMode("expanded");
        }
      },
    });

    this.islandController = new IslandController({
      isAnyPopoverOpen: () => this.isAnyPopoverOpen(),
      isSearchBarOpen: () => this.searchBar.isVisible(),
      closeAllPopovers: () => this.closeAllPopovers(),
      closeSearchBar: () => this.searchBar.close(),
      getActivePane: () => this.tabManager.getActivePane(),
      getActiveTabTitle: () => this.tabManager.getActiveTab()?.title,
      fitActiveTabPanes: (seq, reset) => this.tabManager.fitActiveTabPanes(seq, reset),
      onConfirmPrompt: (sid) => {
        invoke("write_to_pty", { sessionId: sid, data: "\r" }).catch((err) => {
          console.error("Error al enviar Enter al PTY:", err);
        });
        const tracker = this.tabManager.getCliTracker(sid);
        if (tracker) tracker.onUserInput();
      },
      onOpenNotificationTab: (tabId) => {
        this.tabManager.switchTab(tabId);
      },
      onModeChanged: (mode) => {
        if (mode === "collapsed") {
          this.pillWidgets.resume();
        } else {
          this.pillWidgets.pause();
        }
      },
      onIdleStateChanged: (isHidden) => {
        if (isHidden) {
          this.pillWidgets.pause();
        } else if (this.islandController.getMode() === "collapsed") {
          this.pillWidgets.resume();
        }
      },
    });

    this.dockingManager = new DockingManager({
      onDockPositionChanged: (pos) => {
        this.settingsPopoverController.syncDockPosition(pos.type);
      },
    });

    this.resizeManager = new ResizeManager({
      isExpanded: () => this.islandController.isExpanded(),
      onResizing: () => this.tabManager.fitActiveTabPanes(false),
      onResizeEnd: () => {
        this.tabManager.fitActiveTabPanes(false);
        const activeTab = this.tabManager.getActiveTab();
        if (activeTab) {
          activeTab.panes.forEach((pane) => {
            if (pane.resetScrollToBottom) {
              pane.resetScrollToBottom();
            } else {
              pane.terminal.scrollToBottom();
            }
          });
        }
      },
    });

    this.cacheDom();
    this.initControllersDom();
    await this.loadSettings();
    this.bindEvents();
    this.listenToBackendState();

    // Initialize Auto-Updater & Version Manager
    await this.initUpdater();

    // Check if session restoration is enabled and attempt restoring snapshot
    let restored = false;
    if (this.settings.restoreSessionOnStartup) {
      restored = await this.tabManager.restoreSession();
    }

    if (!restored) {
      await this.tabManager.createTab();
    }

    // Set initial collapsed geometry
    await this.islandController.setMode("collapsed");
  }

  private cacheDom(): void {
    document.documentElement.style.backgroundColor = "transparent";
    document.body.style.backgroundColor = "transparent";

    this.btnAddTab = document.getElementById("btn-add-tab") as HTMLButtonElement;
    this.btnFolderMenu = document.getElementById("btn-folder-menu") as HTMLButtonElement;
    this.btnShellMenu = document.getElementById("btn-shell-menu") as HTMLButtonElement;
    this.btnSettings = document.getElementById("btn-settings") as HTMLButtonElement;
    this.btnToggleSearch = document.getElementById("btn-toggle-search") as HTMLButtonElement;
    this.btnSplitVertical = document.getElementById("btn-split-vertical") as HTMLButtonElement;
    this.btnSplitHorizontal = document.getElementById("btn-split-horizontal") as HTMLButtonElement;

    this.btnVersionBadge = document.getElementById("btn-version-badge") as HTMLButtonElement;
    this.versionText = document.getElementById("version-text")!;
    this.popoverVersionText = document.getElementById("popover-version-text")!;
    this.btnPopoverUpdate = document.getElementById("btn-popover-update") as HTMLButtonElement;
  }

  private initControllersDom(): void {
    this.islandController.initDom();
    this.dockingManager.initDom();
    this.resizeManager.initDom();
    this.pillWidgets.initDom();
    this.appearanceManager.initDom();
    this.folderPopover.initDom();
    this.shellPopover.initDom();
    this.settingsPopoverController.initDom();
    this.tabManager.initDom();
    this.searchBar.initDom();
  }

  private async loadSettings(): Promise<void> {
    this.settings = stateManager.loadSettings();
    await this.settingsPopoverController.syncValuesFromSettings();

    try {
      await invoke("set_show_over_fullscreen", { enabled: !!this.settings.showOverFullscreen });
    } catch (err) {
      console.debug("Error al sincronizar visibilidad sobre pantalla completa inicial:", err);
    }

    this.folderPopover.render();

    // Aplicar personalización estética persistida
    this.appearanceManager.applyAccentColor(this.settings.accentColor || "#FF6B00");
    this.pillWidgets.applyWidget(this.settings.collapsedWidget);
    this.updatePillSummary();

    if (this.settings.targetMonitorIndex !== undefined) {
      try {
        await invoke("set_active_monitor", { monitorIndex: this.settings.targetMonitorIndex });
      } catch (err) {
        console.debug("Error al ubicar notch en pantalla guardada:", err);
      }
    }

    await this.settingsPopoverController.refreshMonitorsList();

    const opacity = typeof this.settings.terminalOpacity === "number" ? this.settings.terminalOpacity : 0.70;
    this.appearanceManager.applyTerminalOpacity(opacity);

    const blur = typeof this.settings.terminalBlur === "number" ? this.settings.terminalBlur : 14;
    this.appearanceManager.applyTerminalBlur(blur);

    if (this.settings.terminalWallpaper) {
      await this.appearanceManager.setTerminalWallpaper(this.settings.terminalWallpaper);
    } else {
      this.appearanceManager.clearTerminalWallpaper();
    }

    this.islandController.resetIdleTimer();
  }

  private updatePillSummary(): void {
    let totalPanes = 0;
    this.tabManager.getAllTabs().forEach((t) => (totalPanes += t.panes.length));
    const activePane = this.tabManager.getActivePane();
    const procName = activePane?.processName || "terminal";
    const snippet = activePane?.lastSnippet || "Lista";

    this.pillWidgets.updateSummary(totalPanes, procName, snippet);

    if (activePane) {
      const activeTab = this.tabManager.getActiveTab();
      const title = activeTab?.title || activePane.processName;
      this.islandController.updateGlanceView(title, snippet, activePane.status);
      this.islandController.updateRimLight(activePane.status);
    }
  }

  public isAnyPopoverOpen(): boolean {
    return (
      this.settingsPopoverController.isVisible() ||
      this.shellPopover.isVisible() ||
      this.folderPopover.isVisible()
    );
  }

  public closeAllPopovers(): void {
    this.settingsPopoverController?.hide();
    this.shellPopover?.hide();
    this.folderPopover?.hide();
  }

  public async toggleFolderMenu(): Promise<void> {
    if (!this.islandController.isExpanded()) {
      await this.islandController.setMode("expanded");
    }
    this.shellPopover.hide();
    this.settingsPopoverController.hide();
    this.folderPopover.toggle();
  }

  public async toggleShellMenu(): Promise<void> {
    if (!this.islandController.isExpanded()) {
      await this.islandController.setMode("expanded");
    }
    this.folderPopover.hide();
    this.settingsPopoverController.hide();
    this.shellPopover.toggle();
  }

  public async toggleSettings(): Promise<void> {
    if (!this.islandController.isExpanded()) {
      await this.islandController.setMode("expanded");
    }
    this.shellPopover.hide();
    this.folderPopover.hide();
    this.settingsPopoverController.toggle();
  }

  public async openFolderInTerminal(folderPath: string): Promise<void> {
    if (!folderPath) return;
    this.settings.recentFolders = stateManager.addRecentFolder(folderPath);
    this.folderPopover.render();

    if (!this.islandController.isExpanded()) {
      await this.islandController.setMode("expanded");
    }

    await this.tabManager.createTab(undefined, folderPath);
  }

  public getActivePane(): TerminalPane | null {
    return this.tabManager.getActivePane();
  }

  private async initUpdater(): Promise<void> {
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

  private async listenToBackendState(): Promise<void> {
    await listen<IslandMode>("island-state-changed", (event) => {
      this.islandController.setMode(event.payload, false);
    });

    await listen("edge-hover-wakeup", () => {
      this.islandController.resetIdleTimer();
    });

    listen<number>("monitor-changed", (event) => {
      const newIdx = event.payload;
      stateManager.saveSettings({ targetMonitorIndex: newIdx });
      this.settingsPopoverController.syncActiveMonitor(newIdx);
    });

    listen("tray-quit-requested", async () => {
      if (this.settings.restoreSessionOnStartup) {
        await this.tabManager.saveSessionSnapshot();
      }
      try {
        await invoke("quit_app_immediately");
      } catch (err) {
        console.error("Error al salir de la aplicación:", err);
      }
    });
  }

  private bindEvents(): void {
    this.btnAddTab.addEventListener("click", (e) => {
      e.stopPropagation();
      this.tabManager.createTab();
    });

    this.btnSplitVertical.addEventListener("click", (e) => {
      e.stopPropagation();
      this.tabManager.splitActiveTab("split-vertical");
    });

    this.btnSplitHorizontal.addEventListener("click", (e) => {
      e.stopPropagation();
      this.tabManager.splitActiveTab("split-horizontal");
    });

    this.btnToggleSearch.addEventListener("click", (e) => {
      e.stopPropagation();
      this.searchBar.toggle();
    });

    this.btnFolderMenu.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleFolderMenu();
    });

    this.btnShellMenu.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleShellMenu();
    });

    this.btnSettings.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleSettings();
    });

    const btnCollapse = document.getElementById("btn-collapse");
    btnCollapse?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.islandController.setMode("collapsed");
    });

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

    window.addEventListener("obsidian:select-wallpaper", () => {
      this.appearanceManager.promptSelectWallpaper();
    });

    window.addEventListener("focus", () => {
      if (this.islandController.isExpanded()) {
        const active = this.tabManager.getActivePane();
        if (active) active.terminal.focus();
      }
    });

    document.getElementById("terminal-viewport")?.addEventListener("mousedown", () => {
      if (this.islandController.isExpanded()) {
        const active = this.tabManager.getActivePane();
        if (active) active.terminal.focus();
      }
    });

    // Custom events emitidos desde terminal
    window.addEventListener("vayli:close-active-pane", () => {
      this.tabManager.closeActivePaneOrTab();
    });

    window.addEventListener("vayli:toggle-folder-menu", () => {
      this.toggleFolderMenu();
    });

    window.addEventListener("vayli:cycle-tab", (e: Event) => {
      const customEvent = e as CustomEvent<{ direction?: "next" | "prev" }>;
      const direction = customEvent.detail?.direction || "next";
      this.tabManager.cycleTab(direction);
    });

    // Intercepción prioritaria en fase de captura para Ctrl+Tab
    window.addEventListener(
      "keydown",
      (e) => {
        if ((e.ctrlKey || e.metaKey) && (e.key === "Tab" || e.code === "Tab")) {
          e.preventDefault();
          e.stopPropagation();
          this.tabManager.cycleTab(e.shiftKey ? "prev" : "next");
        }
      },
      { capture: true }
    );

    // Global Keyboard Shortcuts
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (this.searchBar.isVisible()) {
          e.preventDefault();
          this.searchBar.close();
          return;
        }
        if (this.isAnyPopoverOpen()) {
          e.preventDefault();
          this.closeAllPopovers();
          const activePane = this.tabManager.getActivePane();
          if (activePane) activePane.terminal.focus();
          return;
        }
      }

      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        this.searchBar.toggle();
        return;
      }

      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        this.tabManager.splitActiveTab("split-vertical");
        return;
      }

      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        this.tabManager.splitActiveTab("split-horizontal");
        return;
      }

      if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        this.tabManager.navigateSplitPane();
        return;
      }

      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        this.toggleShellMenu();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        this.toggleFolderMenu();
        return;
      }

      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        this.tabManager.createTab();
        return;
      }

      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "w") {
        e.preventDefault();
        this.tabManager.closeActivePaneOrTab();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === "Tab" || e.code === "Tab")) {
        e.preventDefault();
        e.stopPropagation();
        this.tabManager.cycleTab(e.shiftKey ? "prev" : "next");
        return;
      }
    });
  }
}

// Bootstrap application on DOM load
window.addEventListener("DOMContentLoaded", () => {
  const app = new VayliIslandApp();
  app.init().catch(console.error);
});
