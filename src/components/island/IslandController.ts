import { invoke } from "@tauri-apps/api/core";
import { IslandMode, TerminalPane } from "../../types";
import { CliNotificationEvent, playNotificationSound } from "../../utils/cliNotifications";
import { stateManager } from "../../core/StateManager";

export interface IslandControllerCallbacks {
  isAnyPopoverOpen: () => boolean;
  isSearchBarOpen: () => boolean;
  closeAllPopovers: () => void;
  closeSearchBar: () => void;
  onModeChanged?: (mode: IslandMode) => void;
  onIdleStateChanged?: (isHidden: boolean) => void;
  onConfirmPrompt?: (sessionId: string) => void;
  onOpenNotificationTab?: (tabId: string) => void;
  getActivePane: () => TerminalPane | null;
  getActiveTabTitle: () => string | undefined;
  fitActiveTabPanes: (withTransitionSequence: boolean, resetScrollToBottom: boolean) => void;
}

export class IslandController {
  private currentMode: IslandMode = "collapsed";

  // Temporizadores
  private hoverTimer: number | null = null;
  private leaveTimer: number | null = null;
  private autoCollapseTimer: number | null = null;
  private fullscreenCheckTimer: number | null = null;
  private idleTimer: number | null = null;
  private modeTransitionTimer: number | null = null;
  private isIdleHidden = false;
  private isMouseDown = false;
  private isMouseOverContainer = false;

  // Notificaciones CLI
  private activeCliNotification: CliNotificationEvent | null = null;
  private notificationDismissTimer: number | null = null;

  // Elementos DOM
  private islandContainer!: HTMLElement;
  private rimLight!: HTMLElement;
  private notchPill!: HTMLElement;
  private statusOrb!: HTMLElement;
  private notchGlance!: HTMLElement;
  private glanceOrb!: HTMLElement;
  private glanceTitle!: HTMLElement;
  private glanceStatusTag!: HTMLElement;
  private glanceSnippet!: HTMLElement;
  private glanceActions!: HTMLElement;
  private btnGlanceConfirm!: HTMLButtonElement;
  private btnGlanceOpen!: HTMLButtonElement;
  private btnCollapse!: HTMLButtonElement;

  private callbacks: IslandControllerCallbacks;

  constructor(callbacks: IslandControllerCallbacks) {
    this.callbacks = callbacks;
  }

  public initDom(): void {
    this.islandContainer = document.getElementById("island-container")!;
    this.rimLight = document.getElementById("rim-light")!;
    this.notchPill = document.getElementById("notch-pill")!;
    this.statusOrb = document.getElementById("status-orb")!;

    this.notchGlance = document.getElementById("notch-glance")!;
    this.glanceOrb = document.getElementById("glance-orb")!;
    this.glanceTitle = document.getElementById("glance-title")!;
    this.glanceStatusTag = document.getElementById("glance-status-tag")!;
    this.glanceSnippet = document.getElementById("glance-snippet")!;
    this.glanceActions = document.getElementById("glance-actions")!;
    this.btnGlanceConfirm = document.getElementById("btn-glance-confirm") as HTMLButtonElement;
    this.btnGlanceOpen = document.getElementById("btn-glance-open") as HTMLButtonElement;
    this.btnCollapse = document.getElementById("btn-collapse") as HTMLButtonElement;

    this.bindEvents();
    this.startFullscreenCheckLoop();
  }

  public getMode(): IslandMode {
    return this.currentMode;
  }

  public isExpanded(): boolean {
    return this.currentMode === "expanded";
  }

  public getActiveCliNotification(): CliNotificationEvent | null {
    return this.activeCliNotification;
  }

  public async setMode(mode: IslandMode, notifyBackend = true): Promise<void> {
    this.currentMode = mode;
    this.resetIdleTimer();

    this.islandContainer.classList.remove("state-collapsed", "state-glance", "state-expanded", "state-fullscreen");
    this.islandContainer.classList.add(`state-${mode}`);

    // Fullscreen and expanded modes should keep popovers/search bar open
    if (mode !== "expanded" && mode !== "fullscreen") {
      this.cancelTerminalTransition();
      this.callbacks.closeAllPopovers();
      this.callbacks.closeSearchBar();
    }

    if (notifyBackend) {
      try {
        await invoke("set_island_state", { state: mode });
      } catch (err) {
        console.warn("Failed to set island native window size:", err);
      }
    }

    if (mode === "expanded" || mode === "fullscreen") {
      this.scheduleTerminalFitAfterTransition();
    }

    if (this.callbacks.onModeChanged) {
      this.callbacks.onModeChanged(mode);
    }
  }

