import { z } from "zod";

/**
 * The two reads this slice makes against Square's API, with the response
 * shapes Zod-validated at the boundary (S5) — a provider response is untrusted
 * input, however trusted the provider.
 *
 * **NO `Square-Version` HEADER, deliberately.** Square pins an application to
 * an API version in the Developer Console and honours it when the header is
 * absent; a hard-coded date here would have to be a real released version and
 * would fail every call the day it was not. The fields read below have been
 * stable across versions for years.
 */

export const SquareMerchantSchema = z.object({
  id: z.string().min(1),
  business_name: z.string().nullish(),
  country: z.string().nullish(),
  currency: z.string().nullish(),
  /** `ACTIVE` | `INACTIVE`. */
  status: z.string().nullish(),
  main_location_id: z.string().nullish(),
});
export type SquareMerchant = z.infer<typeof SquareMerchantSchema>;

export const SquareLocationSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullish(),
  /** `ACTIVE` | `INACTIVE`. */
  status: z.string().nullish(),
  /** `PHYSICAL` | `MOBILE` — a farm store versus a stall. */
  type: z.string().nullish(),
  /** `CREDIT_CARD_PROCESSING` is the one that means "this location can take a card". */
  capabilities: z.array(z.string()).nullish(),
  merchant_id: z.string().nullish(),
  currency: z.string().nullish(),
  country: z.string().nullish(),
  timezone: z.string().nullish(),
});
export type SquareLocation = z.infer<typeof SquareLocationSchema>;

export type SquareApiResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      status: number | null;
      code: string | null;
      message: string;
      /**
       * Square rejected the TOKEN, not the request. The fix is the owner
       * connecting again; nothing else in the app can do it.
       */
      tokenRejected: boolean;
    };

const TOKEN_REJECTED_CODES = new Set([
  "UNAUTHORIZED",
  "ACCESS_TOKEN_EXPIRED",
  "ACCESS_TOKEN_REVOKED",
  "INSUFFICIENT_SCOPES",
]);

const ErrorsSchema = z.object({
  errors: z
    .array(z.object({ code: z.string().optional(), detail: z.string().optional() }))
    .optional(),
});

export async function squareGet<T>(
  config: { baseUrl: string },
  accessToken: string,
  path: string,
  schema: z.ZodType<T>,
): Promise<SquareApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(new URL(path, config.baseUrl), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch {
    return {
      ok: false,
      status: null,
      code: null,
      message: "Couldn't reach Square.",
      tokenRejected: false,
    };
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const parsed = ErrorsSchema.safeParse(payload);
    const code = parsed.success ? (parsed.data.errors?.[0]?.code ?? null) : null;
    const detail = parsed.success ? (parsed.data.errors?.[0]?.detail ?? null) : null;
    return {
      ok: false,
      status: response.status,
      code,
      message: detail ?? `Square refused the request (${response.status}).`,
      tokenRejected:
        response.status === 401 ||
        (code !== null && TOKEN_REJECTED_CODES.has(code)),
    };
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      status: response.status,
      code: "UNEXPECTED_SHAPE",
      message: "Square's reply wasn't in the shape expected.",
      tokenRejected: false,
    };
  }
  return { ok: true, data: parsed.data };
}

/** `GET /v2/merchants/me` — the account the token acts for. MERCHANT_PROFILE_READ. */
export async function fetchSquareMerchant(
  config: { baseUrl: string },
  accessToken: string,
): Promise<SquareApiResult<SquareMerchant>> {
  const result = await squareGet(
    config,
    accessToken,
    "/v2/merchants/me",
    z.object({ merchant: SquareMerchantSchema }),
  );
  return result.ok ? { ok: true, data: result.data.merchant } : result;
}

/** `GET /v2/locations` — every location on the account, active or not. MERCHANT_PROFILE_READ. */
export async function fetchSquareLocations(
  config: { baseUrl: string },
  accessToken: string,
): Promise<SquareApiResult<SquareLocation[]>> {
  const result = await squareGet(
    config,
    accessToken,
    "/v2/locations",
    z.object({ locations: z.array(SquareLocationSchema).optional() }),
  );
  return result.ok ? { ok: true, data: result.data.locations ?? [] } : result;
}
