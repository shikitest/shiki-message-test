(function () {
    "use strict";

    const VERSION = "1.0.0";
    const PROVIDER_ID = "deepl-remote-fallback";
    const MAX_TEXT_LENGTH = 1500;
    const REQUEST_TIMEOUT_MS = 12000;
    const CACHE_TTL_MS = 5 * 60 * 1000;
    const CACHE_LIMIT = 100;
    const cache = new Map();
    const listeners = new Set();

    function normalizeLanguage(language) {
        const lower = String(language || "").trim().toLowerCase();
        if (["zh", "zh-cn", "zh-hans"].includes(lower)) return "zh";
        if (["ja", "ja-jp"].includes(lower)) return "ja";
        return lower;
    }

    function pair(sourceLanguage, targetLanguage) {
        return {
            sourceLanguage: normalizeLanguage(sourceLanguage),
            targetLanguage: normalizeLanguage(targetLanguage)
        };
    }

    function allowedPair(options) {
        return (
            options.sourceLanguage === "ja" &&
            options.targetLanguage === "zh"
        ) || (
            options.sourceLanguage === "zh" &&
            options.targetLanguage === "ja"
        );
    }

    function proxyUrl() {
        const config = window.TranslationConfig || {};
        return String(config.translationProxyUrl || "").trim();
    }

    function configuredUrl() {
        const value = proxyUrl();
        if (!value) return null;
        try {
            const url = new URL(value, window.location && window.location.href);
            if (
                url.protocol !== "https:" &&
                !(url.protocol === "http:" &&
                    ["localhost", "127.0.0.1"].includes(url.hostname))
            ) return null;
            return url.toString();
        } catch (error) {
            return null;
        }
    }

    function snapshot(state, extra) {
        const value = Object.assign({
            provider: PROVIDER_ID,
            state,
            mode: "remote",
            supported: state === "available",
            configured: Boolean(configuredUrl()),
            updatedAt: Date.now()
        }, extra || {});
        listeners.forEach(function (listener) {
            try { listener(value); } catch (error) {}
        });
        return value;
    }

    async function status(sourceLanguage, targetLanguage) {
        const options = pair(
            sourceLanguage || "ja",
            targetLanguage || "zh"
        );
        if (!allowedPair(options)) {
            return snapshot("unavailable", {
                supported: false,
                reason: "language-pair-not-allowed",
                sourceLanguage: options.sourceLanguage,
                targetLanguage: options.targetLanguage
            });
        }
        if (!configuredUrl()) {
            return snapshot("unconfigured", {
                supported: false,
                reason: proxyUrl() ? "invalid-proxy-url" : "proxy-url-missing",
                sourceLanguage: options.sourceLanguage,
                targetLanguage: options.targetLanguage
            });
        }
        return snapshot("available", {
            sourceLanguage: options.sourceLanguage,
            targetLanguage: options.targetLanguage
        });
    }

    function providerError(message, code, statusCode) {
        const error = new Error(message);
        error.code = code;
        if (statusCode) error.status = statusCode;
        return error;
    }

    function cacheKey(text, options) {
        return options.sourceLanguage + "→" +
            options.targetLanguage + "\u0000" + text;
    }

    function readCache(key) {
        const item = cache.get(key);
        if (!item) return null;
        if (Date.now() - item.createdAt > CACHE_TTL_MS) {
            cache.delete(key);
            return null;
        }
        return item.text;
    }

    function writeCache(key, text) {
        cache.set(key, { text, createdAt: Date.now() });
        while (cache.size > CACHE_LIMIT) {
            cache.delete(cache.keys().next().value);
        }
    }

    async function translate(text, sourceLanguage, targetLanguage) {
        const input = String(text || "");
        const trimmed = input.trim();
        if (!trimmed) {
            throw providerError(
                "Translation text is empty",
                "TRANSLATION_EMPTY_TEXT"
            );
        }
        if (Array.from(input).length > MAX_TEXT_LENGTH) {
            throw providerError(
                "Translation text is too long",
                "TRANSLATION_TEXT_TOO_LONG"
            );
        }

        const options = pair(sourceLanguage, targetLanguage);
        if (!allowedPair(options)) {
            throw providerError(
                "Translation language pair is not allowed",
                "TRANSLATION_LANGUAGE_PAIR_NOT_ALLOWED"
            );
        }
        const endpoint = configuredUrl();
        if (!endpoint) {
            throw providerError(
                "在线翻译尚未配置",
                "TRANSLATION_PROXY_UNCONFIGURED"
            );
        }

        const key = cacheKey(input, options);
        const cached = readCache(key);
        if (cached !== null) return cached;

        const controller = new AbortController();
        const timeout = setTimeout(function () {
            controller.abort();
        }, REQUEST_TIMEOUT_MS);
        let response;
        try {
            response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    text: input,
                    sourceLanguage: options.sourceLanguage,
                    targetLanguage: options.targetLanguage
                }),
                signal: controller.signal
            });
        } catch (error) {
            if (error && error.name === "AbortError") {
                throw providerError(
                    "Online translation timed out",
                    "TRANSLATION_TIMEOUT"
                );
            }
            throw providerError(
                "Online translation is unavailable",
                "TRANSLATION_NETWORK_ERROR"
            );
        } finally {
            clearTimeout(timeout);
        }

        let payload = null;
        try {
            payload = await response.json();
        } catch (error) {
            throw providerError(
                "Online translation returned invalid JSON",
                "TRANSLATION_INVALID_RESPONSE",
                response.status
            );
        }
        if (!response.ok) {
            const code = payload && payload.error && payload.error.code;
            throw providerError(
                payload && payload.error && payload.error.message ||
                    "Online translation failed",
                code || (response.status === 429 ?
                    "TRANSLATION_RATE_LIMITED" : "TRANSLATION_REMOTE_ERROR"),
                response.status
            );
        }
        if (!payload || typeof payload.text !== "string" || !payload.text.trim()) {
            throw providerError(
                "Online translation returned an invalid result",
                "TRANSLATION_INVALID_RESPONSE",
                response.status
            );
        }
        const translated = payload.text.trim();
        writeCache(key, translated);
        return translated;
    }

    function subscribe(listener) {
        if (typeof listener !== "function") return function () {};
        listeners.add(listener);
        return function () { listeners.delete(listener); };
    }

    function destroy() {
        cache.clear();
        listeners.clear();
    }

    window.DeepLRemoteTranslationProvider = Object.freeze({
        id: PROVIDER_ID,
        version: VERSION,
        maxTextLength: MAX_TEXT_LENGTH,
        translate,
        status,
        subscribe,
        destroy,
        normalizeLanguage,
        clearCache: function () { cache.clear(); }
    });
})();
