/**
 * The admin login. The password is a Cloudflare secret (ADMIN_PASSWORD), set
 * in the dashboard and never in the repository. Logging in gives a token that
 * is good for SESSION_HOURS; it is signed with the password itself, so
 * changing the password signs everyone out.
 */

const SESSION_HOURS = 12

const encoder = new TextEncoder()

/** The admin password, or undefined while it has not been set in Cloudflare. */
export function adminPassword(env: object): string | undefined {
  const value = (env as Record<string, unknown>).ADMIN_PASSWORD
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Compares two texts in constant time, so the answer's timing gives nothing
 * away: both are hashed to 32 bytes, and every byte is always compared.
 */
export async function sameText(a: string, b: string): Promise<boolean> {
  const [x, y] = (await Promise.all([digest(a), digest(b)])).map((d) => new Uint8Array(d))
  let difference = 0
  for (let i = 0; i < x.length; i++) difference |= x[i] ^ y[i]
  return difference === 0
}

/** A token good for SESSION_HOURS from now. */
export async function issueToken(password: string): Promise<{ token: string; expiresAt: string }> {
  const expires = Date.now() + SESSION_HOURS * 3600_000
  return { token: `${expires}.${await sign(password, expires)}`, expiresAt: new Date(expires).toISOString() }
}

/** Whether a token was issued with this password and has not run out. */
export async function validToken(token: string, password: string): Promise<boolean> {
  const [expiresText, signature] = token.split('.')
  const expires = Number(expiresText)
  if (!signature || !Number.isInteger(expires) || expires < Date.now()) return false
  return sameText(signature, await sign(password, expires))
}

async function sign(password: string, expires: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`admin:${expires}`))
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

const digest = (text: string) => crypto.subtle.digest('SHA-256', encoder.encode(text))
