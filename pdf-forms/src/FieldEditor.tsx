import { useId } from "react";
import type { Field, Value } from "./pdf/engine";
import { supported } from "./pdf/engine";
import { useT } from "./lib/i18n";

export default function FieldEditor({ field, value, selected, disabled, onChange, onFocus }: { field: Field; value: Value; selected: boolean; disabled: boolean; onChange: (value: Value) => void; onFocus: () => void }) {
  const t = useT(), id = useId();
  const locked = disabled || field.readOnly || !supported(field);
  const control = { id, disabled: locked, onFocus, "aria-required": field.required, "aria-describedby": `${id}-meta` };
  return <div className={`field-editor${selected ? " active-field" : ""}`} data-field={field.name}>
    <div className="field-heading"><label id={`${id}-label`} htmlFor={id}><bdi>{field.name}</bdi></label>{field.required && <span className="required-mark" title={t("required")}>*</span>}
      {field.readOnly && <span className="field-badge">{t("readOnly")}</span>}{!supported(field) && <span className="field-badge">{t("unsupported")}</span>}
    </div>
    <div className="field-meta" id={`${id}-meta`}><span>{t(`type.${field.kind}`)}</span><span>{field.widgets.length ? t("field.page", { n: [...new Set(field.widgets.map(w => w.page))].join(", ") }) : t("field.unplaced")}</span>{field.maxLength !== undefined && <span>{t("field.limit", { n: field.maxLength })}</span>}</div>
    {field.kind === "text" ? field.multiline ? <textarea {...control} dir="auto" rows={3} maxLength={field.maxLength} value={value as string} onChange={e => onChange(e.target.value)} />
      : <input {...control} dir="auto" type={field.password ? "password" : "text"} maxLength={field.maxLength} value={value as string} onChange={e => onChange(e.target.value)} />
      : field.kind === "checkbox" ? <label className="check-label"><input {...control} type="checkbox" checked={value === true} onChange={e => onChange(e.target.checked)} />{t("field.checked")}</label>
      : field.kind === "radio" ? <fieldset id={id} disabled={locked} onFocus={onFocus} aria-required={field.required} aria-labelledby={`${id}-label`} aria-describedby={`${id}-meta`}><legend className="sr-only">{field.name}</legend>
        {field.options.map(option => <label className="check-label" key={option}><input type="radio" name={id} value={option} checked={value === option} onChange={() => onChange(option)} /><bdi>{option}</bdi></label>)}
        {value !== "" && <button type="button" className="text-button" onClick={() => onChange("")}>{t("field.clear")}</button>}
      </fieldset> : field.kind === "dropdown" || field.kind === "list" ? field.editable && !field.multi ? <><input {...control} dir="auto" list={`${id}-options`} value={value as string} onChange={e => onChange(e.target.value)} /><datalist id={`${id}-options`}>{field.options.map(option => <option key={option} value={option} />)}</datalist></>
      : field.multi ? <fieldset id={id} disabled={locked} onFocus={onFocus} aria-required={field.required} aria-labelledby={`${id}-label`} aria-describedby={`${id}-meta`}><legend className="sr-only">{field.name}: {t("field.multi")}</legend>{field.options.map(option => <label className="check-label" key={option}><input type="checkbox" checked={Array.isArray(value) && value.includes(option)} onChange={e => onChange(e.target.checked ? [...(value as string[]), option] : (value as string[]).filter(v => v !== option))} /><bdi>{option}</bdi></label>)}</fieldset>
      : <select {...control} value={value as string} onChange={e => onChange(e.target.value)}><option value="">{t("field.select")}</option>{field.options.map(option => <option key={option} value={option}>{option}</option>)}</select>
      : <p className="muted">{t(field.kind === "signature" ? "signature.note" : "unsupported")}</p>}
  </div>;
}
