import { useRef, useEffect } from "react";
import { useClipStore } from "../store/clipStore";

interface SearchBarProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
}

export function SearchBar({ inputRef }: SearchBarProps) {
  const searchQuery = useClipStore((s) => s.searchQuery);
  const setSearch = useClipStore((s) => s.setSearch);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleChange = (value: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setSearch(value);
    }, 300);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className="search-bar">
      <input
        ref={inputRef}
        type="text"
        className="search-input"
        placeholder="Search"
        defaultValue={searchQuery}
        onChange={(e) => handleChange(e.target.value)}
      />
    </div>
  );
}
