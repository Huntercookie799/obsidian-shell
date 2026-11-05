/**
 * Helpers utilitarios para manipulación tipada y segura del DOM
 */

export function getEl<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`[DOM] Elemento no encontrado con id: #${id}`);
  }
  return el as T;
}

export function queryEl<T extends HTMLElement = HTMLElement>(selector: string, parent: ParentNode = document): T | null {
  return parent.querySelector<T>(selector);
}

export function queryAll<T extends HTMLElement = HTMLElement>(selector: string, parent: ParentNode = document): NodeListOf<T> {
  return parent.querySelectorAll<T>(selector);
}

export function setVisible(element: HTMLElement | null, visible: boolean, displayValue = "flex"): void {
  if (!element) return;
  if (visible) {
    element.classList.remove("hidden");
    element.style.display = displayValue;
  } else {
    element.classList.add("hidden");
    element.style.display = "none";
  }
}
