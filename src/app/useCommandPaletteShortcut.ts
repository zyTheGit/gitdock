import { useEffect } from "react";
import { getBindings, isCapturing, matchesBinding } from "../shared/keybindings";

export function useCommandPaletteShortcut(onOpen: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || isCapturing()) {
        return;
      }
      if (!matchesBinding(getBindings()["app.commandPalette"], event)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onOpen();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onOpen]);
}
