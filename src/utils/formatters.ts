import { open as openDialog } from "@tauri-apps/plugin-dialog";

/**
 * Diálogo nativo de selección de carpetas con Tauri
 */
export async function promptOpenFolder(): Promise<string | null> {
  try {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "Seleccionar carpeta para terminal",
    });

    if (!selected) return null;
    if (Array.isArray(selected)) {
      return selected.length > 0 ? selected[0] : null;
    }
    return selected;
  } catch (err) {
    console.error("[Dialog] Error al abrir diálogo de selección de carpeta:", err);
    return null;
  }
}

/**
 * Recorta rutas largas anteponiendo puntos suspensivos para no desbordar la interfaz
 */
export function formatPathSnippet(fullPath: string, maxLength = 36): string {
  if (!fullPath) return "";
  if (fullPath.length <= maxLength) return fullPath;

  const sep = fullPath.includes("\\") ? "\\" : "/";
  const parts = fullPath.split(/[/\\]/).filter(Boolean);

  if (parts.length <= 1) {
    return "…" + fullPath.slice(-maxLength + 1);
  }

  const base = parts[parts.length - 1];
  const parent = parts[parts.length - 2];
  const candidate = `…${sep}${parent}${sep}${base}`;

  if (candidate.length <= maxLength) {
    let result = candidate;
    for (let i = parts.length - 3; i >= 0; i--) {
      const nextCandidate = `…${sep}${parts[i]}${sep}` + result.slice(2);
      if (nextCandidate.length <= maxLength) {
        result = nextCandidate;
      } else {
        break;
      }
    }
    return result;
  }

  return "…" + fullPath.slice(-maxLength + 1);
}

/**
 * Diálogo nativo para seleccionar una imagen de fondo (wallpaper)
 */
export async function promptSelectWallpaperImage(): Promise<string | null> {
  try {
    const selected = await openDialog({
      title: "Seleccionar imagen de fondo para la terminal",
      multiple: false,
      directory: false,
      filters: [
        {
          name: "Imágenes (*.png, *.jpg, *.jpeg, *.webp, *.gif, *.bmp)",
          extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"],
        },
      ],
    });
    if (selected && typeof selected === "string") {
      return selected;
    }
    if (Array.isArray(selected) && selected.length > 0) {
      return selected[0];
    }
    return null;
  } catch (err) {
    console.error("[Dialog] Error al seleccionar wallpaper:", err);
    return null;
  }
}
