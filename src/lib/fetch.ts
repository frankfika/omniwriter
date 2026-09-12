import { setDefaultResultOrder } from 'node:dns';
import { lookup } from 'node:dns/promises';
import type { LookupFunction } from 'node:net';
import { BlockList, isIP } from 'node:net';
import { Agent, EnvHttpProxyAgent, fetch as undiciFetch } from 'undici';

// 服务端公网资源抓取：所有网页、图片与第三方 API 都复用同一套协议、DNS、
// 重定向、超时和响应体大小限制，避免任一新接口绕开 SSRF 边界。

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; OmniWriter/1.0; +https://localhost)';
const SAFE_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const hasProxyEnvironment = Boolean(
  process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy,
);

// 通过代理时 DNS 由代理端解析，无法在连接时 pin；此时依赖 assertPublicUrl 的预校验。
// 直连时用自定义 lookup 把解析结果再过滤一遍 blocklist，消除 DNS rebinding 竞态：
// 校验时解析到公网、连接时又被解析回内网的二义地址无法建立连接。
const validatedLookup: LookupFunction = (hostname, _options, callback) => {
  lookup(hostname, { all: true })
    .then((addresses) => {
      const safe = addresses.filter(({ address }) => !isPrivateAddress(address));
      if (!safe.length) {
        callback(new Error('不允许读取内网或保留地址'), '', 4);
        return;
      }
      // 直接返回全部已通过校验的地址；Node 会按序尝试，不会重解析。
      callback(null, safe.map(({ address, family }) => ({ address, family })), 4);
    })
    .catch((err: Error) => callback(err, '', 4));
};

const publicDispatcher = hasProxyEnvironment
  ? new EnvHttpProxyAgent()
  : new Agent({ connect: { lookup: validatedLookup } });

// 本机 IPv6 出口并不稳定；优先可达的 IPv4，仍在发出请求前校验 DNS 返回的
// 全部 IPv4/IPv6 地址，安全边界不因此缩小。
setDefaultResultOrder('ipv4first');

const blockedAddresses = new BlockList();
blockedAddresses.addSubnet('0.0.0.0', 8, 'ipv4');
blockedAddresses.addSubnet('10.0.0.0', 8, 'ipv4');
blockedAddresses.addSubnet('100.64.0.0', 10, 'ipv4');
blockedAddresses.addSubnet('127.0.0.0', 8, 'ipv4');
blockedAddresses.addSubnet('169.254.0.0', 16, 'ipv4');
blockedAddresses.addSubnet('172.16.0.0', 12, 'ipv4');
blockedAddresses.addSubnet('192.0.0.0', 24, 'ipv4');
blockedAddresses.addSubnet('192.0.2.0', 24, 'ipv4');
blockedAddresses.addSubnet('192.168.0.0', 16, 'ipv4');
blockedAddresses.addSubnet('198.18.0.0', 15, 'ipv4');
blockedAddresses.addSubnet('198.51.100.0', 24, 'ipv4');
blockedAddresses.addSubnet('203.0.113.0', 24, 'ipv4');
blockedAddresses.addSubnet('224.0.0.0', 4, 'ipv4');
blockedAddresses.addSubnet('240.0.0.0', 4, 'ipv4');
blockedAddresses.addAddress('::', 'ipv6');
blockedAddresses.addAddress('::1', 'ipv6');
// Node 的 BlockList 会把 IPv4 规则同时应用到 IPv4-mapped IPv6；不要阻断
// 整个 ::ffff:0:0/96，否则所有公开 IPv4 也会被误判为保留地址。
blockedAddresses.addSubnet('fc00::', 7, 'ipv6');
blockedAddresses.addSubnet('fe80::', 10, 'ipv6');
blockedAddresses.addSubnet('2001:db8::', 32, 'ipv6');

export interface PublicResponse {
  response: Response;
  finalUrl: URL;
}

export interface PublicBytes {
  bytes: Uint8Array;
  contentType: string;
  finalUrl: URL;
}

export interface PublicHtmlDocument {
  html: string;
  finalUrl: URL;
  contentType: string;
}

export interface PublicImage extends PublicBytes {
  contentType: SafeImageMime;
}

export interface ImageProbe {
  contentType: SafeImageMime;
  finalUrl: URL;
  declaredSize?: number;
}

export type SafeImageMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'image/avif';

export async function fetchPublicResponse(
  rawUrl: string | URL,
  options: {
    timeoutMs?: number;
    maxRedirects?: number;
    maxDeclaredBytes?: number;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  } = {},
): Promise<PublicResponse> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxRedirects = options.maxRedirects ?? 5;
  let current = parsePublicUrl(rawUrl);
  // 请求自身的取消信号（客户端离开/中止）与内部超时合并：任一触发即终止。
  const abort = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    await assertPublicUrl(current);
    const response = await undiciFetch(current, {
      headers: {
        'user-agent': DEFAULT_USER_AGENT,
        ...options.headers,
      },
      redirect: 'manual',
      signal: abort,
      dispatcher: publicDispatcher,
    }) as unknown as Response;

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => undefined);
      if (!location || redirects === maxRedirects) throw new Error('远程资源重定向次数过多');
      current = parsePublicUrl(new URL(location, current));
      continue;
    }

    const declaredSize = parseContentLength(response.headers.get('content-length'));
    if (options.maxDeclaredBytes && declaredSize && declaredSize > options.maxDeclaredBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error('远程资源体积超过限制');
    }
    return { response, finalUrl: current };
  }

  throw new Error('远程资源重定向次数过多');
}

