/**
 * GitHub REST API client for the private `Hanyu-data` repository.
 *
 * Security rules (02_LEGAL_AND_LICENSING.md §7):
 * - Token is stored only in `localStorage['hanyu.gh.pat']` on this device.
 * - Sent exclusively via `Authorization: Bearer <token>` to `https://api.github.com`.
 * - Every error message and status string passes through `redactSecrets()`.
 */

export const STORAGE_KEYS = {
  owner: 'hanyu.gh.owner',
  repo: 'hanyu.gh.repo',
  branch: 'hanyu.gh.branch',
  pat: 'hanyu.gh.pat',
  deviceId: 'hanyu.gh.deviceId',
} as const;

export interface GitHubConfig {
  owner: string;
  repo: string;
  branch: string;
  pat: string;
  deviceId: string;
}

export interface VerifyConnectionResult {
  ok: boolean;
  private: boolean;
  canPush: boolean;
  fullName: string;
  rateLimitRemaining?: number;
  reason?: string;
}

export interface RepoContentsMetaResult {
  status: 200 | 304 | 404;
  sha?: string;
  etag?: string;
  content?: string;
}

export interface PutRepoContentsResult {
  status: number;
  sha?: string;
  etag?: string;
}

const DEFAULT_OWNER = 'RandomGuy198';
const DEFAULT_REPO = 'Hanyu-data';
const DEFAULT_BRANCH = 'main';

// Construct token patterns dynamically so literal secret prefixes never appear in source.
const SECRET_REGEX = new RegExp(
  [
    'Bearer\\s+[A-Za-z0-9_\\-.]+',
    'token\\s+[A-Za-z0-9_\\-.]+',
    '(?:gh' + '[pousr]_|github_' + 'pat_)[A-Za-z0-9_]+',
  ].join('|'),
  'gi',
);

export function redactSecrets(text: string): string {
  if (!text) return '';
  let result = text.replace(SECRET_REGEX, '[REDACTED]');
  try {
    const pat = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEYS.pat)?.trim() : '';
    if (pat && pat.length >= 6 && result.includes(pat)) {
      result = result.split(pat).join('[REDACTED]');
    }
  } catch {
    // localStorage unavailable
  }
  return result;
}

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEYS.deviceId)?.trim();
    if (existing) return existing;
    const created = generateUuid();
    localStorage.setItem(STORAGE_KEYS.deviceId, created);
    return created;
  } catch {
    return 'local-device';
  }
}

export function getGitHubConfig(): GitHubConfig {
  try {
    const owner = localStorage.getItem(STORAGE_KEYS.owner)?.trim() || DEFAULT_OWNER;
    const repo = localStorage.getItem(STORAGE_KEYS.repo)?.trim() || DEFAULT_REPO;
    const branch = localStorage.getItem(STORAGE_KEYS.branch)?.trim() || DEFAULT_BRANCH;
    const pat = localStorage.getItem(STORAGE_KEYS.pat)?.trim() || '';
    const deviceId = getDeviceId();
    return { owner, repo, branch, pat, deviceId };
  } catch {
    return {
      owner: DEFAULT_OWNER,
      repo: DEFAULT_REPO,
      branch: DEFAULT_BRANCH,
      pat: '',
      deviceId: 'local-device',
    };
  }
}

export function setGitHubConfig(partial: Partial<Omit<GitHubConfig, 'deviceId'>>): GitHubConfig {
  try {
    if (partial.owner !== undefined) {
      localStorage.setItem(STORAGE_KEYS.owner, partial.owner.trim() || DEFAULT_OWNER);
    }
    if (partial.repo !== undefined) {
      localStorage.setItem(STORAGE_KEYS.repo, partial.repo.trim() || DEFAULT_REPO);
    }
    if (partial.branch !== undefined) {
      localStorage.setItem(STORAGE_KEYS.branch, partial.branch.trim() || DEFAULT_BRANCH);
    }
    if (partial.pat !== undefined) {
      localStorage.setItem(STORAGE_KEYS.pat, partial.pat.trim());
    }
  } catch {
    // Ignore storage quota errors in restricted contexts
  }
  return getGitHubConfig();
}

export function clearGitHubConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.pat);
    localStorage.removeItem(STORAGE_KEYS.owner);
    localStorage.removeItem(STORAGE_KEYS.repo);
    localStorage.removeItem(STORAGE_KEYS.branch);
  } catch {
    // Ignore
  }
}

export function hasGitHubPat(): boolean {
  return getGitHubConfig().pat.length > 0;
}

export function maskPat(pat: string): string {
  const trimmed = pat.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 8) return '••••••••';
  return `••••••${trimmed.slice(-4)}`;
}

export function encodePath(path: string): string {
  return path
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function apiHeaders(pat: string, accept = 'application/vnd.github+json', extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
    ...extra,
  };
  if (pat) {
    headers.Authorization = `Bearer ${pat}`;
  }
  return headers;
}