  /**
   * Bloquea los ajustes de xterm durante la animación CSS de apertura y
   * ejecuta un único fit al tamaño final. Medir a tamaños intermedios envía
   * resize_pty en cascada a ConPTY y provoca reflows y corrupción visual.
   */
  private scheduleTerminalFitAfterTransition(): void {
    this.cancelTerminalTransition();
    this.islandContainer.dataset.modeTransition = "true";
    this.modeTransitionTimer = window.setTimeout(() => {
      this.modeTransitionTimer = null;
      delete this.islandContainer.dataset.modeTransition;
      if (this.currentMode === "expanded" || this.currentMode === "fullscreen") {
        this.callbacks.fitActiveTabPanes(false, true);
      }
    }, 300);
  }

  private cancelTerminalTransition(): void {
    if (this.modeTransitionTimer !== null) {
      window.clearTimeout(this.modeTransitionTimer);
      this.modeTransitionTimer = null;
    }
    if (this.islandContainer) {
      delete this.islandContainer.dataset.modeTransition;
    }
  }

  public updateRimLight(status: "idle" | "running" | "done" | "error" | "rim-warning" | "rim-success"): void {
    this.rimLight.className = `rim-light ${status}`;
    const orbClass = status === "rim-warning" ? "running" : status === "rim-success" ? "done" : status;
    this.statusOrb.className = `status-orb ${orbClass}`;
    this.glanceOrb.className = `status-orb ${orbClass}`;
  }

  public updateGlanceView(title: string, snippet: string, status: string): void {
    if (this.currentMode !== "expanded" && this.currentMode !== "fullscreen" && !this.activeCliNotification) {
      this.glanceTitle.textContent = title;
      this.glanceSnippet.textContent = snippet;
      this.glanceStatusTag.textContent = status.toUpperCase();
      this.glanceStatusTag.className = `glance-status-tag ${status}`;
      if (this.glanceActions) {
        this.glanceActions.classList.add("hidden");
      }
    }
  }

  public handleCliNotification(notif: CliNotificationEvent): void {
    const settings = stateManager.getSettings();
    if (settings.cliNotifications === false) return;

    if (settings.notificationSound !== false) {
      playNotificationSound(notif.type);
    }

    // Rim light reactivo según tipo de notificación
    const rimClass = notif.type === "eleccion" ? "rim-warning" : "rim-success";
    this.updateRimLight(rimClass as any);

    this.activeCliNotification = notif;
    if (this.notificationDismissTimer) {
      clearTimeout(this.notificationDismissTimer);
      this.notificationDismissTimer = null;
    }

    const tabName = notif.title;
    const cleanTitle = tabName.toLowerCase().includes(notif.title.toLowerCase())
      ? tabName
      : `${tabName} • ${notif.title}`;
    this.glanceTitle.textContent = cleanTitle;
    this.glanceSnippet.textContent = notif.promptSnippet || (notif.type === "eleccion" ? "Confirmación requerida" : "Listo");
    this.glanceStatusTag.textContent = notif.type === "eleccion" ? "CONFIRMACIÓN" : "FINALIZADO";
    this.glanceStatusTag.className = `glance-status-tag ${notif.type === "eleccion" ? "warning" : "success"}`;

    if (this.glanceActions) {
      this.glanceActions.classList.remove("hidden");
      if (this.btnGlanceConfirm) {
        if (notif.type === "eleccion") {
          this.btnGlanceConfirm.classList.remove("hidden");
        } else {
          this.btnGlanceConfirm.classList.add("hidden");
        }
      }
      if (this.btnGlanceOpen) {
        this.btnGlanceOpen.textContent = notif.type === "eleccion" ? "↗ Abrir" : "↗ Ver resultado";
      }
    }

    if (this.currentMode === "collapsed") {
      this.setMode("glance");

      if (notif.type === "finalizado") {
        this.notificationDismissTimer = window.setTimeout(() => {
          if (this.currentMode === "glance" && this.activeCliNotification === notif) {
            this.dismissCliNotification(true);
          }
        }, 5000);
      }
    }
  }

  public dismissCliNotification(collapseToPill = false): void {
    if (this.notificationDismissTimer) {
      clearTimeout(this.notificationDismissTimer);
      this.notificationDismissTimer = null;
    }
    this.activeCliNotification = null;

    if (this.glanceActions) {
      this.glanceActions.classList.add("hidden");
    }

    const activePane = this.callbacks.getActivePane();
    if (activePane) {
      this.updateRimLight(activePane.status);
    } else {
      this.updateRimLight("idle");
    }

    if (collapseToPill && this.currentMode === "glance") {
      this.setMode("collapsed");
    }
  }

