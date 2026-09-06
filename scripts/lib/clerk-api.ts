/**
 * The smallest possible Clerk Backend API client, for the instance-migration
 * scripts. Raw `fetch` rather than `@clerk/backend`: the scripts talk to TWO
 * instances at once with two different keys, need nothing but list/create/
 * update, and must not drift with whatever SDK version `@clerk/nextjs` pins.
 */

const BASE = "https://api.clerk.com/v1";

export class ClerkApiError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly body: string,
  ) {
    super(`${method} ${path} → ${status}: ${body.slice(0, 400)}`);
  }
}

type Query = Record<string, string | number | undefined>;

export class ClerkApi {
  constructor(private readonly secretKey: string) {}

  async request<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    options: { query?: Query; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(`${BASE}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    // Clerk rate-limits per instance (tighter on development ones); a 429
    // carries Retry-After, and a short pause is the only sensible answer.
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          "Content-Type": "application/json",
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      if (res.status === 429 && attempt < 8) {
        const wait = Number(res.headers.get("retry-after") ?? "2") * 1000;
        await new Promise((r) => setTimeout(r, Math.min(Math.max(wait, 500), 30_000)));
        continue;
      }
      const textBody = await res.text();
      if (!res.ok) throw new ClerkApiError(res.status, method, path, textBody);
      return (textBody ? JSON.parse(textBody) : null) as T;
    }
  }

  /**
   * Offset pagination over either response shape Clerk uses: a bare array
   * (`/users`) or `{ data, total_count }` (organizations, memberships,
   * invitations).
   */
  async list<T>(path: string, query: Query = {}, pageSize = 100): Promise<T[]> {
    const all: T[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const page = await this.request<T[] | { data: T[] }>("GET", path, {
        query: { ...query, limit: pageSize, offset },
      });
      const items = Array.isArray(page) ? page : (page?.data ?? []);
      all.push(...items);
      if (items.length < pageSize) return all;
    }
  }

  /** 404 → null, for "does this already exist" lookups. */
  async find<T>(path: string, query?: Query): Promise<T | null> {
    try {
      return await this.request<T>("GET", path, { query });
    } catch (err) {
      if (err instanceof ClerkApiError && err.status === 404) return null;
      throw err;
    }
  }
}