export async function fetchPublicBytes(
  rawUrl: string | URL,
  options: {
    timeoutMs?: number;
    maxBytes: number;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  },
): Promise<PublicBytes> {
  const { response, finalUrl } = await fetchPublicResponse(rawUrl, {
    timeoutMs: options.timeoutMs,
    maxDeclaredBytes: options.maxBytes,
    headers: options.headers,
    signal: options.signal,
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`远程资源返回 HTTP ${response.status}`);
  }
  const bytes = await readLimitedBytes(response, options.maxBytes);
  return {
    bytes,
    finalUrl,
    contentType: normalizeContentType(response.headers.get('content-type')),
  };
}

export async function fetchPublicHtml(
  rawUrl: string | URL,
  options: { timeoutMs?: number; maxBytes?: number; signal?: AbortSignal } = {},
): Promise<PublicHtmlDocument> {
  const resource = await fetchPublicBytes(rawUrl, {
    timeoutMs: options.timeoutMs,
    maxBytes: options.maxBytes ?? 2_000_000,
    headers: { accept: 'text/html,application/xhtml+xml,text/plain;q=0.8' },
    signal: options.signal,
  });
  const allowed = new Set(['text/html', 'application/xhtml+xml', 'text/plain']);
  if (resource.contentType && !allowed.has(resource.contentType)) throw new Error('链接返回的不是网页正文');
  return {
    html: new TextDecoder().decode(resource.bytes),
    finalUrl: resource.finalUrl,
    contentType: resource.contentType || 'text/html',
  };
}

