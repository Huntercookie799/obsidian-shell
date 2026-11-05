import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { createTerminalInstance, fitSafely, setInitialDimensions, stripAnsi } from "../TerminalView";
import { PtyStatus, TerminalPane, TerminalTab } from "../../types";
import { CliActivityTracker, CliNotificationEvent, extractCleanSnippet } from "../../utils/cliNotifications";

export interface SplitManagerCallbacks {
  getAccentColor: () => string;
  isExpanded: () => boolean;
  onPaneStatusChange: (tab: TerminalTab, pane: TerminalPane, status: "idle" | "running" | "done" | "error") => void;
  onActivePaneChange: (tab: TerminalTab, paneId: string) => void;
  onCliNotification: (notif: CliNotificationEvent) => void;
  onDismissCliNotification: (collapseToPill: boolean) => void;
  onScheduleAutoSave: () => void;
  onTabEmpty: (tabId: string) => void;
  onTabsListUpdate: () => void;
  getActiveCliNotification: () => CliNotificationEvent | null;
}

export class SplitManager {
  private paneCounter = 0;
  private unlisteners: Map<string, UnlistenFn[]> = new Map();
  private activityTimers: Map<string, number> = new Map();
  private cliTrackers: Map<string, CliActivityTracker> = new Map();
  private callbacks: SplitManagerCallbacks;

  constructor(callbacks: SplitManagerCallbacks) {
    this.callbacks = callbacks;
  }

  public async addPaneToTab(
    tab: TerminalTab,
    shellPath?: string,
    cwd?: string,
    initialBuffer?: string,
    overrideProcessName?: string
  ): Promise<TerminalPane> {
    this.paneCounter += 1;
    const paneId = `pane-${this.paneCounter}`;

    const shellDisplay = overrideProcessName || (shellPath
      ? shellPath.split(/[/\\]/).pop() || shellPath
      : navigator.platform.includes("Win")
        ? "powershell"
        : "bash");

    const paneEl = document.createElement("div");
    paneEl.className = "terminal-pane active-pane";
    paneEl.id = paneId;
    tab.containerElement.appendChild(paneEl);

    // 1. Instanciar y montar terminal antes de crear sesión PTY
    const termInstance = createTerminalInstance("", this.callbacks.getAccentColor());
    termInstance.mount(paneEl);

    // 2. Calcular dimensiones reales con fitAddon.proposeDimensions()
    const proposed = termInstance.fitAddon.proposeDimensions();
    const cols = proposed && proposed.cols > 0 ? proposed.cols : Math.max(20, Math.floor((paneEl.clientWidth || 800) / 8));
    const rows = proposed && proposed.rows > 0 ? proposed.rows : Math.max(5, Math.floor((paneEl.clientHeight || 400) / 17));
    termInstance.terminal.resize(cols, rows);

    // 3. Crear proceso PTY con dimensiones exactas del viewport
    const sessionId = await invoke<string>("create_pty_session", {
      shellPath: shellPath ?? null,
      cwd: cwd ?? null,
      cols,
      rows,
    });
    termInstance.setSessionId(sessionId);
    setInitialDimensions(sessionId, cols, rows);

    const { terminal, fitAddon, serializeAddon, serializeBuffer, smartPaste, writeBatched, isUserScrolledUp, setSessionId } = termInstance;

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
      get searchAddon() {
        return termInstance.searchAddon;
      },
      serializeAddon,
      serializeBuffer,
      smartPaste,
      writeBatched,
      isUserScrolledUp,
      resetScrollToBottom: termInstance.resetScrollToBottom,
      setSessionId,
      enableWebgl: termInstance.enableWebgl,
      disableWebgl: termInstance.disableWebgl,
      getSearchAddon: termInstance.getSearchAddon,
      dispose: termInstance.dispose,
      element: paneEl,
    };

    // Micro-barra de cabecera del panel (Tag de Shell + Botón de Cierre)
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

    // Foco al hacer clic en este panel
    paneEl.addEventListener("click", () => {
      this.setActivePaneInTab(tab, paneId);
    });

    tab.panes.push(pane);
    this.setActivePaneInTab(tab, paneId);

    // Inicializar rastreador inteligente de eventos y prompts de agentes CLI
    const cliTracker = new CliActivityTracker(sessionId, tab.id, paneId, shellDisplay);
    this.cliTrackers.set(sessionId, cliTracker);

    pane.terminal.onBell(() => {
      cliTracker.handleBell((notif) => this.callbacks.onCliNotification(notif));
    });

    pane.terminal.parser.registerOscHandler(9, (data) => {
      cliTracker.handleOsc(9, data, (notif) => this.callbacks.onCliNotification(notif));
      return true;
    });

    pane.terminal.parser.registerOscHandler(777, (data) => {
      cliTracker.handleOsc(777, data, (notif) => this.callbacks.onCliNotification(notif));
      return true;
    });

    pane.terminal.onData((data) => {
      cliTracker.onUserInput(data);
    });

