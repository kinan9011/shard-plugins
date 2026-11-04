export class FormError extends Error {
  constructor(readonly key: string, readonly vars: Record<string, string | number> = {}) { super(key); }
}
