import { GOOGLE_HEALTH_SCOPES, requiredEnv } from "./env.ts";

export type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
  token_type: string;
};

const TOKEN_URL = "https://oauth2.googleapis.com/token";

async function postTokenRequest(params: URLSearchParams): Promise<GoogleTokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Google token request failed (${response.status}): ${JSON.stringify(body)}`);
  }

  return body as GoogleTokenResponse;
}

export function expiresAtFromNow(expiresInSeconds: number): string {
  return new Date(Date.now() + expiresInSeconds * 1000).toISOString();
}

export async function exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse> {
  return postTokenRequest(new URLSearchParams({
    client_id: requiredEnv("GOOGLE_CLIENT_ID"),
    client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
    code,
    grant_type: "authorization_code",
    redirect_uri: requiredEnv("GOOGLE_REDIRECT_URI"),
  }));
}

export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
  return postTokenRequest(new URLSearchParams({
    client_id: requiredEnv("GOOGLE_CLIENT_ID"),
    client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  }));
}

export function requestedScopeString(): string {
  return GOOGLE_HEALTH_SCOPES.join(" ");
}

