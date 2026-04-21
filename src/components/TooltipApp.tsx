import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
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
    <div className="tooltip-window">
      {clip && <ClipTooltipContent clip={clip} />}
    </div>
  );
}
