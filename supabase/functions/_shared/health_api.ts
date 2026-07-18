import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.2";
import { healthSource, healthUserId, syncWindowDays } from "./env.ts";
import { expiresAtFromNow, refreshAccessToken } from "./google_oauth.ts";

type HealthTokenRow = {
  user_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string;
  oauth_scope: string;
};

type MetricRow = {
  user_id: string;
  data_type: string;
  value: Record<string, unknown>;
  recorded_at: string;
  synced_at: string;
  source: string;
};

type DataTypeConfig = {
  dataType: string;
  method: "list" | "rollUp" | "dailyRollUp";
  maxWindowDays?: number;
  filter?: (start: Date, end: Date) => string;
  body?: (start: Date, end: Date) => Record<string, unknown>;
};

const GOOGLE_HEALTH_BASE_URL = "https://health.googleapis.com/v4";

const DATA_TYPES: DataTypeConfig[] = [
  {
    dataType: "steps",
    method: "rollUp",
    body: physicalRollupBody("1800s"),
  },
  {
    dataType: "sleep",
    method: "list",
    filter: (start, end) =>
      `sleep.interval.end_time >= "${start.toISOString()}" AND sleep.interval.end_time < "${end.toISOString()}"`,
  },
  {
    dataType: "heart-rate",
    method: "rollUp",
    maxWindowDays: 14,
    body: physicalRollupBody("1800s"),
  },
  {
    dataType: "daily-heart-rate-variability",
    method: "list",
  },
  {
    dataType: "daily-resting-heart-rate",
    method: "list",
  },
  {
    dataType: "active-zone-minutes",
    method: "rollUp",
    body: physicalRollupBody("1800s"),
  },
  {
    dataType: "weight",
    method: "list",
    filter: (start, end) =>
      `weight.sample_time.physical_time >= "${start.toISOString()}" AND weight.sample_time.physical_time < "${end.toISOString()}"`,
  },
];

function physicalRollupBody(windowSize: string) {
  return (start: Date, end: Date) => ({
    range: {
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    },
    windowSize,
    pageSize: pageSizeForWindow(start, end, windowSize),
    dataSourceFamily: "users/me/dataSourceFamilies/all-sources",
  });
}

function civilRollupBody(start: Date, end: Date): Record<string, unknown> {
  return {
    range: {
      start: civilDateTime(start),
      end: civilDateTime(end),
    },
    windowSizeDays: 1,
    pageSize: Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000))),
    dataSourceFamily: "users/me/dataSourceFamilies/all-sources",
  };
}

function pageSizeForWindow(start: Date, end: Date, windowSize: string): number {
  const match = windowSize.match(/^(\d+)s$/);
  const windowSeconds = match ? Number(match[1]) : 1800;
  const durationSeconds = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 1000));
  return Math.max(1, Math.ceil(durationSeconds / windowSeconds));
}

function civilDateTime(date: Date): Record<string, Record<string, number>> {
  return {
    date: {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    },
  };
}

export async function getUsableToken(supabase: SupabaseClient): Promise<HealthTokenRow> {
  const userId = healthUserId();
  const { data, error } = await supabase
    .from("health_tokens")
    .select("user_id, access_token, refresh_token, expires_at, oauth_scope")
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    throw new Error(`No health token found for HEALTH_USER_ID=${userId}: ${error?.message || "missing row"}`);
  }

  const token = data as HealthTokenRow;
  const refreshAt = new Date(Date.now() + 5 * 60 * 1000);
  if (new Date(token.expires_at) > refreshAt) {
    return token;
  }

  if (!token.refresh_token) {
    throw new Error("Access token is expiring and no refresh token is stored");
  }

  const refreshed = await refreshAccessToken(token.refresh_token);
  const updated: Partial<HealthTokenRow> = {
    access_token: refreshed.access_token,
    expires_at: expiresAtFromNow(refreshed.expires_in),
    oauth_scope: refreshed.scope || token.oauth_scope,
  };

  if (refreshed.refresh_token) {
    updated.refresh_token = refreshed.refresh_token;
  }

  const { data: refreshedRow, error: updateError } = await supabase
    .from("health_tokens")
    .update(updated)
    .eq("user_id", userId)
    .select("user_id, access_token, refresh_token, expires_at, oauth_scope")
    .single();

  if (updateError || !refreshedRow) {
    throw new Error(`Failed to update refreshed token: ${updateError?.message || "missing row"}`);
  }

  return refreshedRow as HealthTokenRow;
}

