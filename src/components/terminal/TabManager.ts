import { invoke } from "@tauri-apps/api/core";
import { SessionSnapshot, SnapshotPane, SnapshotTab, TerminalPane, TerminalTab } from "../../types";
import { CliActivityTracker, CliNotificationEvent } from "../../utils/cliNotifications";
import { SplitManager } from "./SplitManager";
import { SettingsTab } from "./SettingsTab";
import { AppearanceManager } from "../popovers/AppearanceManager";

export interface TabManagerCallbacks {
  getAccentColor: () => string;
  isExpanded: () => boolean;
  onPillSummaryUpdate: () => void;
  onRimLightUpdate: (status: "idle" | "running" | "done" | "error") => void;
  onCliNotification: (notif: CliNotificationEvent) => void;
  onDismissCliNotification: (collapseToPill: boolean) => void;
  getActiveCliNotification: () => CliNotificationEvent | null;
  isRestoreSessionEnabled: () => boolean;
  onDockPositionChange?: (dock: any) => void;
  onWidgetChange?: (widget: any) => void;
  onClock24hChange?: (is24h: boolean) => void;
  onAutoHideChange?: (enabled: boolean, minutes: number) => void;
}

export class TabManager {
  private tabs: Map<string, TerminalTab> = new Map();
  private activeTabId: string | null = null;
  private tabCounter = 0;
  private lastCycleTabTimestamp = 0;
  private autoSaveTimer: number | null = null;
  private isSavingSnapshot = false;

  private viewportEl!: HTMLElement;
  private tabsListEl!: HTMLElement;
  private splitManager: SplitManager;
  private callbacks: TabManagerCallbacks;
  private settingsTab: SettingsTab | null = null;
  private settingsTabId = "tab-settings";
  private settingsContainerEl: HTMLElement | null = null;
  private appearanceManager: AppearanceManager | null = null;
  private settingsTabCreated = false;

  constructor(callbacks: TabManagerCallbacks, appearanceManager?: AppearanceManager) {
    this.callbacks = callbacks;
    this.appearanceManager = appearanceManager || null;

    this.splitManager = new SplitManager({
      getAccentColor: () => this.callbacks.getAccentColor(),
      isExpanded: () => this.callbacks.isExpanded(),
      onPaneStatusChange: (tab, pane, status) => this.updatePaneStatus(tab, pane, status),
      onActivePaneChange: (tab) => {
        if (tab.id === this.activeTabId) {
          this.callbacks.onPillSummaryUpdate();
        }
      },
      onCliNotification: (notif) => this.callbacks.onCliNotification(notif),
      onDismissCliNotification: (collapse) => this.callbacks.onDismissCliNotification(collapse),
      onScheduleAutoSave: () => this.scheduleAutoSave(),
      onTabEmpty: (tabId) => {
        this.closeTab(tabId);
      },
      onTabsListUpdate: () => this.renderTabsList(),
      getActiveCliNotification: () => this.callbacks.getActiveCliNotification(),
    });
  }

  public initDom(): void {
    this.viewportEl = document.getElementById("terminal-viewport")!;
    this.tabsListEl = document.getElementById("tabs-list")!;

    // Create settings tab container (initially hidden)
    this.settingsContainerEl = document.createElement("div");
    this.settingsContainerEl.className = "tab-panes-container layout-single hidden";
    this.settingsContainerEl.id = `container-${this.settingsTabId}`;
    this.viewportEl.appendChild(this.settingsContainerEl);

    // Initialize SettingsTab
    this.settingsTab = new SettingsTab({
      onDockPositionChange: (dock) => this.callbacks.onDockPositionChange?.(dock),
      onWidgetChange: (widget) => this.callbacks.onWidgetChange?.(widget),
      onClock24hChange: (is24h) => this.callbacks.onClock24hChange?.(is24h),
      onAutoHideChange: (enabled, minutes) => this.callbacks.onAutoHideChange?.(enabled, minutes),
    }, this.appearanceManager);
  }

  public getActiveTabId(): string | null {
    return this.activeTabId;
  }

  public getActiveTab(): TerminalTab | null {
    if (!this.activeTabId) return null;
    return this.tabs.get(this.activeTabId) || null;
  }

