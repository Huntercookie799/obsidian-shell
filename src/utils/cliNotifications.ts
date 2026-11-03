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

// Patrones heurísticos de indicadores de ejecución activa (si aparecen en las líneas recientes, el agente SIGUE TRABAJANDO)
export const ACTIVE_EXECUTION_REGEX = /(?:thinking\b|\bthought for\b|\brunning tool\b|\bcalling tool\b|\bexecuting\b|\breading file\b|\bediting\b|\bwriting\b|\bcompiling\b|\bbuilding\b|\bsearching\b|\bfetching\b|\besc to cancel\b|\besc to interrupt\b|\bctrl\+c to interrupt\b|\bin progress\b)/i;

// Patrones heurísticos para detectar prompts listos finales de agentes o shells esperando input de usuario
export const PROMPT_READY_REGEX = /(?:[❯›$%]\s*$|PS [A-Z]:\\[^\r\n]*>\s*$|[A-Z]:\\[^\r\n]*>\s*$|\? for shortcuts\s*$|\(y\/n\)\s*$)/;

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

  // Limpiar caracteres decorativos de cajas TUI como ╭ ╰ │ ─ ┌ └, fragmentos ANSI huérfanos y símbolos
  const cleaned = target
    .replace(/^[╭╰│─┌└═─\s>❯›]+/, "")
    .replace(/[╭╰│─┌└═─]+$/, "")
    .replace(/[0-9]+;[0-9;]+m/g, "")
    .replace(/^[0-9;]+m/g, "")
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
  private choiceTimer: number | null = null;
  private finishTimer: number | null = null;
  private hasUserInput: boolean = false;

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

    // Mantener cola de los últimos 1500 caracteres para análisis tras stripAnsi
    this.tailBuffer = (this.tailBuffer + chunk).slice(-1500);

    // Cancelar temporizadores previos
    if (this.choiceTimer !== null) {
      clearTimeout(this.choiceTimer);
      this.choiceTimer = null;
    }
    if (this.finishTimer !== null) {
      clearTimeout(this.finishTimer);
      this.finishTimer = null;
    }

    // 1. Evaluación rápida tras 450ms para preguntas interactivas ([Y/n], Allow/Deny, etc.)
    this.choiceTimer = window.setTimeout(() => {
      this.evaluateChoice(onNotification);
    }, 450);

    // 2. Evaluación tras 2000ms de silencio para determinar finalización real
    this.finishTimer = window.setTimeout(() => {
      this.evaluateFinished(onNotification);
    }, 2000);
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
    this.hasUserInput = true;
    this.lastNotifiedType = null;
    this.lastNotifiedSnippet = "";
    this.activityStartTime = Date.now();
    if (this.choiceTimer !== null) {
      clearTimeout(this.choiceTimer);
      this.choiceTimer = null;
    }
    if (this.finishTimer !== null) {
      clearTimeout(this.finishTimer);
      this.finishTimer = null;
    }
  }

  /**
   * Evalúa si el agente CLI se detuvo esperando confirmación interactiva ([Y/n], Permitir, etc.)
   */
  private evaluateChoice(onNotification: (event: CliNotificationEvent) => void) {
    const cleanTail = stripAnsi(this.tailBuffer.slice(-600));
    const lines = cleanTail
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length === 0) return;

    // Analizar las últimas 4 líneas recientes
    const recentTail = lines.slice(-4).join("\n");
    if (CHOICE_REGEX.test(recentTail)) {
      const snippet = extractCleanSnippet(recentTail) || "Esperando confirmación...";
      this.emitNotification("eleccion", snippet, onNotification);
      // Cancelar timer de finalizado si estamos esperando una elección
      if (this.finishTimer !== null) {
        clearTimeout(this.finishTimer);
        this.finishTimer = null;
      }
    }
  }

  /**
   * Evalúa si una tarea prolongada realmente finalizó tras inactividad sostenida (2000ms)
   */
  private evaluateFinished(onNotification: (event: CliNotificationEvent) => void) {
    // Si el usuario no ha ejecutado comandos en este panel, se trata del arranque inicial del shell (ignorar)
    if (!this.hasUserInput) {
      this.activityStartTime = 0;
      return;
    }

    const now = Date.now();
    const duration = now - this.activityStartTime;
    const cleanTail = stripAnsi(this.tailBuffer.slice(-800));

    // Si la actividad previa fue muy breve (< 2000ms), no emitir notificación de tarea finalizada
    if (duration < 2000) {
      this.activityStartTime = 0;
      return;
    }

    const lines = cleanTail
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length === 0) {
      this.activityStartTime = 0;
      return;
    }

    const lastLine = lines[lines.length - 1];

    // Descartar si las últimas líneas contienen indicadores de ejecución activa (ej. Thinking, Running tool, etc.)
    const recentTail = lines.slice(-4).join("\n");
    if (ACTIVE_EXECUTION_REGEX.test(recentTail)) {
      // El agente aún está procesando, llamando herramientas o editando
      return;
    }

    // Descartar si la última línea es un marco o decorador de caja TUI
    if (/^[╭╰│─┌└═─\s]+$/.test(lastLine)) {
      return;
    }

    // Verificar si la última línea corresponde a un prompt interactivo listo
    if (PROMPT_READY_REGEX.test(lastLine)) {
      this.hasUserInput = false; // Resetear para esperar el próximo comando del usuario
      const snippet = extractCleanSnippet(cleanTail) || "Tarea finalizada con éxito";
      this.emitNotification("finalizado", snippet, onNotification);
      return;
    }

    // Si pasaron 2 segundos y el terminal se estabilizó sin match, resetear
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
    if (this.choiceTimer !== null) {
      clearTimeout(this.choiceTimer);
      this.choiceTimer = null;
    }
    if (this.finishTimer !== null) {
      clearTimeout(this.finishTimer);
      this.finishTimer = null;
    }
  }
}
