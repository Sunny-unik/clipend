import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useClipStore } from "../store/clipStore";

type ClipboardPayload =
  | { kind: "text"; text: string; html: string | null }
  | { kind: "image"; path: string; width: number; height: number }
  | { kind: "files"; files: Array<{ path: string; name: string }> };

export function useClipboardListener() {
  const addClip = useClipStore((s) => s.addClip);

  useEffect(() => {
    const unlisten = listen<ClipboardPayload>("clipboard-changed", (event) => {
      const store = useClipStore.getState();

      if (store.skipNextEvent) {
        store.setSkipNextEvent(false);
        return;
      }

      const payload = event.payload;
      if (payload.kind === "text") {
        if (payload.text && payload.text.trim().length > 0) {
          store.addClip({
            kind: "text",
            text: payload.text,
            html: payload.html,
          });
        }
      } else if (payload.kind === "image") {
        store.addClip({
          kind: "image",
          path: payload.path,
          width: payload.width,
          height: payload.height,
        });
      } else if (payload.kind === "files") {
        // One clip per file so each can be pinned/searched individually
        for (const f of payload.files) {
          store.addClip({ kind: "file", path: f.path, name: f.name });
        }
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [addClip]);
}
