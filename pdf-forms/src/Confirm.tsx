import { useEffect, useRef } from "react";
import { useT } from "./lib/i18n";
export default function Confirm({ title, children, action, onConfirm, onCancel }: { title: string; children: React.ReactNode; action: string; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null), t = useT();
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} aria-labelledby="confirmation-title" onCancel={e => { e.preventDefault(); onCancel(); }}><h2 id="confirmation-title">{title}</h2>{children}<div className="dialog-actions"><button type="button" autoFocus onClick={onCancel}>{t("cancel")}</button><button type="button" className="primary" onClick={onConfirm}>{action}</button></div></dialog>;
}
