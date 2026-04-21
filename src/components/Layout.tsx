import type { ReactNode } from "react";
import { SearchBar } from "./SearchBar";
import { OptionsMenu } from "./OptionsMenu";
import { TitleBar } from "./TitleBar";

interface LayoutProps {
  children: ReactNode;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}

export function Layout({ children, searchInputRef }: LayoutProps) {
  return (
    <div className="app-layout">
      <TitleBar />
      <main className="app-main">{children}</main>
      <div className="bottom-bar">
        <SearchBar inputRef={searchInputRef} />
        <OptionsMenu />
      </div>
    </div>
  );
}
