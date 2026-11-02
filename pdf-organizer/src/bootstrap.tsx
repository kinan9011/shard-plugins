import { useEffect, useState, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { ToolActiveContext } from "@/hooks/useToolActive";
import { sdk } from "./sdk";
import { installLocalStorage } from "./storage-shim";
import type { Theme } from "./shard-sdk";

/** Match the app: the host sends its CSS custom properties, which the Tailwind preset reads through var(--...). */
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(theme.vars)) root.style.setProperty(name, value);
  root.classList.toggle("dark", theme.isDark);
  root.style.colorScheme = theme.isDark ? "dark" : "light";
}

function Root({ Tool, form }: { Tool: ComponentType; form: boolean }) {
  // False while the plugin's tab is in the background: tools use it to pause clocks and timers.
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    sdk.ready().then((info) => setVisible(info.visible)).catch(() => {});
    return sdk.onVisibilityChange(setVisible);
  }, []);
  return (
    <ToolActiveContext.Provider value={visible}>
      {/* The app wraps single-column tools in .tool-panel-form and lets editor-style tools fill the panel. */}
      <div className={form ? "tool-panel-form" : "h-full"}>
        <Tool />
      </div>
    </ToolActiveContext.Provider>
  );
}

/** Renders a tool component the way the app does, then follows the app theme. `form`: a single-column tool. */
export async function mountTool(Tool: ComponentType, { form = false }: { form?: boolean } = {}) {
  await installLocalStorage(); // tools read their settings while they render
  createRoot(document.getElementById("root")!).render(<Root Tool={Tool} form={form} />);
  sdk
    .ready()
    .then(({ theme }) => {
      applyTheme(theme);
      sdk.theme.onChange(applyTheme);
    })
    .catch(() => {
      // Opened outside the app (npm run dev): the tool works, the theme stays at the defaults.
    });
}
