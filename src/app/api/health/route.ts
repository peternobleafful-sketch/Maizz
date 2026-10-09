// Simple check that the service is up. Reveals nothing about the system.
export function GET() {
  return Response.json({ ok: true });
}