export async function syncHealthData(supabase: SupabaseClient, token: HealthTokenRow): Promise<number> {
  const end = new Date();
  const requestedWindowDays = syncWindowDays();
  let recordsSynced = 0;

  for (const config of DATA_TYPES) {
    const windowDays = Math.min(requestedWindowDays, config.maxWindowDays || 90);
    const start = new Date(end.getTime() - windowDays * 24 * 60 * 60 * 1000);
    const records = await fetchDataType(config, token.access_token, start, end);
    const rows = records
      .map((value) => toMetricRow(config.dataType, value))
      .filter((row): row is MetricRow => row !== null);

    if (rows.length === 0) {
      continue;
    }

    const { error } = await supabase
      .from("health_metrics")
      .upsert(rows, {
        onConflict: "user_id,data_type,recorded_at,source",
      });

    if (error) {
      throw new Error(`Failed to upsert ${config.dataType}: ${error.message}`);
    }

    recordsSynced += rows.length;
  }

  return recordsSynced;
}

async function fetchDataType(
  config: DataTypeConfig,
  accessToken: string,
  start: Date,
  end: Date,
): Promise<Record<string, unknown>[]> {
  const parent = `users/me/dataTypes/${config.dataType}`;

  if (config.method === "list") {
    const params = new URLSearchParams({ pageSize: "10000" });
    if (config.filter) {
      params.set("filter", config.filter(start, end));
    }
    return fetchPagedList(`${GOOGLE_HEALTH_BASE_URL}/${parent}/dataPoints?${params.toString()}`, accessToken);
  }

  const verb = config.method === "rollUp" ? "rollUp" : "dailyRollUp";
  const body = config.body?.(start, end) || {};
  return fetchPagedPost(`${GOOGLE_HEALTH_BASE_URL}/${parent}/dataPoints:${verb}`, accessToken, body);
}

async function fetchPagedList(url: string, accessToken: string): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let nextPageToken: string | undefined;

  do {
    const pagedUrl = new URL(url);
    if (nextPageToken) {
      pagedUrl.searchParams.set("pageToken", nextPageToken);
    }

    const body = await healthFetch(pagedUrl.toString(), accessToken);
    results.push(...((body.dataPoints as Record<string, unknown>[] | undefined) || []));
    nextPageToken = body.nextPageToken as string | undefined;
  } while (nextPageToken);

  return results;
}

async function fetchPagedPost(
  url: string,
  accessToken: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let nextPageToken: string | undefined;

  do {
    const requestBody = nextPageToken ? { ...body, pageToken: nextPageToken } : body;
    const responseBody = await healthFetch(url, accessToken, requestBody);
    results.push(...((responseBody.rollupDataPoints as Record<string, unknown>[] | undefined) || []));
    nextPageToken = responseBody.nextPageToken as string | undefined;
  } while (nextPageToken);

  return results;
}

async function healthFetch(
  url: string,
  accessToken: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Google Health API failed (${response.status}) for ${url}: ${JSON.stringify(responseBody)}`);
  }

  return responseBody as Record<string, unknown>;
}

function toMetricRow(dataType: string, value: Record<string, unknown>): MetricRow | null {
  const recordedAt = extractRecordedAt(value);
  if (!recordedAt) {
    console.warn(`Skipping ${dataType} row without a recognizable timestamp`, value);
    return null;
  }

  return {
    user_id: healthUserId(),
    data_type: dataType,
    value,
    recorded_at: recordedAt,
    synced_at: new Date().toISOString(),
    source: healthSource(),
  };
}

function extractRecordedAt(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const object = value as Record<string, unknown>;
  for (const key of ["startTime", "physicalTime", "endTime"]) {
    const candidate = object[key];
    if (typeof candidate === "string" && isValidDate(candidate)) {
      return new Date(candidate).toISOString();
    }
  }

  for (const key of ["civilStartTime", "civilEndTime", "date"]) {
    const candidate = object[key];
    const parsed = parseCivilDate(candidate);
    if (parsed) {
      return parsed;
    }
  }

  for (const nested of Object.values(object)) {
    if (Array.isArray(nested)) {
      continue;
    }
    const parsed = extractRecordedAt(nested);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function parseCivilDate(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const object = value as Record<string, unknown>;
  const dateObject = object.date && typeof object.date === "object"
    ? object.date as Record<string, unknown>
    : object;
  const timeObject = object.time && typeof object.time === "object"
    ? object.time as Record<string, unknown>
    : object;

  const year = Number(dateObject.year);
  const month = Number(dateObject.month);
  const day = Number(dateObject.day);
  const hours = Number(timeObject.hours || 0);
  const minutes = Number(timeObject.minutes || 0);
  const seconds = Number(timeObject.seconds || 0);

  if (!year || !month || !day) {
    return null;
  }

  return new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds)).toISOString();
}

function isValidDate(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime());
}
