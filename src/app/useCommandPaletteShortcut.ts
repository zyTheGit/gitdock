import { useEffect } from "react";
import { currentPlatform } from "../shared/platform";
import { isCapturing } from "../shared/keybindings";

export function useCommandPaletteShortcut(onOpen: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = currentPlatform() === "macos" ? event.metaKey : event.ctrlKey;
      if (
        !modifier ||
        !event.shiftKey ||
        event.altKey ||
        event.isComposing ||
        isCapturing() ||
        event.key.toLowerCase() !== "p"
      ) {
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
