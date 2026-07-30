import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

import { AppError } from '../errors.js';

const blockedAddresses = new BlockList();

for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]) {
  blockedAddresses.addSubnet(network, prefix, 'ipv4');
}

for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
]) {
  blockedAddresses.addSubnet(network, prefix, 'ipv6');
}

export async function assertPublicHttpUrl(input, options = {}) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw unsafeUrl('Generic resolver requires a valid HTTP(S) URL');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw unsafeUrl('Generic resolver accepts only HTTP(S) URLs');
  }
  if (url.username || url.password) {
    throw unsafeUrl('URLs containing credentials are not allowed');
  }

  const hostname = url.hostname.replace(/^\[|\]$/gu, '');
  const family = isIP(hostname);
  let addresses;
  try {
    addresses = family
      ? [{ address: hostname, family }]
      : await (options.lookup || dnsLookup)(hostname, { all: true, verbatim: true });
  } catch {
    throw unsafeUrl('URL host could not be resolved');
  }

  if (!addresses?.length) throw unsafeUrl('URL host could not be resolved');
  for (const entry of addresses) {
    const type = Number(entry.family) === 6 ? 'ipv6' : 'ipv4';
    const mappedIpv4 = type === 'ipv6' ? ipv4FromMappedAddress(entry.address) : null;
    const blocked = mappedIpv4
      ? blockedAddresses.check(mappedIpv4, 'ipv4')
      : blockedAddresses.check(entry.address, type);
    if (blocked) {
      throw unsafeUrl('Private, local, and reserved network addresses are not allowed');
    }
  }

  return url.href;
}

function ipv4FromMappedAddress(address) {
  const dotted = String(address).match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/iu);
  if (dotted) return dotted[1];

  const hexadecimal = String(address).match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/iu);
  if (!hexadecimal) return null;
  const high = Number.parseInt(hexadecimal[1], 16);
  const low = Number.parseInt(hexadecimal[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

function unsafeUrl(message) {
  return new AppError(400, 'unsafe_url', message);
}
