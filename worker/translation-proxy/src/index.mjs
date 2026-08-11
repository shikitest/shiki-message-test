const MAX_TEXT_LENGTH = 1500;
const MAX_BODY_LENGTH = 10000;
const REQUEST_TIMEOUT_MS = 10000;
const DEFAULT_RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60000;
const DEFAULT_ORIGINS = [
    "https://shikikii.github.io",
    "http://localhost:8000",
    "http://127.0.0.1:8000"
];
const memoryRateLimits = new Map();

function allowedOrigins(env) {
    const configured = String(env.ALLOWED_ORIGINS || "")
        .split(",")
        .map(value => value.trim())
        .filter(Boolean);
    return new Set(configured.length ? configured : DEFAULT_ORIGINS);
}

function corsHeaders(origin) {
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin"
    };
}

function jsonResponse(status, body, origin) {
    const headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
    };
    if (origin) Object.assign(headers, corsHeaders(origin));
    return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(status, code, message, origin, upstreamStatus) {
    const error = { code, message };
    if (Number.isInteger(upstreamStatus)) {
        error.upstreamStatus = upstreamStatus;
    }
    return jsonResponse(status, { error }, origin);
}

function normalizeLanguage(language) {
    const lower = String(language || "").trim().toLowerCase();
    if (["zh", "zh-cn", "zh-hans"].includes(lower)) return "zh";
    if (["ja", "ja-jp"].includes(lower)) return "ja";
    return lower;
}

function validPair(sourceLanguage, targetLanguage) {
    return (
        sourceLanguage === "ja" && targetLanguage === "zh"
    ) || (
        sourceLanguage === "zh" && targetLanguage === "ja"
    );
}

function memoryRateAllowed(key, limit, now) {
    if (memoryRateLimits.size > 5000) {
        for (const [storedKey, value] of memoryRateLimits) {
            if (now - value.startedAt >= RATE_WINDOW_MS) {
                memoryRateLimits.delete(storedKey);
            }
        }
    }
    const current = memoryRateLimits.get(key);
    if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
        memoryRateLimits.set(key, { count: 1, startedAt: now });
        return true;
    }
    current.count++;
    return current.count <= limit;
}

async function rateAllowed(request, env, origin) {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const key = origin + "|" + ip;
    if (
        env.TRANSLATION_RATE_LIMITER &&
        typeof env.TRANSLATION_RATE_LIMITER.limit === "function"
    ) {
        const result = await env.TRANSLATION_RATE_LIMITER.limit({ key });
        return result.success === true;
    }
    const configured = Number(env.RATE_LIMIT_MAX);
    const limit = Number.isFinite(configured) && configured > 0 ?
        Math.floor(configured) : DEFAULT_RATE_LIMIT;
    return memoryRateAllowed(key, limit, Date.now());
}

function deeplEndpoint(env) {
    return String(env.DEEPL_API_PLAN || "free").toLowerCase() === "pro" ?
        "https://api.deepl.com/v2/translate" :
        "https://api-free.deepl.com/v2/translate";
}

