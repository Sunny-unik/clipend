import { useState, type ReactNode } from "react";
import { SearchBar } from "./SearchBar";
import { OptionsMenu } from "./OptionsMenu";
import { TitleBar } from "./TitleBar";
import { AddClipModal } from "./AddClipModal";

interface LayoutProps {
  children: ReactNode;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}

export function Layout({ children, searchInputRef }: LayoutProps) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="app-layout">
      <TitleBar />
      <main className="app-main">{children}</main>
      <div className="bottom-bar">
        <SearchBar inputRef={searchInputRef} />
        <button
          className="add-clip-btn"
          onClick={() => setAddOpen(true)}
          title="New clip"
          aria-label="New clip"
        >
          +
        </button>
        <OptionsMenu />
      </div>
      {addOpen && <AddClipModal onClose={() => setAddOpen(false)} />}
    </div>
  );
}
