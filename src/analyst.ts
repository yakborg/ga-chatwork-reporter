// GA4 analyst — データ取得・集計のみ。コメント生成・文章化は行わない。

const DEFAULT_PROPERTY_ID = "properties/314959805";
const SA_KEY_PATH = `${Deno.env.get("HOME") ?? "/root"}/.secrets/gcp/ga4-mcp-key.json`;

// ---- 型定義 ----

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

export interface PeriodResolved {
  label: string;
  start_date: string;
  end_date: string;
}

interface GA4Row {
  dimensionValues: { value: string }[];
  metricValues: { value: string }[];
}

interface GA4ReportResponse {
  rows?: GA4Row[];
}

export interface BreakdownRow {
  value: string;
  [metric: string]: string | number;
}

export interface BreakdownItem {
  dimension: string;
  rows: BreakdownRow[];
}

export interface AnalystOutput {
  property_id: string;
  period: PeriodResolved;
  purpose: string;
  fetched_at: string;
  summary: Record<string, number>;
  breakdown: BreakdownItem[];
  errors: string[];
}

interface QueryConfig {
  metrics: string[];
  dimensions: string[];
}

// ---- JST 日付ユーティリティ ----

function getJSTComponents(): { year: number; month: number; day: number; dow: number } {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return {
    year: jst.getUTCFullYear(),
    month: jst.getUTCMonth(),
    day: jst.getUTCDate(),
    dow: jst.getUTCDay(),
  };
}

function addDays(year: number, month: number, day: number, delta: number): string {
  return new Date(Date.UTC(year, month, day + delta)).toISOString().slice(0, 10);
}

function resolvePeriod(period: string): PeriodResolved {
  const { year, month, day, dow } = getJSTComponents();

  switch (period) {
    case "yesterday": {
      const s = addDays(year, month, day, -1);
      return { label: "yesterday", start_date: s, end_date: s };
    }
    case "last_7_days":
      return {
        label: "last_7_days",
        start_date: addDays(year, month, day, -7),
        end_date: addDays(year, month, day, -1),
      };
    case "last_week": {
      // 先週月〜日（日本式: 月曜始まり）
      const daysSinceMon = (dow + 6) % 7;
      return {
        label: "last_week",
        start_date: addDays(year, month, day, -(daysSinceMon + 7)),
        end_date: addDays(year, month, day, -(daysSinceMon + 1)),
      };
    }
    case "last_30_days":
      return {
        label: "last_30_days",
        start_date: addDays(year, month, day, -30),
        end_date: addDays(year, month, day, -1),
      };
    case "last_month": {
      const firstOfThisMonth = new Date(Date.UTC(year, month, 1));
      const lastOfLastMonth = new Date(Date.UTC(firstOfThisMonth.getUTCFullYear(), firstOfThisMonth.getUTCMonth(), 0));
      const firstOfLastMonth = new Date(Date.UTC(lastOfLastMonth.getUTCFullYear(), lastOfLastMonth.getUTCMonth(), 1));
      return {
        label: "last_month",
        start_date: firstOfLastMonth.toISOString().slice(0, 10),
        end_date: lastOfLastMonth.toISOString().slice(0, 10),
      };
    }
    default: {
      // YYYY-MM-DD/YYYY-MM-DD
      const [start_date, end_date] = period.split("/");
      return { label: period, start_date, end_date };
    }
  }
}

// ---- purpose → メトリクス/ディメンション選択 ----

function selectQueryConfig(purpose: string): QueryConfig {
  if (purpose.includes("チャネル")) {
    return {
      metrics: ["sessions", "conversions", "sessionConversionRate"],
      dimensions: ["sessionDefaultChannelGroup"],
    };
  }
  // ランディング・着地ページは "ページ" より先に評価する
  if (purpose.includes("ランディング") || purpose.includes("着地ページ")) {
    return {
      metrics: ["sessions", "conversions", "sessionConversionRate", "bounceRate"],
      dimensions: ["landingPage"],
    };
  }
  if (purpose.includes("ページ")) {
    return {
      metrics: ["screenPageViews", "averageSessionDuration", "bounceRate"],
      dimensions: ["pagePath"],
    };
  }
  if (purpose.includes("デバイス")) {
    return {
      metrics: ["sessions", "conversions"],
      dimensions: ["deviceCategory"],
    };
  }
  if (purpose.includes("流入") || purpose.includes("参照元") || purpose.includes("ソース")) {
    return {
      metrics: ["sessions", "newUsers", "conversions"],
      dimensions: ["sessionSourceMedium"],
    };
  }
  // デフォルト: 概況・サマリー
  return {
    metrics: ["sessions", "totalUsers", "newUsers", "conversions", "sessionConversionRate"],
    dimensions: [],
  };
}

// ---- Google OAuth2（サービスアカウント JWT） ----

