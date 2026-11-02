import { sdk } from "../sdk";

// Stands in for the `sonner` package: the app shows the toast, as it does for every plugin.
// The port script rewrites `from "sonner"` to `from "@/shims/sonner"`.
type Kind = "info" | "success" | "warning" | "error";
const send = (kind: Kind) => (message: unknown) => {
  void sdk.toast(String(message), kind).catch(() => {});
};

export const toast = Object.assign(send("info"), {
  info: send("info"),
  success: send("success"),
  warning: send("warning"),
  error: send("error"),
});

export const Toaster = () => null;