export async function probePublicImage(
  rawUrl: string | URL,
  options: { timeoutMs?: number; maxImageBytes?: number; signal?: AbortSignal } = {},
): Promise<ImageProbe | null> {
  const maxImageBytes = options.maxImageBytes ?? 8_000_000;
  try {
    const { response, finalUrl } = await fetchPublicResponse(rawUrl, {
      timeoutMs: options.timeoutMs ?? 10_000,
      maxDeclaredBytes: maxImageBytes,
      headers: {
        accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9',
        range: 'bytes=0-65535',
      },
      signal: options.signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const declaredType = normalizeContentType(response.headers.get('content-type'));
    if (!SAFE_IMAGE_MIMES.has(declaredType)) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const fullSize = parseContentRangeTotal(response.headers.get('content-range'))
      ?? parseContentLength(response.headers.get('content-length'));
    if (fullSize && fullSize > maxImageBytes) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const head = await readHeadBytes(response, 65_536);
    const sniffedType = sniffRasterImageMime(head);
    if (!sniffedType || sniffedType !== normalizeImageMime(declaredType)) return null;
    return { contentType: sniffedType, finalUrl, declaredSize: fullSize };
  } catch {
    return null;
  }
}

export async function fetchPublicImage(
  rawUrl: string | URL,
  options: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<PublicImage> {
  const maxBytes = options.maxBytes ?? 8_000_000;
  const resource = await fetchPublicBytes(rawUrl, {
    timeoutMs: options.timeoutMs ?? 20_000,
    maxBytes,
    headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9' },
  });
  if (!SAFE_IMAGE_MIMES.has(resource.contentType)) throw new Error('远程资源不是受支持的图片');
  const sniffedType = sniffRasterImageMime(resource.bytes);
  if (!sniffedType || sniffedType !== normalizeImageMime(resource.contentType)) {
    throw new Error('图片内容与声明格式不一致');
  }
  return { ...resource, contentType: sniffedType };
}

export async function fetchMaterial(url: string, timeoutMs = 15_000): Promise<string | null> {
  try {
    const { html } = await fetchPublicHtml(url, { timeoutMs, maxBytes: 2_000_000 });
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 6000);
  } catch {
    return null;
  }
}

export interface GitHubRepositoryRef {
  owner: string;
  repo: string;
  url: string;
}

export function parseGitHubRepositoryUrl(rawUrl: string): GitHubRepositoryRef | null {
  try {
    const url = new URL(rawUrl);
    if (url.hostname.toLowerCase() !== 'github.com') return null;
    const [owner, rawRepo] = url.pathname.split('/').filter(Boolean);
    const repo = rawRepo?.replace(/\.git$/i, '');
    if (!owner || !repo || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;
    return { owner, repo, url: `https://github.com/${owner}/${repo}` };
  } catch {
    return null;
  }
}

export async function fetchGitHubRepositoryMaterial(rawUrl: string, timeoutMs = 15_000): Promise<string | null> {
  const ref = parseGitHubRepositoryUrl(rawUrl);
  if (!ref) return null;
  let metadata: {
    full_name?: string;
    description?: string | null;
    language?: string | null;
    stargazers_count?: number;
    forks_count?: number;
    open_issues_count?: number;
    topics?: string[];
    updated_at?: string;
    license?: { spdx_id?: string | null } | null;
  } = {};
  try {
    const metadataResource = await fetchPublicBytes(`https://api.github.com/repos/${ref.owner}/${ref.repo}`, {
      timeoutMs,
      maxBytes: 500_000,
      headers: { accept: 'application/vnd.github+json' },
    });
    metadata = JSON.parse(new TextDecoder().decode(metadataResource.bytes)) as typeof metadata;
  } catch {
    // Unauthenticated GitHub API limits are low; README fetching below remains available.
  }
  let readme = '';
  for (const filename of ['README.md', 'readme.md', 'README.rst']) {
    try {
      const resource = await fetchPublicBytes(
        `https://github.com/${ref.owner}/${ref.repo}/raw/HEAD/${filename}`,
        { timeoutMs, maxBytes: 1_500_000, headers: { accept: 'text/plain' } },
      );
      readme = new TextDecoder().decode(resource.bytes).trim().slice(0, 14_000);
      if (readme) break;
    } catch {
      // Repositories are not required to use a specific README filename.
    }
  }
  if (readme || Object.keys(metadata).length) {
    const facts = [
      `仓库：${metadata.full_name || `${ref.owner}/${ref.repo}`}`,
      metadata.description ? `简介：${metadata.description}` : null,
      metadata.language ? `主要语言：${metadata.language}` : null,
      typeof metadata.stargazers_count === 'number' ? `Stars：${metadata.stargazers_count}` : null,
      typeof metadata.forks_count === 'number' ? `Forks：${metadata.forks_count}` : null,
      typeof metadata.open_issues_count === 'number' ? `Open issues：${metadata.open_issues_count}` : null,
      metadata.license?.spdx_id ? `许可证：${metadata.license.spdx_id}` : null,
      metadata.updated_at ? `最近更新：${metadata.updated_at}` : null,
      metadata.topics?.length ? `Topics：${metadata.topics.join(', ')}` : null,
    ].filter(Boolean);
    return [`GitHub URL：${ref.url}`, ...facts, readme ? `\nREADME\n${readme}` : ''].filter(Boolean).join('\n');
  }
  return fetchMaterial(ref.url, timeoutMs);
}

export async function assertPublicUrl(url: URL): Promise<void> {
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只支持 HTTP/HTTPS 链接');
  if (url.username || url.password) throw new Error('链接不能包含账号信息');
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.local')) {
    throw new Error('不允许读取本地网络地址');
  }
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('不允许读取内网或保留地址');
  }
}

export function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0];
  // IPv4-mapped IPv6（::ffff:1.2.3.4）归一化为 IPv4 再校验，避免绕过 IPv4 blocklist。
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const target = mapped ? mapped[1] : normalized;
  const family = isIP(target);
  if (family === 4) return blockedAddresses.check(target, 'ipv4');
  if (family === 6) return blockedAddresses.check(target, 'ipv6');
  return true;
}

export function sniffRasterImageMime(bytes: Uint8Array): SafeImageMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG') return 'image/png';
  if (bytes.length >= 6 && (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a')) return 'image/gif';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp';
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
  }
  return null;
}

async function readLimitedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error('远程资源体积超过限制');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return concatBytes(chunks, length);
}

async function readHeadBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (length < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const remaining = maxBytes - length;
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
      chunks.push(chunk);
      length += chunk.byteLength;
      if (sniffRasterImageMime(concatBytes(chunks, length))) break;
    }
    await reader.cancel().catch(() => undefined);
  } finally {
    reader.releaseLock();
  }
  return concatBytes(chunks, length);
}

function parsePublicUrl(rawUrl: string | URL): URL {
  const value = rawUrl instanceof URL ? new URL(rawUrl.href) : new URL(rawUrl);
  if (value.href.length > 4096) throw new Error('链接过长');
  value.hash = '';
  return value;
}

function normalizeContentType(value: string | null): string {
  return (value ?? '').split(';', 1)[0].trim().toLowerCase();
}

function normalizeImageMime(value: string): SafeImageMime | null {
  if (value === 'image/jpg') return 'image/jpeg';
  return SAFE_IMAGE_MIMES.has(value) ? value as SafeImageMime : null;
}

function parseContentLength(value: string | null): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseContentRangeTotal(value: string | null): number | undefined {
  const match = value?.match(/\/([0-9]+)$/);
  return match ? parseContentLength(match[1]) : undefined;
}

function concatBytes(chunks: Uint8Array[], length: number): Uint8Array {
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}
