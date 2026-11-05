import { invoke } from "@tauri-apps/api/core";
import { CollapsedWidgetType, SystemMetrics } from "../../types";
import { stateManager } from "../../core/StateManager";

export class PillWidgets {
  private notchPill: HTMLElement | null = null;
  private widgetPty: HTMLElement | null = null;
  private currentProcessEl: HTMLElement | null = null;
  private ttyBadge: HTMLElement | null = null;
  private statusOrb: HTMLElement | null = null;

  private widgetClock: HTMLElement | null = null;
  private clockTimeEl: HTMLElement | null = null;
  private clockTimer: number | null = null;

  private widgetMetrics: HTMLElement | null = null;
  private pillCpuEl: HTMLElement | null = null;
  private pillRamEl: HTMLElement | null = null;
  private metricsTimer: number | null = null;

  private widgetLivelog: HTMLElement | null = null;
  private pillLogProcEl: HTMLElement | null = null;
  private pillLogSnippetEl: HTMLElement | null = null;

  private settingClockRow: HTMLElement | null = null;
  private currentWidget: CollapsedWidgetType = "pty_status";
  private isPaused: boolean = false;

  public initDom(): void {
    this.notchPill = document.getElementById("notch-pill");
    this.widgetPty = document.getElementById("widget-pty");
    this.currentProcessEl = document.getElementById("current-process");
    this.ttyBadge = document.getElementById("tty-badge");
    this.statusOrb = document.getElementById("status-orb");

    this.widgetClock = document.getElementById("widget-clock");
    this.clockTimeEl = document.getElementById("clock-time");

    this.widgetMetrics = document.getElementById("widget-metrics");
    this.pillCpuEl = document.getElementById("pill-cpu");
    this.pillRamEl = document.getElementById("pill-ram");

    this.widgetLivelog = document.getElementById("widget-livelog");
    this.pillLogProcEl = document.getElementById("pill-log-proc");
    this.pillLogSnippetEl = document.getElementById("pill-log-snippet");

    this.settingClockRow = document.getElementById("setting-clock-row");
  }

  public applyWidget(widget: CollapsedWidgetType): void {
    this.currentWidget = widget;

    if (this.notchPill) {
      this.notchPill.dataset.widget = widget;
    }

    if (this.widgetPty) this.widgetPty.classList.toggle("hidden", widget !== "pty_status");
    if (this.widgetClock) this.widgetClock.classList.toggle("hidden", widget !== "clock");
    if (this.widgetMetrics) this.widgetMetrics.classList.toggle("hidden", widget !== "system_metrics");
    if (this.widgetLivelog) this.widgetLivelog.classList.toggle("hidden", widget !== "live_log");

    if (this.settingClockRow) {
      this.settingClockRow.style.display = widget === "clock" ? "flex" : "none";
    }

    // Si está en pausa, no iniciar timers en segundo plano
    if (this.isPaused) {
      this.clearAllTimers();
      return;
    }

    // Timer de reloj
    if (widget === "clock") {
      this.updateClock();
      if (!this.clockTimer) {
        this.clockTimer = window.setInterval(() => this.updateClock(), 1000);
      }
    } else {
      if (this.clockTimer) {
        clearInterval(this.clockTimer);
        this.clockTimer = null;
      }
    }

    // Timer de métricas
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
  }

  /**
   * Pausa los temporizadores de fondo cuando la píldora no es visible (modo expanded o inactividad)
   */
  public pause(): void {
    this.isPaused = true;
    this.clearAllTimers();
  }

  /**
   * Reanuda los temporizadores y actualiza inmediatamente cuando la píldora vuelve a ser visible
   */
  public resume(): void {
    if (!this.isPaused) return;
    this.isPaused = false;

    if (this.currentWidget === "clock") {
      this.updateClock();
      if (!this.clockTimer) {
        this.clockTimer = window.setInterval(() => this.updateClock(), 1000);
      }
    } else if (this.currentWidget === "system_metrics") {
      this.fetchSystemMetrics();
      if (!this.metricsTimer) {
        this.metricsTimer = window.setInterval(() => this.fetchSystemMetrics(), 2000);
      }
    }
  }

  private clearAllTimers(): void {
    if (this.clockTimer) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }
  }

  public updateClock(): void {
    if (!this.clockTimeEl) return;
    const settings = stateManager.getSettings();
    const now = new Date();
    if (settings.clock24h) {
      this.clockTimeEl.textContent = now.toTimeString().split(" ")[0]; // HH:MM:SS
    } else {
      let hours = now.getHours();
      const ampm = hours >= 12 ? "PM" : "AM";
      hours = hours % 12 || 12;
      const pad = (n: number) => n.toString().padStart(2, "0");
      this.clockTimeEl.textContent = `${pad(hours)}:${pad(now.getMinutes())}:${pad(now.getSeconds())} ${ampm}`;
    }
  }

  public async fetchSystemMetrics(): Promise<void> {
    if (!this.pillCpuEl || !this.pillRamEl) return;
    try {
      const metrics = await invoke<SystemMetrics>("get_system_metrics");
      this.pillCpuEl.textContent = `CPU ${Math.round(metrics.cpu_usage)}%`;
      const usedGb = (metrics.memory_used_mb / 1024).toFixed(1);
      this.pillRamEl.textContent = `RAM ${usedGb}G`;
    } catch (err) {
      console.debug("[PillWidgets] Error al consultar métricas del sistema:", err);
    }
  }

  public updateSummary(activePanesCount: number, currentProcessName: string, lastSnippet: string): void {
    if (this.ttyBadge) {
      this.ttyBadge.textContent = `${activePanesCount} TTY`;
    }
    if (this.currentProcessEl) {
      this.currentProcessEl.textContent = currentProcessName || "terminal";
    }
    if (this.pillLogProcEl) {
      this.pillLogProcEl.textContent = `${currentProcessName || "term"}:`;
    }
    if (this.pillLogSnippetEl) {
      this.pillLogSnippetEl.textContent = lastSnippet || "Listo";
    }
  }

  public setOrbStatus(status: "idle" | "running" | "done" | "error"): void {
    if (!this.statusOrb) return;
    this.statusOrb.className = `status-orb ${status}`;
  }

  public destroy(): void {
    if (this.clockTimer) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }
  }
}
