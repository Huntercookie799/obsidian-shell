/**
 * Detector Inteligente de Eventos y Prompts de Agentes CLI (Fase 22)
 * Soporte para Antigravity CLI, Claude Code, Ollama y shells modernos.
 */

import { stripAnsi } from "../components/TerminalView";

export type CliNotificationType = "eleccion" | "finalizado";

export interface CliNotificationEvent {
  sessionId: string;
  tabId: string;
  paneId: string;
  type: CliNotificationType;
  title: string;
  promptSnippet: string;
  timestamp: number;
}

// Patrones heurísticos para detectar preguntas interactivas y confirmaciones de agentes
export const CHOICE_REGEX = /(?:\bPermitir\b|\bAllow\b|\bDeny\b|\bRechazar\b|\[Y\/n\]|\[y\/N\]|\(y\/n\)|Do you want to|¿Deseas continuar|1\.\s*(?:Yes|Sí|Permitir)|What should .* do instead)/i;

// Patrones heurísticos para detectar prompts listos de agentes o shells
export const PROMPT_READY_REGEX = /(?:\? for shortcuts|[❯›>]\s*$|PS [A-Z]:\\[^\n]*>\s*$|╭─|╰─)/m;

/**
 * Reproductor de tonos sutiles mediante Web Audio API puro (sin dependencias ni archivos externos)
 */
export function playNotificationSound(type: CliNotificationType = "finalizado") {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    if (type === "eleccion") {
      // Tono suave bifrecuencia ascendente para solicitud de atención (Re5 -> La5)
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.exponentialRampToValueAtTime(880.0, now + 0.12);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc.start(now);
      osc.stop(now + 0.3);
    } else {
      // Tono suave melodioso de éxito para tarea terminada (Do5 -> Mi5 -> Sol5)
      osc.type = "sine";
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.08);
      osc.frequency.setValueAtTime(783.99, now + 0.16);
      gain.gain.setValueAtTime(0.07, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.36);
    }
  } catch (err) {
    console.debug("[Audio] No se pudo reproducir sonido de notificación:", err);
  }
}

/**
 * Limpia y extrae la última línea relevante de un buffer de terminal para el snippet de la píldora
 */
export function extractCleanSnippet(text: string, maxLength = 65): string {
  if (!text) return "";
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) return "";

  // Priorizar líneas con signos de interrogación o prompts interactivos
  const questionLine = [...lines].reverse().find((l) => CHOICE_REGEX.test(l) || l.includes("?"));
  const target = questionLine || lines[lines.length - 1];

  // Limpiar caracteres decorativos de cajas TUI como ╭ ╰ │ ─ ┌ └
  const cleaned = target
    .replace(/^[╭╰│─┌└\s>❯›]+/, "")
    .replace(/[╭╰│─┌└]+$/, "")
    .trim();

  if (cleaned.length > maxLength) {
    return cleaned.slice(0, maxLength - 1) + "…";
  }
  return cleaned || target.slice(0, maxLength);
}

/**
 * Rastreador de actividad y analizador heurístico por sesión PTY
 */
export class CliActivityTracker {
  private sessionId: string;
  private tabId: string;
  private paneId: string;
  private processName: string;

  private activityStartTime: number = 0;
  private tailBuffer: string = "";
  private inactivityTimer: number | null = null;

  private lastNotifiedType: CliNotificationType | null = null;
  private lastNotifiedSnippet: string = "";
  private lastNotifiedTime: number = 0;

  constructor(sessionId: string, tabId: string, paneId: string, processName: string) {
    this.sessionId = sessionId;
    this.tabId = tabId;
    this.paneId = paneId;
    this.processName = processName;
  }

  public updateContext(tabId: string, processName: string) {
    this.tabId = tabId;
    this.processName = processName;
  }