  public onUserActivity(): void {
    if (this.isIdleHidden) {
      this.showFromIdle();
    }
    this.resetIdleTimer();
  }

  public resetIdleTimer(): void {
    if (this.idleTimer !== null) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    const settings = stateManager.getSettings();
    if (!settings.autoHideEnabled) {
      return;
    }

    const minutes = settings.autoHideMinutes || 3;
    const timeoutMs = minutes * 60 * 1000;

    this.idleTimer = window.setTimeout(() => {
      this.checkAndHideForIdle();
    }, timeoutMs);
  }

  public async checkAndHideForIdle(): Promise<void> {
    const settings = stateManager.getSettings();
    if (!settings.autoHideEnabled) return;

    if (this.currentMode !== "collapsed") {
      this.resetIdleTimer();
      return;
    }

    if (this.callbacks.isAnyPopoverOpen() || this.callbacks.isSearchBarOpen()) {
      this.resetIdleTimer();
      return;
    }

    this.isIdleHidden = true;
    if (this.callbacks.onIdleStateChanged) {
      this.callbacks.onIdleStateChanged(true);
    }
    try {
      await invoke("set_idle_hidden", { hidden: true });
    } catch (err) {
      console.debug("Error al ocultar ventana por inactividad:", err);
    }
  }

  public async showFromIdle(): Promise<void> {
    this.isIdleHidden = false;
    if (this.callbacks.onIdleStateChanged) {
      this.callbacks.onIdleStateChanged(false);
    }
    try {
      await invoke("set_idle_hidden", { hidden: false });
    } catch (err) {
      console.debug("Error al restaurar ventana desde inactividad:", err);
    }
    this.resetIdleTimer();
  }

  private startFullscreenCheckLoop(): void {
    if (this.fullscreenCheckTimer) {
      clearInterval(this.fullscreenCheckTimer);
    }
    this.fullscreenCheckTimer = window.setInterval(async () => {
      // Optimización de batería: Solo evaluar pantalla completa si la isla está en reposo (collapsed) y no oculta
      if (this.currentMode !== "collapsed" || this.isIdleHidden) {
        return;
      }

      const settings = stateManager.getSettings();
      if (!settings.showOverFullscreen) {
        try {
          await invoke("check_fullscreen_occlusion");
        } catch {}
      }
    }, 1000);
  }