  public getActivePane(): TerminalPane | null {
    const tab = this.getActiveTab();
    if (!tab) return null;
    return tab.panes.find((p) => p.id === tab.activePaneId) || tab.panes[0] || null;
  }

  public getAllTabs(): Map<string, TerminalTab> {
    return this.tabs;
  }

  public getCliTracker(sessionId: string): CliActivityTracker | undefined {
    return this.splitManager.getCliTracker(sessionId);
  }

  public async createTab(shellPath?: string, cwd?: string): Promise<string> {
    this.tabCounter += 1;
    const tabIndex = this.tabCounter;
    const tabId = `tab-${tabIndex}`;

    const containerEl = document.createElement("div");
    containerEl.className = "tab-panes-container layout-single";
    containerEl.id = `container-${tabId}`;
    this.viewportEl.appendChild(containerEl);

    const folderName = cwd ? cwd.split(/[/\\]/).filter(Boolean).pop() : undefined;
    const defaultTitle = folderName || (shellPath
      ? shellPath.split(/[/\\]/).pop() || shellPath
      : navigator.platform.includes("Win")
        ? "powershell"
        : "bash");

    const tab: TerminalTab = {
      id: tabId,
      title: `${tabIndex}: ${defaultTitle}`,
      layout: "single",
      panes: [],
      activePaneId: "",
      containerElement: containerEl,
    };

    this.tabs.set(tabId, tab);

    // Crear el panel inicial dentro de esta pestaña
    await this.splitManager.addPaneToTab(tab, shellPath, cwd);

    this.renderTabsList();
    this.switchTab(tabId);
    this.callbacks.onPillSummaryUpdate();
    this.scheduleAutoSave();

    return tabId;
  }

  public switchTab(tabId: string): void {
    // Handle settings tab
    if (tabId === this.settingsTabId) {
      this.activeTabId = tabId;
      this.showSettingsTab();
      this.renderTabsList();
      this.callbacks.onPillSummaryUpdate();
      return;
    }

    const tab = this.tabs.get(tabId);
    if (!tab) return;

    this.activeTabId = tabId;

    const activeNotif = this.callbacks.getActiveCliNotification();
    if (activeNotif && activeNotif.tabId === tabId) {
      this.callbacks.onDismissCliNotification(false);
    }

    this.tabs.forEach((t) => {
      if (t.id === tabId) {
        t.containerElement.classList.add("active");
        t.panes.forEach((p) => p.enableWebgl?.());
      } else {
        t.containerElement.classList.remove("active");
        t.panes.forEach((p) => p.disableWebgl?.());
      }
    });

    // Hide settings tab if visible
    if (this.settingsContainerEl) {
      this.settingsContainerEl.classList.add("hidden");
    }

    this.renderTabsList();
    this.callbacks.onPillSummaryUpdate();
    this.scheduleAutoSave();

    if (this.callbacks.isExpanded()) {
      this.fitActiveTabPanes(true, true);
    }
  }

  private showSettingsTab(): void {
    // Hide all regular tab containers
    this.tabs.forEach((t) => {
      t.containerElement.classList.remove("active");
      t.panes.forEach((p) => p.disableWebgl?.());
    });

    // Show settings container
    if (this.settingsContainerEl) {
      this.settingsContainerEl.classList.remove("hidden");
      this.settingsContainerEl.classList.add("active");
    }

    // Settings tab content is already initialized in createSettingsTab
    // No need to re-initialize here (was causing double render)
  }

  public cycleTab(direction: "next" | "prev" = "next"): void {
    const now = Date.now();
    if (now - this.lastCycleTabTimestamp < 80) return;
    this.lastCycleTabTimestamp = now;

    const tabKeys = Array.from(this.tabs.keys());
    if (tabKeys.length <= 1) return;

    let currentIndex = this.activeTabId ? tabKeys.indexOf(this.activeTabId) : 0;
    if (currentIndex === -1) currentIndex = 0;

    const totalTabs = tabKeys.length;
    const targetIndex = direction === "next"
      ? (currentIndex + 1) % totalTabs
      : (currentIndex - 1 + totalTabs) % totalTabs;

    const targetTabId = tabKeys[targetIndex];
    if (targetTabId) {
      this.switchTab(targetTabId);
      const activePane = this.getActivePane();
      if (activePane) {
        activePane.terminal.focus();
      }
    }
  }