  /**
   * Recibe un chunk de salida PTY y evalúa ráfagas de datos e inactividad
   */
  public feedData(
    chunk: string,
    onNotification: (event: CliNotificationEvent) => void
  ) {
    const now = Date.now();
    if (this.activityStartTime === 0) {
      this.activityStartTime = now;
    }

    // Mantener cola de los últimos 1200 caracteres para análisis tras stripAnsi
    this.tailBuffer = (this.tailBuffer + chunk).slice(-1200);

    // Cancelar temporizador previo y programar evaluación tras 400ms de inactividad
    if (this.inactivityTimer !== null) {
      clearTimeout(this.inactivityTimer);
    }

    this.inactivityTimer = window.setTimeout(() => {
      this.evaluateInactivity(onNotification);
    }, 400);
  }

  /**
   * Dispara una alerta directa si el terminal recibe Bell (\x07)
   */
  public handleBell(onNotification: (event: CliNotificationEvent) => void) {
    const cleanTail = stripAnsi(this.tailBuffer.slice(-600));
    const isChoice = CHOICE_REGEX.test(cleanTail);
    const type: CliNotificationType = isChoice ? "eleccion" : "finalizado";
    const snippet = extractCleanSnippet(cleanTail) || (isChoice ? "¿Deseas continuar?" : "Tarea completada");

    this.emitNotification(type, snippet, onNotification);
  }

  /**
   * Dispara una alerta directa proveniente de secuencias OSC (OSC 9 u OSC 777)
   */
  public handleOsc(
    oscType: number,
    data: string,
    onNotification: (event: CliNotificationEvent) => void
  ) {
    let message = data;
    if (oscType === 777) {
      // Formato usual: "notify;Titulo;Mensaje"
      const parts = data.split(";");
      if (parts.length >= 3) {
        message = parts.slice(2).join(" ");
      } else if (parts.length === 2) {
        message = parts[1];
      }
    }

    const cleanMsg = extractCleanSnippet(message) || "Notificación de comando";
    const isChoice = CHOICE_REGEX.test(cleanMsg);
    this.emitNotification(isChoice ? "eleccion" : "finalizado", cleanMsg, onNotification);
  }

  /**
   * Se llama cuando el usuario envía una entrada para resetear el estado notificado
   */
  public onUserInput() {
    this.lastNotifiedType = null;
    this.lastNotifiedSnippet = "";
    this.activityStartTime = 0;
  }

  /**
   * Evalúa los últimos 600 caracteres limpios tras 400ms de inactividad
   */
  private evaluateInactivity(
    onNotification: (event: CliNotificationEvent) => void
  ) {
    const now = Date.now();
    const duration = now - this.activityStartTime;
    const cleanTail = stripAnsi(this.tailBuffer.slice(-600));

    // 1. Detección de Elección / Confirmación Interactiva (Permitir, [Y/n], etc.)
    if (CHOICE_REGEX.test(cleanTail)) {
      const snippet = extractCleanSnippet(cleanTail) || "Esperando confirmación...";
      this.emitNotification("eleccion", snippet, onNotification);
      return;
    }

    // 2. Detección de Tarea Finalizada tras actividad prolongada (> 3000ms)
    if (duration >= 3000 && PROMPT_READY_REGEX.test(cleanTail)) {
      const snippet = extractCleanSnippet(cleanTail) || "Tarea finalizada con éxito";
      this.emitNotification("finalizado", snippet, onNotification);
      return;
    }

    // Reiniciar ventana de actividad si el buffer se estabilizó sin eventos
    this.activityStartTime = 0;
  }

  private emitNotification(
    type: CliNotificationType,
    snippet: string,
    onNotification: (event: CliNotificationEvent) => void
  ) {
    const now = Date.now();
    // Evitar spams idénticos dentro de una ventana de 3 segundos
    if (
      this.lastNotifiedType === type &&
      this.lastNotifiedSnippet === snippet &&
      now - this.lastNotifiedTime < 3000
    ) {
      return;
    }

    this.lastNotifiedType = type;
    this.lastNotifiedSnippet = snippet;
    this.lastNotifiedTime = now;
    this.activityStartTime = 0;

    const title = this.processName || "Agente CLI";

    onNotification({
      sessionId: this.sessionId,
      tabId: this.tabId,
      paneId: this.paneId,
      type,
      title,
      promptSnippet: snippet,
      timestamp: now,
    });
  }

  public dispose() {
    if (this.inactivityTimer !== null) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
  }
}
