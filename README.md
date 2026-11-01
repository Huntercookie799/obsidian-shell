# ObsidianShell

Emulador de terminal flotante multiplataforma de ultra bajo consumo con arquitectura offline-first, construido con Tauri v2, Rust y TypeScript.

## Descripcion

ObsidianShell es una interfaz de pseudoterminal (PTY) interactiva diseñada como un HUD flotante (Dynamic Island) anclado al borde superior de la pantalla. Permite gestionar consolas del sistema operativo, procesos en segundo plano y herramientas CLI de forma inmediata mediante un flujo de trabajo optimizado sin bordes de ventana del sistema y con impacto mínimo en el consumo de memoria y CPU.

## Caracteristicas Principales

- **Dynamic Island HUD:** Interfaz con tres estados dimensionales fluidos:
  - Collapsed: Pildora compacta en reposo de 260x34 pixeles con borde luminoso reactivo y widgets intercambiables (reloj digital, metricas de CPU/RAM, estado de sesiones o log vivo).
  - Glance: Vista previa expandida a 420x64 pixeles activada por proximidad de cursor con debounce de 120ms o actividad en segundo plano.
  - Expanded: Centro de control de terminales de 850x480 pixeles con renderizado acelerado por hardware via WebGL.
- **Arquitectura PTY Concurrente en Rust:** Gestor multiplexor multihilo con soporte nativo para PowerShell, Command Prompt y WSL en Windows, asi como Bash, Zsh y Fish en Linux mediante portable-pty.
- **Paneles Divididos (Split Panes):** Soporte para subdivision vertical (Ctrl+Shift+D) y horizontal (Ctrl+Shift+E) dentro de una misma pestaña, micro-encabezados con indicador de shell, cierre individual y navegacion rapida entre paneles mediante Alt+Flechas.
- **Busqueda en Buffer:** Herramienta de localizacion incremental en historial de terminal mediante atajo Ctrl+Shift+F.
- **Sistema Nativo de Auto-Actualizaciones:** Motor offline-safe con verificacion criptografica de firmas Minisign Ed25519 y endpoints estaticos.
- **System Tray Nativo y Multi-Monitor:** Menu de bandeja del sistema con soporte para alternar visibilidad, centrar ventana y conmutar la ubicacion de la isla entre pantallas disponibles.
- **Auto-Ocultamiento y Auto-Inicio:** Cierre automatico al salir el cursor con debounce configurable y soporte para ejecucion automatica al iniciar sesion del sistema operativo.

## Stack Tecnologico

- **Nucleo de Escritorio:** Tauri v2
- **Backend de Sistema y PTY:** Rust, portable-pty, tokio, sysinfo, tauri-plugin-autostart, tauri-plugin-updater
- **Frontend y Logica de Presentacion:** TypeScript, Vite
- **Motor de Renderizado de Terminal:** @xterm/xterm con aceleracion @xterm/addon-webgl, @xterm/addon-fit y @xterm/addon-search

## Guia de Instalacion y Compilacion Local

### Requisitos Previos

- Node.js (version 18 o superior) y npm
- Rust y Cargo (version 1.77 o superior)
- Dependencias de compilacion nativas de la plataforma:
  - **Windows:** Microsoft Visual Studio C++ Build Tools y WebView2 Runtime
  - **Linux:** Paquetes de desarrollo webkit2gtk-4.1, libayatana-appindicator3, libxdo y librsvg2

### Instalacion de Dependencias

Clonar el repositorio y ejecutar la instalacion de paquetes de frontend:

```bash
git clone https://github.com/IDGS-803-23001488/obsidian-shell.git
cd obsidian-shell
npm install
```

### Ejecucion en Modo Desarrollo

Para compilar el backend de Rust e iniciar el servidor de desarrollo de Vite con recarga rapida:

```bash
npm run tauri dev
```

### Compilacion de Produccion

Para generar los ejecutables nativos e instaladores con optimizaciones de tiempo de enlace (LTO) y reduccion de tamaño de binario:

```bash
npm run tauri build
```

Los artefactos de distribucion generados (.exe, .msi en Windows; .deb, .AppImage en Linux) se ubicaran en:

```text
src-tauri/target/release/bundle/
```

## Licencia

Este proyecto esta licenciado bajo los terminos de la Licencia MIT.
