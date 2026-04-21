import { useRef, useEffect, useState } from "react";
import { useClipStore } from "../store/clipStore";

interface SearchBarProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
}

export function SearchBar({ inputRef }: SearchBarProps) {
  const searchQuery = useClipStore((s) => s.searchQuery);
  const setSearch = useClipStore((s) => s.setSearch);
  const [value, setValue] = useState(searchQuery);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Reflect external changes (e.g. store-level clear on window re-focus).
  useEffect(() => {
    setValue(searchQuery);
  }, [searchQuery]);

  const handleChange = (v: string) => {
    setValue(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setSearch(v);
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
        value={value}
        onChange={(e) => handleChange(e.target.value)}
      />
    </div>
  );
}
