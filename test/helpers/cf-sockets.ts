// Stand-in for the Workers 'cloudflare:sockets' module under Node/vitest (aliased in vitest.config.ts).
// Tests pass their own fake SMTP server to smtpSend; nothing in the suite opens a real connection.
export function connect(): never {
  throw new Error('cloudflare:sockets is not available in tests – pass a fake connect function');
}
