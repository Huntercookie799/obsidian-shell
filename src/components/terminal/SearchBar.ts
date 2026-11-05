import { TerminalPane } from "../../types";

export interface SearchBarCallbacks {
  getActivePane: () => TerminalPane | null;
  onRequestExpand?: () => Promise<void>;
}

export class SearchBar {
  private searchBarEl: HTMLElement | null = null;
  private searchInput: HTMLInputElement | null = null;
  private btnSearchPrev: HTMLButtonElement | null = null;
  private btnSearchNext: HTMLButtonElement | null = null;
  private btnSearchClose: HTMLButtonElement | null = null;
  private callbacks: SearchBarCallbacks;

  constructor(callbacks: SearchBarCallbacks) {
    this.callbacks = callbacks;
  }

  public initDom(): void {
    this.searchBarEl = document.getElementById("terminal-search-bar");
    this.searchInput = document.getElementById("search-input") as HTMLInputElement;
    this.btnSearchPrev = document.getElementById("btn-search-prev") as HTMLButtonElement;
    this.btnSearchNext = document.getElementById("btn-search-next") as HTMLButtonElement;
    this.btnSearchClose = document.getElementById("btn-search-close") as HTMLButtonElement;

    this.bindEvents();
  }

  private bindEvents(): void {
    if (this.btnSearchClose) {
      this.btnSearchClose.addEventListener("click", () => {
        this.close();
      });
    }

    if (this.searchInput) {
      this.searchInput.addEventListener("input", () => {
        const activePane = this.callbacks.getActivePane();
        if (activePane && this.searchInput && this.searchInput.value) {
          activePane.searchAddon.findNext(this.searchInput.value, { incremental: true });
        }
      });

      this.searchInput.addEventListener("keydown", (e) => {
        const activePane = this.callbacks.getActivePane();
        if (!activePane || !this.searchInput) return;

        if (e.key === "Enter") {
          e.preventDefault();
          if (e.shiftKey) {
            activePane.searchAddon.findPrevious(this.searchInput.value);
          } else {
            activePane.searchAddon.findNext(this.searchInput.value);
          }
        } else if (e.key === "Escape") {
          e.preventDefault();
          this.close();
        }
      });
    }

    if (this.btnSearchNext) {
      this.btnSearchNext.addEventListener("click", () => {
        const activePane = this.callbacks.getActivePane();
        if (activePane && this.searchInput && this.searchInput.value) {
          activePane.searchAddon.findNext(this.searchInput.value);
        }
      });
    }

    if (this.btnSearchPrev) {
      this.btnSearchPrev.addEventListener("click", () => {
        const activePane = this.callbacks.getActivePane();
        if (activePane && this.searchInput && this.searchInput.value) {
          activePane.searchAddon.findPrevious(this.searchInput.value);
        }
      });
    }
  }

  public isVisible(): boolean {
    return !!this.searchBarEl && !this.searchBarEl.classList.contains("hidden");
  }

  public async open(): Promise<void> {
    if (!this.searchBarEl || !this.searchInput) return;

    if (this.callbacks.onRequestExpand) {
      await this.callbacks.onRequestExpand();
    }

    this.searchBarEl.classList.remove("hidden");
    this.searchInput.focus();
    this.searchInput.select();
  }

  public close(): void {
    if (!this.searchBarEl) return;
    this.searchBarEl.classList.add("hidden");

    const activePane = this.callbacks.getActivePane();
    if (activePane) {
      activePane.terminal.focus();
    }
  }

  public async toggle(): Promise<void> {
    if (this.isVisible()) {
      this.close();
    } else {
      await this.open();
    }
  }
}
