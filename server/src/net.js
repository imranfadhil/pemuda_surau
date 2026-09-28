import net from 'node:net';
import dns from 'node:dns';

/**
 * Outbound networking tweaks. Import this FIRST, before anything that performs
 * a fetch, so the settings apply to every later request.
 *
 * Node 20+ enables "Happy Eyeballs" (autoSelectFamily) by default: when a host
 * has both A and AAAA records it starts IPv4 and IPv6 connections in parallel
 * and takes whichever wins. On hosts with no IPv6 egress (e.g. a droplet whose
 * Docker network is IPv4-only) the IPv6 attempt is a black hole - it neither
 * connects nor fails fast - so the whole request times out even though IPv4
 * would have worked. That is what broke the Aladhan prayer-times API: the
 * server logged `fetch failed` / ETIMEDOUT while `curl -4` to the same URL
 * succeeded.
 *
 * Disabling the auto-selection makes Node use the first DNS answer (which is
 * IPv4 here) directly. IPv6-only hosts still work, because their first answer
 * is an AAAA record.
 *
 * Set `NET_IPV4_ONLY=false` to opt out if a future environment is IPv6-only
 * and the first answer ever resolves to an unreachable address.
 */
if ((process.env.NET_IPV4_ONLY || 'true') !== 'false') {
  net.setDefaultAutoSelectFamily(false);
  dns.setDefaultResultOrder('ipv4first');
}