    // Setup de listeners PTY
    const outputUnlisten = await listen<string>(`pty-output-${sessionId}`, (event) => {
      pane.writeBatched(event.payload);

      const activeNotif = this.callbacks.getActiveCliNotification();
      if (
        activeNotif &&
        activeNotif.sessionId === sessionId &&
        activeNotif.type === "finalizado"
      ) {
        this.callbacks.onDismissCliNotification(true);
      }

      cliTracker.feedData(event.payload, (notif) => this.callbacks.onCliNotification(notif));

      if (!this.callbacks.isExpanded()) {
        const clean = stripAnsi(event.payload);
        const snippet = extractCleanSnippet(clean, 50);
        if (snippet.length > 0 && snippet !== "Listo") {
          pane.lastSnippet = snippet;
        }
      }

      this.callbacks.onPaneStatusChange(tab, pane, "running");

      const prevTimer = this.activityTimers.get(sessionId);
      if (prevTimer) clearTimeout(prevTimer);

      const newTimer = window.setTimeout(() => {
        if (pane.status === "running") {
          this.callbacks.onPaneStatusChange(tab, pane, "idle");
        }
      }, 1500);

      this.activityTimers.set(sessionId, newTimer);
      this.callbacks.onScheduleAutoSave();
    });

    const statusUnlisten = await listen<PtyStatus>(`pty-status-${sessionId}`, (event) => {
      const exitCode = event.payload.exitCode;
      const status = exitCode === null || exitCode === 0 ? "done" : "error";
      this.callbacks.onPaneStatusChange(tab, pane, status);
      this.callbacks.onScheduleAutoSave();
    });

    this.unlisteners.set(sessionId, [outputUnlisten, statusUnlisten]);
    this.callbacks.onScheduleAutoSave();

    return pane;
  }

  public async splitTab(tab: TerminalTab, layout: "split-vertical" | "split-horizontal"): Promise<TerminalPane | null> {
    if (tab.panes.length >= 4) {
      return null; // Máximo 4 paneles por pestaña
    }

    tab.layout = layout;
    tab.containerElement.className = `tab-panes-container active layout-${layout}`;

    const newPane = await this.addPaneToTab(tab);
    this.fitTabPanes(tab, true);
    this.callbacks.onScheduleAutoSave();
    return newPane;
  }

  public navigateSplitPane(tab: TerminalTab): void {
    if (tab.panes.length <= 1) return;

    const currentIndex = tab.panes.findIndex((p) => p.id === tab.activePaneId);
    const nextIndex = (currentIndex + 1) % tab.panes.length;
    const nextPane = tab.panes[nextIndex];
    this.setActivePaneInTab(tab, nextPane.id);
  }

  public setActivePaneInTab(tab: TerminalTab, paneId: string): void {
    tab.activePaneId = paneId;
    tab.panes.forEach((p) => {
      if (p.id === paneId) {
        p.element.classList.add("active-pane");
        p.terminal.focus();
      } else {
        p.element.classList.remove("active-pane");
      }
    });

    this.callbacks.onActivePaneChange(tab, paneId);
  }

  public closePane(tab: TerminalTab, pane: TerminalPane): void {
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

    const cliTracker = this.cliTrackers.get(pane.sessionId);
    if (cliTracker) {
      cliTracker.dispose();
      this.cliTrackers.delete(pane.sessionId);
    }

    const activeNotif = this.callbacks.getActiveCliNotification();
    if (activeNotif && activeNotif.sessionId === pane.sessionId) {
      this.callbacks.onDismissCliNotification(false);
    }

    pane.disableWebgl?.();
    if (pane.dispose) {
      pane.dispose();
    } else {
      pane.terminal.dispose();
    }
    pane.element.remove();
    tab.panes = tab.panes.filter((p) => p.id !== pane.id);

    if (tab.panes.length === 1) {
      tab.layout = "single";
      tab.containerElement.className = "tab-panes-container active layout-single";
    }

    if (tab.panes.length === 0) {
      this.callbacks.onTabEmpty(tab.id);
      return;
    }

    if (tab.panes.length > 0) {
      this.setActivePaneInTab(tab, tab.panes[0].id);
      this.fitTabPanes(tab);
    }

    this.callbacks.onTabsListUpdate();
    this.callbacks.onScheduleAutoSave();
  }

  public fitTabPanes(tab: TerminalTab, withTransitionSequence: boolean = false, resetScrollToBottom: boolean = false): void {
    const executeFit = (immediate: boolean = false) => {
      tab.panes.forEach((pane) => {
        if (resetScrollToBottom && pane.resetScrollToBottom) {
          pane.resetScrollToBottom();
        }
        fitSafely(pane.terminal, pane.fitAddon, pane.sessionId, pane.isUserScrolledUp(), immediate);
        if (resetScrollToBottom && pane.resetScrollToBottom) {
          pane.resetScrollToBottom();
        }
      });
      const active = tab.panes.find((p) => p.id === tab.activePaneId) || tab.panes[0];
      if (active) active.terminal.focus();
    };

    requestAnimationFrame(() => executeFit(false));

    if (withTransitionSequence) {
      window.setTimeout(() => executeFit(true), 260);
    }
  }

  public getCliTracker(sessionId: string): CliActivityTracker | undefined {
    return this.cliTrackers.get(sessionId);
  }

  public cleanupSession(sessionId: string): void {
    const timer = this.activityTimers.get(sessionId);
    if (timer) clearTimeout(timer);
    this.activityTimers.delete(sessionId);

    const sessionUnlisteners = this.unlisteners.get(sessionId);
    if (sessionUnlisteners) {
      sessionUnlisteners.forEach((fn) => fn());
      this.unlisteners.delete(sessionId);
    }

    const cliTracker = this.cliTrackers.get(sessionId);
    if (cliTracker) {
      cliTracker.dispose();
      this.cliTrackers.delete(sessionId);
    }
  }
}
