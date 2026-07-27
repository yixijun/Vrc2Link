export function getClientIp(headers, socketAddress, trustProxy) {
  if (trustProxy) {
    const forwarded = headers.get('x-forwarded-for')
      ?.split(',')[0]
      ?.trim();
    if (forwarded) return forwarded;

    const realIp = headers.get('x-real-ip')?.trim();
    if (realIp) return realIp;
  }

  return socketAddress || 'unknown';
}
