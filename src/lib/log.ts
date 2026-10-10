// One-line JSON logs. Never pass keys, phone numbers or names into these fields.
export function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields }));
}

export function logError(event: string, fields: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ at: new Date().toISOString(), level: "error", event, ...fields }));
}