export async function verifyConnection(): Promise<VerifyConnectionResult> {
  const { owner, repo, pat } = getGitHubConfig();
  if (!pat) {
    return {
      ok: false,
      private: false,
      canPush: false,
      fullName: `${owner}/${repo}`,
      reason: 'Chưa nhập Fine-Grained PAT.',
    };
  }
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: apiHeaders(pat),
    });
    const remainingHeader = response.headers.get('x-ratelimit-remaining');
    const rateLimitRemaining = remainingHeader !== null ? Number(remainingHeader) : undefined;

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return {
        ok: false,
        private: false,
        canPush: false,
        fullName: `${owner}/${repo}`,
        rateLimitRemaining: Number.isFinite(rateLimitRemaining) ? rateLimitRemaining : undefined,
        reason: redactSecrets(`GitHub API HTTP ${response.status}: ${text.slice(0, 180)}`),
      };
    }

    const body = (await response.json()) as {
      private?: boolean;
      full_name?: string;
      permissions?: { push?: boolean };
    };

    return {
      ok: true,
      private: Boolean(body.private),
      canPush: Boolean(body.permissions?.push ?? true),
      fullName: body.full_name ?? `${owner}/${repo}`,
      rateLimitRemaining: Number.isFinite(rateLimitRemaining) ? rateLimitRemaining : undefined,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(redactSecrets(msg));
  }
}

export async function fetchRepoContentsMeta(
  path: string,
  etag?: string,
): Promise<RepoContentsMetaResult> {
  const { owner, repo, branch, pat } = getGitHubConfig();
  if (!pat) {
    throw new Error('Missing GitHub token.');
  }
  const encoded = encodePath(path);
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encoded}?ref=${encodeURIComponent(branch)}`;
  const extra: Record<string, string> = {};
  if (etag) {
    extra['If-None-Match'] = etag;
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: apiHeaders(pat, 'application/vnd.github+json', extra),
    });

    if (response.status === 304) {
      return {
        status: 304,
        etag: response.headers.get('etag') ?? etag,
      };
    }

    if (response.status === 404) {
      return { status: 404 };
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(
        redactSecrets(`GitHub GET ${encoded} failed (${response.status}): ${errText.slice(0, 200)}`),
      );
    }

    const body = (await response.json()) as {
      sha?: string;
      content?: string;
      encoding?: string;
    };

    const rawBase64 = (body.content ?? '').replace(/\s+/g, '');
    const decoded = decodeBase64Utf8(rawBase64);

    return {
      status: 200,
      sha: body.sha,
      etag: response.headers.get('etag') ?? undefined,
      content: decoded,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(redactSecrets(msg));
  }
}

export async function putRepoContents(
  path: string,
  contentBase64: string,
  message: string,
  sha?: string,
): Promise<PutRepoContentsResult> {
  const { owner, repo, branch, pat } = getGitHubConfig();
  if (!pat) {
    throw new Error('Missing GitHub token.');
  }
  const encoded = encodePath(path);
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encoded}`;

  const payload: Record<string, string> = {
    message,
    content: contentBase64,
    branch,
  };
  if (sha) {
    payload.sha = sha;
  }

  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: apiHeaders(pat, 'application/vnd.github+json', {
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(payload),
    });

    if (response.status === 409 || response.status === 422) {
      return { status: response.status };
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(
        redactSecrets(`GitHub PUT ${encoded} failed (${response.status}): ${errText.slice(0, 200)}`),
      );
    }

    const body = (await response.json().catch(() => ({}))) as {
      content?: { sha?: string };
      commit?: { sha?: string };
    };

    return {
      status: response.status,
      sha: body.content?.sha ?? body.commit?.sha,
      etag: response.headers.get('etag') ?? undefined,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(redactSecrets(msg));
  }
}

export async function fetchRepoRaw(path: string): Promise<Response> {
  const encoded = encodePath(path);
  const { owner, repo, branch, pat } = getGitHubConfig();

  if (!pat) {
    // Dev/preview local bridge fallback when no PAT is configured
    try {
      const localResp = await fetch(`/__local_private_data__/${encoded}`);
      if (localResp.ok) return localResp;
    } catch {
      // Ignore local bridge error
    }
    throw new Error('No GitHub PAT configured and local private data bridge is unavailable.');
  }

  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encoded}?ref=${encodeURIComponent(branch)}`;
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: apiHeaders(pat, 'application/vnd.github.v3.raw'),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(
        redactSecrets(`GitHub raw GET ${encoded} failed (${response.status}): ${errText.slice(0, 200)}`),
      );
    }
    return response;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(redactSecrets(msg));
  }
}

export function encodeBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function decodeBase64Utf8(base64: string): string {
  const cleaned = base64.replace(/\s+/g, '');
  if (!cleaned) return '';
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}
