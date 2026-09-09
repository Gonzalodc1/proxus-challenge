import { useState } from "react";
import { ArtifactWorkspace } from "./components/ArtifactWorkspace.tsx";
import { Chat } from "./components/Chat.tsx";
import { Sidebar } from "./components/Sidebar.tsx";

type Theme = "dark" | "light";

export function App() {
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light"
  );

  const toggleTheme = () => {
    setTheme((current) => {
      const next: Theme = current === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", next === "dark");
      try {
        localStorage.setItem("proxus-theme", next);
      } catch {
        // ignore: storage may be unavailable
      }
      return next;
    });
  };

  const columns = [
    sidebarOpen ? "300px" : null,
    selectedArtifactId !== null ? "460px" : null,
    "minmax(0, 1fr)"
  ].filter((value): value is string => value !== null).join(" ");

  return (
    <div
      className="grid h-screen min-h-screen overflow-hidden bg-slate-950 text-slate-100"
      style={{ gridTemplateColumns: columns }}
    >
      {sidebarOpen && <Sidebar selectedArtifactId={selectedArtifactId} onSelectArtifact={setSelectedArtifactId} />}
      {selectedArtifactId !== null && (
        <ArtifactWorkspace artifactId={selectedArtifactId} onClose={() => setSelectedArtifactId(null)} />
      )}
      <Chat
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    </div>
  );
}