async function getAccessToken(): Promise<string> {
  const keyJson = Deno.env.get("GA4_SA_KEY_JSON");
  const sa: ServiceAccount = keyJson
    ? JSON.parse(keyJson)
    : JSON.parse(await Deno.readTextFile(SA_KEY_PATH));

  const now = Math.floor(Date.now() / 1000);
  const b64url = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const header = b64url({ alg: "RS256", typ: "JWT" });
  const claims = b64url({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  });

  const signingInput = `${header}.${claims}`;

  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\n/g, "");
  const keyBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const sigBytes = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBytes)))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const jwt = `${signingInput}.${sig}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!tokenRes.ok) {
    throw new Error(`OAuth2 token error: ${tokenRes.status} ${await tokenRes.text()}`);
  }

  const { access_token } = await tokenRes.json();
  return access_token;
}

// ---- GA4 Data API ----

function buildOrderBys(metrics: string[]): Record<string, unknown>[] {
  const priority = ["conversions", "sessions", "screenPageViews", "totalUsers"];
  return priority
    .filter((m) => metrics.includes(m))
    .map((m) => ({ metric: { metricName: m }, desc: true }));
}

async function runReport(
  accessToken: string,
  propertyId: string,
  startDate: string,
  endDate: string,
  metrics: string[],
  dimensions: string[],
): Promise<GA4ReportResponse> {
  const url = `https://analyticsdata.googleapis.com/v1beta/${propertyId}:runReport`;

  const body: Record<string, unknown> = {
    dateRanges: [{ startDate, endDate }],
    metrics: metrics.map((m) => ({ name: m })),
    limit: 10,
  };
  if (dimensions.length > 0) {
    body.dimensions = dimensions.map((d) => ({ name: d }));
    const orderBys = buildOrderBys(metrics);
    if (orderBys.length > 0) body.orderBys = orderBys;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`GA4 API error: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

// ---- レスポンス変換 ----

function parseSummary(res: GA4ReportResponse, metrics: string[]): Record<string, number> {
  const result: Record<string, number> = Object.fromEntries(metrics.map((m) => [m, 0]));
  const row = res.rows?.[0];
  if (row) {
    for (let i = 0; i < metrics.length; i++) {
      result[metrics[i]] = parseFloat(row.metricValues[i]?.value ?? "0");
    }
  }
  return result;
}

function parseBreakdown(
  res: GA4ReportResponse,
  metrics: string[],
  dimension: string,
): BreakdownItem {
  const rows: BreakdownRow[] = (res.rows ?? []).map((row) => {
    const entry: BreakdownRow = { value: row.dimensionValues[0]?.value ?? "(not set)" };
    for (let i = 0; i < metrics.length; i++) {
      entry[metrics[i]] = parseFloat(row.metricValues[i]?.value ?? "0");
    }
    return entry;
  });
  return { dimension, rows };
}

// ---- エクスポート関数 ----

export async function runAnalyst(
  purpose: string,
  period: string,
  propertyId = DEFAULT_PROPERTY_ID,
  extraMetrics: string[] = [],
): Promise<AnalystOutput> {
  const errors: string[] = [];
  const resolvedPeriod = resolvePeriod(period);
  const base = selectQueryConfig(purpose);
  const metrics = extraMetrics.length > 0
    ? [...new Set([...base.metrics, ...extraMetrics])]
    : base.metrics;
  const { dimensions } = base;

  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const fetchedAt = jstNow.toISOString().replace("Z", "+09:00");

  let summary: Record<string, number> = Object.fromEntries(metrics.map((m) => [m, 0]));
  let breakdown: BreakdownItem[] = [];

  try {
    const accessToken = await getAccessToken();

    const summaryRes = await runReport(
      accessToken,
      propertyId,
      resolvedPeriod.start_date,
      resolvedPeriod.end_date,
      metrics,
      [],
    );
    summary = parseSummary(summaryRes, metrics);

    if (dimensions.length > 0) {
      const breakdownRes = await runReport(
        accessToken,
        propertyId,
        resolvedPeriod.start_date,
        resolvedPeriod.end_date,
        metrics,
        dimensions,
      );
      breakdown = [parseBreakdown(breakdownRes, metrics, dimensions[0])];
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }

  return {
    property_id: propertyId,
    period: resolvedPeriod,
    purpose,
    fetched_at: fetchedAt,
    summary,
    breakdown,
    errors,
  };
}

// ---- CLI エントリーポイント ----

async function main() {
  const [purpose, period, propertyId] = Deno.args;
  if (!purpose || !period) {
    console.error('Usage: deno run ... src/analyst.ts "<purpose>" "<period>" [propertyId]');
    Deno.exit(1);
  }
  const output = await runAnalyst(purpose, period, propertyId);
  console.log(JSON.stringify(output, null, 2));
}

if (import.meta.main) main();
