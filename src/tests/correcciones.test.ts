import { describe, it, expect, vi, beforeEach } from "vitest";
import { hexToRgb, stripAnsi } from "../components/TerminalView";
import { IslandController } from "../components/island/IslandController";
import { CliActivityTracker, PROMPT_READY_REGEX } from "../utils/cliNotifications";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../utils/cliNotifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/cliNotifications")>();
  return {
    ...actual,
    playNotificationSound: vi.fn(),
  };
});

describe("Utilidades de TerminalView", () => {
  it("convierte colores hexadecimales cortos y largos a RGB", () => {
    expect(hexToRgb("#FF6B00")).toEqual({ r: 255, g: 107, b: 0 });
    expect(hexToRgb("#0f0")).toEqual({ r: 0, g: 255, b: 0 });
    expect(hexToRgb("invalido")).toBeNull();
  });

  it("limpia secuencias ANSI y saltos de línea", () => {
    const entrada = "\x1b[32mCompilación exitosa\x1b[0m\r\nListo";
    expect(stripAnsi(entrada)).toBe("Compilación exitosa Listo");
  });
});

describe("IslandController", () => {
  const crearDomBase = () => {
    document.body.innerHTML = `
      <div id="island-container" class="state-collapsed">
        <div id="rim-light"></div>
        <header id="notch-pill"><span id="status-orb"></span></header>
        <section id="notch-glance">
          <span id="glance-orb"></span>
          <span id="glance-title"></span>
          <span id="glance-status-tag"></span>
          <span id="glance-snippet"></span>
          <div id="glance-actions" class="hidden">
            <button id="btn-glance-confirm"></button>
            <button id="btn-glance-open"></button>
          </div>
        </section>
        <button id="btn-collapse"></button>
      </div>
    `;
  };

  const crearControlador = () => {
    const controlador = new IslandController({
      isAnyPopoverOpen: () => false,
      isSearchBarOpen: () => false,
      closeAllPopovers: vi.fn(),
      closeSearchBar: vi.fn(),
      getActivePane: () => null,
      getActiveTabTitle: () => "powershell",
      fitActiveTabPanes: vi.fn(),
    });
    controlador.initDom();
    return controlador;
  };

  beforeEach(() => {
    crearDomBase();
    localStorage.clear();
  });

  it("considera expandida la isla tanto en modo expanded como en fullscreen", async () => {
    const controlador = crearControlador();

    expect(controlador.isExpanded()).toBe(false);

    await controlador.setMode("glance", false);
    expect(controlador.isExpanded()).toBe(false);

    await controlador.setMode("expanded", false);
    expect(controlador.isExpanded()).toBe(true);

    await controlador.setMode("fullscreen", false);
    expect(controlador.isExpanded()).toBe(true);

    await controlador.setMode("collapsed", false);
    expect(controlador.isExpanded()).toBe(false);
  });

  it("muestra el título de notificación CLI sin duplicación", () => {
    const controlador = crearControlador();

    controlador.handleCliNotification({
      type: "eleccion",
      sessionId: "sesion-1",
      tabId: "pestana-1",
      paneId: "panel-1",
      title: "Claude Code",
      promptSnippet: "¿Desea continuar?",
      timestamp: Date.now(),
    });

    const titulo = document.getElementById("glance-title")?.textContent;
    const estado = document.getElementById("glance-status-tag")?.textContent;
    expect(titulo).toBe("Claude Code");
    expect(estado).toBe("CONFIRMACIÓN");
  });
});

describe("CliActivityTracker", () => {
  it("no confunde porcentajes de progreso con un prompt listo", () => {
    expect(PROMPT_READY_REGEX.test("Descargando 100%")).toBe(false);
    expect(PROMPT_READY_REGEX.test("PS D:\\proyecto>")).toBe(true);
  });

  it("ignora señales bell cuando no se ha ejecutado ningún comando", () => {
    const tracker = new CliActivityTracker("s1", "t1", "p1", "powershell");
    const onNotif = vi.fn();
    tracker.handleBell(onNotif);
    expect(onNotif).not.toHaveBeenCalled();
    tracker.dispose();
  });
});