  private bindEvents(): void {
    // Proximidad de cursor para Glance
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

    this.notchPill.addEventListener("mouseleave", () => {
      if (this.hoverTimer) {
        clearTimeout(this.hoverTimer);
        this.hoverTimer = null;
      }
    });

    const cancelAllLeaveTimers = () => {
      if (this.leaveTimer) {
        clearTimeout(this.leaveTimer);
        this.leaveTimer = null;
      }
      if (this.autoCollapseTimer) {
        clearTimeout(this.autoCollapseTimer);
        this.autoCollapseTimer = null;
      }
      if (this.hoverTimer) {
        clearTimeout(this.hoverTimer);
        this.hoverTimer = null;
      }
    };

    const scheduleAutoCollapse = (delayMs = 300) => {
      if (this.autoCollapseTimer) {
        clearTimeout(this.autoCollapseTimer);
      }
      this.autoCollapseTimer = window.setTimeout(() => {
        if (this.currentMode === "expanded") {
          // Si el usuario mantiene el ratón presionado (seleccionando texto o arrastrando),
          // o si el ratón volvió a ingresar al contenedor, o si hay un popover abierto, no cerrar
          const hasActiveSelection = (document.getSelection()?.toString().length ?? 0) > 0;
          if (this.isMouseDown || this.isMouseOverContainer || hasActiveSelection) {
            return;
          }
          if (this.callbacks.isAnyPopoverOpen() || this.callbacks.isSearchBarOpen()) {
            return;
          }
          this.setMode("collapsed");
        }
      }, delayMs);
    };

    // Rastreo global del ratón para prevenir repliegues accidentales durante selección o arrastre
    window.addEventListener("mousedown", (e: MouseEvent) => {
      if (e.button === 0) {
        this.isMouseDown = true;
        cancelAllLeaveTimers();
      }
    });

    window.addEventListener("mouseup", () => {
      this.isMouseDown = false;
      // Si el cursor quedó fuera del contenedor tras finalizar la selección/arrastre,
      // programar el repliegue con debounce si autoCollapseOnLeave está activo
      if (!this.isMouseOverContainer && this.currentMode === "expanded") {
        const settings = stateManager.getSettings();
        if (settings.autoCollapseOnLeave) {
          scheduleAutoCollapse(350);
        }
      }
    });

    window.addEventListener("dragstart", () => {
      this.isMouseDown = true;
      cancelAllLeaveTimers();
    });

    window.addEventListener("dragend", () => {
      this.isMouseDown = false;
      if (!this.isMouseOverContainer && this.currentMode === "expanded") {
        const settings = stateManager.getSettings();
        if (settings.autoCollapseOnLeave) {
          scheduleAutoCollapse(350);
        }
      }
    });

    this.islandContainer.addEventListener("mouseenter", () => {
      this.isMouseOverContainer = true;
      cancelAllLeaveTimers();
      if (this.activeCliNotification && this.activeCliNotification.type === "finalizado") {
        if (this.notificationDismissTimer) clearTimeout(this.notificationDismissTimer);
        this.notificationDismissTimer = window.setTimeout(() => {
          if (this.currentMode === "glance") {
            this.dismissCliNotification(true);
            this.setMode("collapsed");
          }
        }, 4000);
      } else if (this.notificationDismissTimer) {
        clearTimeout(this.notificationDismissTimer);
        this.notificationDismissTimer = null;
      }
    });

    const popoverIds = ["shell-menu-popover", "folder-menu-popover", "settings-popover"];
    popoverIds.forEach((id) => {
      document.getElementById(id)?.addEventListener("mouseenter", () => {
        this.isMouseOverContainer = true;
        cancelAllLeaveTimers();
      });
    });

    this.islandContainer.addEventListener("mouseleave", (e: MouseEvent) => {
      this.isMouseOverContainer = false;

      if (this.hoverTimer) {
        clearTimeout(this.hoverTimer);
        this.hoverTimer = null;
      }

      const related = e.relatedTarget as Node | null;
      if (related && this.islandContainer.contains(related)) {
        return;
      }

      // Si el usuario está seleccionando texto, arrastrando o con el botón pulsado, NO colapsar
      const hasActiveSelection = (document.getSelection()?.toString().length ?? 0) > 0;
      if (this.isMouseDown || (e.buttons && e.buttons !== 0) || hasActiveSelection) {
        return;
      }

      if (this.currentMode === "glance") {
        if (this.activeCliNotification && this.activeCliNotification.type === "eleccion") {
          return;
        }
        if (this.leaveTimer) {
          clearTimeout(this.leaveTimer);
        }
        this.leaveTimer = window.setTimeout(() => {
          if (this.currentMode === "glance" && !this.isMouseDown && !this.isMouseOverContainer) {
            this.dismissCliNotification(true);
            this.setMode("collapsed");
          }
        }, 200);
      } else if (this.currentMode === "expanded") {
        const settings = stateManager.getSettings();
        if (settings.autoCollapseOnLeave) {
          scheduleAutoCollapse(300);
        }
      }
    });

    // Clics para cambiar de modo
    this.notchPill.addEventListener("click", () => {
      if (this.hoverTimer) clearTimeout(this.hoverTimer);
      this.setMode("expanded");
    });

    this.notchGlance.addEventListener("click", () => {
      if (this.leaveTimer) clearTimeout(this.leaveTimer);
      if (this.activeCliNotification) {
        const targetTabId = this.activeCliNotification.tabId;
        this.dismissCliNotification(false);
        if (this.callbacks.onOpenNotificationTab) {
          this.callbacks.onOpenNotificationTab(targetTabId);
        }
      }
      this.setMode("expanded");
    });

    this.btnCollapse.addEventListener("click", (e) => {
      e.stopPropagation();
      this.setMode("collapsed");
    });

    if (this.btnGlanceConfirm) {
      this.btnGlanceConfirm.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.activeCliNotification) {
          const sid = this.activeCliNotification.sessionId;
          if (this.callbacks.onConfirmPrompt) {
            this.callbacks.onConfirmPrompt(sid);
          }
          this.dismissCliNotification(true);
        }
      });
    }

    if (this.btnGlanceOpen) {
      this.btnGlanceOpen.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.activeCliNotification) {
          const targetTabId = this.activeCliNotification.tabId;
          this.dismissCliNotification(false);
          if (this.callbacks.onOpenNotificationTab) {
            this.callbacks.onOpenNotificationTab(targetTabId);
          }
          this.setMode("expanded");
        }
      });
    }

    // Oyentes de actividad global
    const onActivity = () => this.onUserActivity();
    window.addEventListener("mousemove", onActivity, { passive: true });
    window.addEventListener("mousedown", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity, { passive: true });
    window.addEventListener("touchstart", onActivity, { passive: true });
  }
}