  public async splitActiveTab(layout: "split-vertical" | "split-horizontal"): Promise<void> {
    const tab = this.getActiveTab();
    if (!tab) return;

    await this.splitManager.splitTab(tab, layout);
    this.callbacks.onPillSummaryUpdate();
    this.renderTabsList();
  }

  public navigateSplitPane(): void {
    const tab = this.getActiveTab();
    if (!tab) return;
    this.splitManager.navigateSplitPane(tab);
  }

  public fitActiveTabPanes(withTransitionSequence: boolean = false, resetScrollToBottom: boolean = false): void {
    const tab = this.getActiveTab();
    if (!tab) return;
    this.splitManager.fitTabPanes(tab, withTransitionSequence, resetScrollToBottom);
  }

  public async closeActivePaneOrTab(): Promise<void> {
    const tab = this.getActiveTab();
    if (!tab) return;

    if (tab.panes.length > 1) {
      const pane = this.getActivePane();
      if (pane) {
        this.splitManager.closePane(tab, pane);
      }
    } else {
      await this.closeTab(tab.id);
    }
  }

  public async closeTab(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    // Handle settings tab specially
    if (tabId === this.settingsTabId) {
      this.closeSettingsTab();
      return;
    }

    tab.panes.forEach((pane) => {
      this.splitManager.cleanupSession(pane.sessionId);
      try {
        invoke("kill_pty_session", { sessionId: pane.sessionId }).catch(() => {});
      } catch {}
      pane.disableWebgl?.();
      if (pane.dispose) {
        pane.dispose();
      } else {
        pane.terminal.dispose();
      }
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
    this.callbacks.onPillSummaryUpdate();
    this.scheduleAutoSave();
  }

  /**
   * Closes the settings tab
   */
  public closeSettingsTab(): void {
    const tab = this.tabs.get(this.settingsTabId);
    if (!tab) return;

    // Remove container element
    tab.containerElement.remove();
    this.tabs.delete(this.settingsTabId);
    this.settingsTabCreated = false;
    this.settingsContainerEl = null;
    this.settingsTab = null;

    // Switch to another tab if settings was active
    if (this.activeTabId === this.settingsTabId) {
      const nextTabId = this.tabs.keys().next().value;
      if (nextTabId) {
        this.switchTab(nextTabId);
      }
    }

    this.renderTabsList();
    this.callbacks.onPillSummaryUpdate();
    this.scheduleAutoSave();
  }

  public renderTabsList(): void {
    if (!this.tabsListEl) return;
    this.tabsListEl.innerHTML = "";

    // Render regular tabs (skip settings tab)
    this.tabs.forEach((tab) => {
      // Skip settings tab - it's rendered separately with its own styling
      if (tab.isSettingsTab) return;

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

      // Middle-click (clic central) para cerrar pestaña
      tabEl.addEventListener("auxclick", (e) => {
        if (e.button === 1) {
          e.preventDefault();
          e.stopPropagation();
          this.closeTab(tab.id);
        }
      });

      this.tabsListEl.appendChild(tabEl);
    });

    // Render settings tab in list if it exists
    if (this.settingsTabCreated && this.tabs.has(this.settingsTabId)) {
      this.renderSettingsTabInList();
    }
  }

  /**
   * Opens the settings tab. If it already exists, switches to it.
   * If it doesn't exist, creates it as a new closable tab.
   */
  public openSettingsTab(): void {
    // If settings tab already exists, just switch to it
    if (this.settingsTabCreated && this.tabs.has(this.settingsTabId)) {
      this.switchTab(this.settingsTabId);
      return;
    }

    // Create settings tab as a regular tab
    this.createSettingsTab();
  }

  private createSettingsTab(): void {
    // Create container element
    this.settingsContainerEl = document.createElement("div");
    this.settingsContainerEl.className = "tab-panes-container layout-single";
    this.settingsContainerEl.id = `container-${this.settingsTabId}`;
    this.viewportEl.appendChild(this.settingsContainerEl);

    // Create tab object
    const tab: TerminalTab = {
      id: this.settingsTabId,
      title: "Ajustes",
      layout: "single",
      panes: [],
      activePaneId: "",
      containerElement: this.settingsContainerEl as HTMLDivElement,
      isSettingsTab: true, // Custom property to identify settings tab
    };

    this.tabs.set(this.settingsTabId, tab);
    this.settingsTabCreated = true;

    // Initialize SettingsTab
    this.settingsTab = new SettingsTab({
      onDockPositionChange: (dock) => this.callbacks.onDockPositionChange?.(dock),
      onWidgetChange: (widget) => this.callbacks.onWidgetChange?.(widget),
      onClock24hChange: (is24h) => this.callbacks.onClock24hChange?.(is24h),
      onAutoHideChange: (enabled, minutes) => this.callbacks.onAutoHideChange?.(enabled, minutes),
    }, this.appearanceManager);

    // Initialize the settings content
    this.settingsTab.initDom(this.settingsContainerEl!).catch((err) => {
      console.error("[TabManager] Error initializing settings tab:", err);
    });

    // Switch to the settings tab
    this.switchTab(this.settingsTabId);
    this.renderTabsList();
    this.callbacks.onPillSummaryUpdate();
  }

  /**
   * Renders the settings tab in the tab list (only when it exists)
   */
  private renderSettingsTabInList(): void {
    const settingsTabEl = document.createElement("div");
    settingsTabEl.className = `tab-item settings-tab ${this.activeTabId === this.settingsTabId ? "active" : ""}`;
    settingsTabEl.dataset.tabId = this.settingsTabId;

    const icon = document.createElement("span");
    icon.className = "tab-settings-icon";
    icon.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3"></circle>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
      </svg>
    `;

    const title = document.createElement("span");
    title.textContent = "Ajustes";

    const closeBtn = document.createElement("button");
    closeBtn.className = "tab-close-btn";
    closeBtn.innerHTML = "&times;";
    closeBtn.title = "Cerrar pestaña de ajustes";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.closeSettingsTab();
    });

    settingsTabEl.appendChild(icon);
    settingsTabEl.appendChild(title);
    settingsTabEl.appendChild(closeBtn);

    settingsTabEl.addEventListener("click", () => {
      this.switchTab(this.settingsTabId);
    });

    // Middle-click to close settings tab
    settingsTabEl.addEventListener("auxclick", (e) => {
      if (e.button === 1) {
        e.preventDefault();
        e.stopPropagation();
        this.closeSettingsTab();
      }
    });

    this.tabsListEl.appendChild(settingsTabEl);
  }

  public updatePaneStatus(tab: TerminalTab, pane: TerminalPane, status: "idle" | "running" | "done" | "error"): void {
    pane.status = status;
    if (this.activeTabId === tab.id && tab.activePaneId === pane.id) {
      const activeNotif = this.callbacks.getActiveCliNotification();
      if (!activeNotif) {
        this.callbacks.onRimLightUpdate(status);
      }
      this.callbacks.onPillSummaryUpdate();
    }

    const dot = document.querySelector(`.tab-item[data-tab-id="${tab.id}"] .tab-status-dot`);
    const activeNotif = this.callbacks.getActiveCliNotification();
    if (dot && (!activeNotif || activeNotif.tabId !== tab.id)) {
      dot.className = `tab-status-dot ${status}`;
    }
  }

  public scheduleAutoSave(): void {
    if (!this.callbacks.isRestoreSessionEnabled()) return;
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
    if (!this.callbacks.isRestoreSessionEnabled()) return;
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
          await this.splitManager.addPaneToTab(
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
          this.splitManager.setActivePaneInTab(tab, targetPane.id);
        }
      }

      this.renderTabsList();

      const targetTabId = snapshot.activeTabId && this.tabs.has(snapshot.activeTabId)
        ? snapshot.activeTabId
        : this.tabs.keys().next().value;

      if (targetTabId) {
        this.switchTab(targetTabId);
      }
      this.callbacks.onPillSummaryUpdate();
      return true;
    } catch (err) {
      console.error("[Restauración] Error al restaurar sesión previa:", err);
      return false;
    }
  }
}