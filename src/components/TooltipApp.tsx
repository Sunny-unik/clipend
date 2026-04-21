import { useEffect, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import type { Clip } from "../types/clip";
import { ClipTooltipContent } from "./ClipTooltipContent";

export function TooltipApp() {
  const [clip, setClip] = useState<Clip | null>(null);

  useEffect(() => {
    const unlisten = listen<Clip | null>("tooltip-clip", (event) => {
      setClip(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <div
      className="tooltip-window"
      onMouseEnter={() => {
        emit("tooltip-mouse-enter");
      }}
      onMouseLeave={() => {
        emit("tooltip-mouse-leave");
      }}
    >
      {clip && <ClipTooltipContent clip={clip} />}
    </div>
  );
}
