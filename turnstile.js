// SEC-45: Cloudflare Turnstile server-side token verification
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstile(token, secretKey, ip) {
  if (!token || !secretKey) return false;
  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: secretKey, response: token, remoteip: ip || '' }),
    });
    const data = await res.json();
    return data.success === true;
  } catch {
    return false;
  }
}
// 1774853345
// trigger 1774855095
