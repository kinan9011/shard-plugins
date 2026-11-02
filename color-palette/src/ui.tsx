// The few shadcn pieces the moved tool components use, as plain elements with the same Tailwind classes. A plugin
// cannot share the app's components, and Radix is not needed for them.
import { createContext, forwardRef, useContext, type ButtonHTMLAttributes, useId, type ReactNode, type HTMLAttributes, type InputHTMLAttributes, type LabelHTMLAttributes, type TextareaHTMLAttributes } from "react";

const cx = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(" ");

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cx("rounded-lg border bg-card text-card-foreground", className)} {...props} />
));
Card.displayName = "Card";

export const CardHeader = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <div className={cx("flex flex-col space-y-1.5 p-6", className)} {...props} />;
export const CardTitle = ({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) => <h3 className={cx("text-base font-semibold leading-snug tracking-tight", className)} {...props} />;
export const CardDescription = ({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) => <p className={cx("text-sm text-muted-foreground", className)} {...props} />;
export const CardContent = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <div className={cx("p-6 pt-0", className)} {...props} />;

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0";
const BUTTON_VARIANTS = {
  default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
  outline: "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
  secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
  ghost: "hover:bg-accent hover:text-accent-foreground",
};
const BUTTON_SIZES = { default: "h-8 px-3 py-1", sm: "h-8 rounded-md px-3 text-xs", icon: "h-9 w-9" };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: keyof typeof BUTTON_SIZES;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant = "default", size = "default", type = "button", ...props }, ref) => (
  <button ref={ref} type={type} className={cx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)} {...props} />
));
Button.displayName = "Button";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cx(
      "flex h-8 w-full rounded-md border border-input bg-card px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cx(
      "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export const Label = ({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) => <label className={cx("text-sm font-medium leading-none", className)} {...props} />;

/** A native select, styled like the app's inputs. */
export const SELECT_CLASS =
  "h-8 rounded-md border border-input bg-card px-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

// Tabs: a controlled set with the roles and data-state a Radix Tabs has. A panel with `forceMount` stays in the DOM.
const TabsContext = createContext<{ base: string; value: string; setValue: (value: string) => void }>({ base: "tabs", value: "", setValue: () => {} });

export function Tabs({ value, onValueChange, className, children }: { value: string; onValueChange: (value: string) => void; className?: string; children: ReactNode }) {
  const base = useId();
  return (
    <TabsContext.Provider value={{ base, value, setValue: onValueChange }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export const TabsList = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div role="tablist" className={cx("inline-flex h-8 items-center justify-center rounded-lg border border-foreground/10 bg-muted p-0.5 text-muted-foreground", className)} {...props} />
);

export function TabsTrigger({ value, className, ...props }: { value: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const tabs = useContext(TabsContext);
  const active = tabs.value === value;
  return (
    <button
      type="button"
      role="tab"
      id={`${tabs.base}-tab-${value}`}
      aria-controls={`${tabs.base}-panel-${value}`}
      aria-selected={active}
      data-state={active ? "active" : "inactive"}
      onClick={() => tabs.setValue(value)}
      className={cx(
        "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-[3px] text-xs font-medium transition-colors data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ value, forceMount, className, ...props }: { value: string; forceMount?: boolean } & HTMLAttributes<HTMLDivElement>) {
  const tabs = useContext(TabsContext);
  const active = tabs.value === value;
  if (!active && !forceMount) return null;
  return <div role="tabpanel" id={`${tabs.base}-panel-${value}`} aria-labelledby={`${tabs.base}-tab-${value}`} data-state={active ? "active" : "inactive"} className={cx("mt-2", className)} {...props} />;
}
