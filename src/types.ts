import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";

export type IslandMode = "collapsed" | "glance" | "expanded";
export type SplitLayout = "single" | "split-vertical" | "split-horizontal";
export type CollapsedWidgetType = "pty_status" | "clock" | "system_metrics" | "live_log";

export interface SystemMetrics {
  cpu_usage: number;
  memory_used_mb: number;
  memory_total_mb: number;
  memory_percent: number;
}

export interface PtyStatus {
  sessionId: string;
  foregroundProcess: string;
  isBusy: boolean;
  exitCode: number | null;
}

export interface TerminalPane {
  id: string;
  sessionId: string;
  processName: string;
  status: "idle" | "running" | "done" | "error";
  lastSnippet: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  element: HTMLDivElement;
}

export interface TerminalTab {
  id: string;
  title: string;
  layout: SplitLayout;
  panes: TerminalPane[];
  activePaneId: string;
  containerElement: HTMLDivElement;
}

export interface CustomProfile {
  id: string;
  name: string;
  command: string;
  cwd?: string;
  icon?: string;
}