async function callDeepL(payload, env, fetchImpl) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    try {
        response = await fetchImpl(deeplEndpoint(env), {
            method: "POST",
            headers: {
                "Authorization": "DeepL-Auth-Key " + env.DEEPL_API_KEY,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                text: [payload.text],
                source_lang: payload.sourceLanguage.toUpperCase(),
                target_lang: payload.targetLanguage.toUpperCase()
            }),
            signal: controller.signal
        });
    } catch (error) {
        if (error && error.name === "AbortError") {
            return { error: [504, "DEEPL_TIMEOUT", "Translation timed out"] };
        }
        return {
            error: [502, "DEEPL_UNAVAILABLE", "Translation service unavailable"]
        };
    } finally {
        clearTimeout(timeout);
    }

    if (!response.ok) {
        const upstreamStatus = response.status;
        let upstreamBody = "";
        try {
            upstreamBody = await response.text();
        } catch (error) {
            upstreamBody = "[unavailable]";
        }
        const redactedValues = [env.DEEPL_API_KEY, payload.text]
            .map(value => String(value || ""))
            .filter(Boolean);
        const safeUpstreamBody = redactedValues.reduce(
            (body, value) => body.split(value).join("[REDACTED]"),
            upstreamBody
        ).replace(
            /DeepL-Auth-Key\s+[^\s"']+/gi,
            "DeepL-Auth-Key [REDACTED]"
        );
        console.error("DeepL status:", upstreamStatus);
        console.error("DeepL response body:", safeUpstreamBody);

        if (response.status === 429) {
            return { error: [429, "DEEPL_RATE_LIMITED", "Translation rate limited"] };
        }
        if (response.status === 456) {
            return { error: [503, "DEEPL_QUOTA_EXCEEDED", "Translation quota exceeded"] };
        }
        if (response.status >= 500) {
            return {
                error: [502, "DEEPL_UNAVAILABLE", "Translation service unavailable"]
            };
        }
        return {
            error: [
                502,
                "DEEPL_REJECTED",
                "Translation request rejected",
                upstreamStatus
            ]
        };
    }

    let data;
    try {
        data = await response.json();
    } catch (error) {
        return {
            error: [502, "DEEPL_INVALID_RESPONSE", "Invalid translation response"]
        };
    }
    const text = data && data.translations &&
        data.translations[0] && data.translations[0].text;
    if (typeof text !== "string" || !text.trim()) {
        return {
            error: [502, "DEEPL_INVALID_RESPONSE", "Invalid translation response"]
        };
    }
    return { text: text.trim() };
}

export async function handleRequest(request, env, fetchImpl = fetch) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const originAllowed = allowedOrigins(env).has(origin);

    if (url.pathname !== "/translate") {
        return errorResponse(404, "NOT_FOUND", "Not found", null);
    }
    if (!originAllowed) {
        return errorResponse(403, "ORIGIN_DENIED", "Origin not allowed", null);
    }
    if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== "POST") {
        return errorResponse(405, "METHOD_NOT_ALLOWED", "POST required", origin);
    }
    if (!env.DEEPL_API_KEY) {
        return errorResponse(
            503,
            "DEEPL_NOT_CONFIGURED",
            "Translation service not configured",
            origin
        );
    }
    if (!(await rateAllowed(request, env, origin))) {
        return errorResponse(429, "PROXY_RATE_LIMITED", "Too many requests", origin);
    }

    let rawBody;
    try {
        rawBody = await request.text();
    } catch (error) {
        return errorResponse(400, "INVALID_BODY", "Invalid request body", origin);
    }
    if (rawBody.length > MAX_BODY_LENGTH) {
        return errorResponse(413, "BODY_TOO_LARGE", "Request body too large", origin);
    }

    let body;
    try {
        body = JSON.parse(rawBody);
    } catch (error) {
        return errorResponse(400, "INVALID_JSON", "Invalid JSON", origin);
    }
    const text = typeof body.text === "string" ? body.text : "";
    if (!text.trim()) {
        return errorResponse(400, "EMPTY_TEXT", "Text is required", origin);
    }
    if (Array.from(text).length > MAX_TEXT_LENGTH) {
        return errorResponse(413, "TEXT_TOO_LONG", "Text is too long", origin);
    }
    const sourceLanguage = normalizeLanguage(body.sourceLanguage);
    const targetLanguage = normalizeLanguage(body.targetLanguage);
    if (!validPair(sourceLanguage, targetLanguage)) {
        return errorResponse(
            400,
            "LANGUAGE_PAIR_NOT_ALLOWED",
            "Only ja↔zh is supported",
            origin
        );
    }

    const result = await callDeepL({
        text,
        sourceLanguage,
        targetLanguage
    }, env, fetchImpl);
    if (result.error) {
        return errorResponse(
            result.error[0],
            result.error[1],
            result.error[2],
            origin,
            result.error[3]
        );
    }
    return jsonResponse(200, { text: result.text }, origin);
}

export function resetMemoryRateLimitsForTest() {
    memoryRateLimits.clear();
}

export default {
    fetch(request, env) {
        return handleRequest(request, env);
    }
};
