import { createRoot } from "react-dom/client";
import App from "./App";
import { followHostLocale, t } from "./lib/i18n";
import { connect, loadWasm, type Theme } from "./shard-sdk";
import { createHasher } from "./hasher";
import "./index.css";

const sdk = connect();

/** Match the app: the host sends its CSS custom properties, which the Tailwind preset reads through var(--...). */
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(theme.vars)) root.style.setProperty(name, value);
  root.classList.toggle("dark", theme.isDark);
  root.style.colorScheme = theme.isDark ? "dark" : "light";
}

const root = createRoot(document.getElementById("root")!);

async function start() {
  // The theme is applied whenever the host answers; the page does not wait for it.
  sdk
    .ready()
    .then(({ theme }) => {
      applyTheme(theme);
      sdk.theme.onChange(applyTheme);
    })
    .catch(() => {
      // Opened outside the app (npm run dev): the hashing still works, files and copying do not.
    });
  // The module loads while the app language is awaited (it answers within 300 ms, or never outside the app), so the first paint is in it.
  const module = loadWasm("hash.wasm");
  module.catch(() => {}); // handled below, once the language is in
  await followHostLocale(sdk);
  try {
    const { instance } = await module;
    root.render(<App sdk={sdk} hasher={createHasher(instance)} />);
  } catch (error) {
    root.render(<p role="alert" className="p-6 text-sm text-destructive">{t("error.startModule", { message: (error as Error).message })}</p>);
  }
}

void start();
