import { createRoot } from "react-dom/client";
import App from "./App";
import { connect, type Theme } from "./shard-sdk";
import "./index.css";

const sdk = connect();

/** Match the app: the host sends its CSS custom properties, which the Tailwind preset reads through var(--...). */
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(theme.vars)) root.style.setProperty(name, value);
  root.classList.toggle("dark", theme.isDark);
  root.style.colorScheme = theme.isDark ? "dark" : "light";
}

createRoot(document.getElementById("root")!).render(<App sdk={sdk} />);

sdk
  .ready()
  .then(({ theme }) => {
    applyTheme(theme);
    sdk.theme.onChange(applyTheme);
  })
  .catch(() => {
    // Opened outside the app (npm run dev): generating works, copying does not.
  });
