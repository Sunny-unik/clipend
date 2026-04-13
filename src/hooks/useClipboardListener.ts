import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useClipStore } from "../store/clipStore";

interface ClipboardPayload {
  text: string;
}

export function useClipboardListener() {
  const addClip = useClipStore((s) => s.addClip);

  useEffect(() => {
    const unlisten = listen<ClipboardPayload>("clipboard-changed", (event) => {
      const store = useClipStore.getState();

      // Skip if this was triggered by our own write_to_clipboard call
      if (store.skipNextEvent) {
        store.setSkipNextEvent(false);
        return;
      }

      const text = event.payload.text;
      if (text && text.trim().length > 0) {
        store.addClip(text);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [addClip]);
}
