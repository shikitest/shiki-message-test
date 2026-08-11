(function () {
    "use strict";

    const VERSION = "1.0.0";
    const PROVIDER_ID = "translation-provider-router";
    const local = window.ChromeTranslatorProvider || null;
    const remote = window.DeepLRemoteTranslationProvider || null;
    const listeners = new Set();
    const unsubscribers = [];
    const LOCAL_STATES = new Set([
        "available",
        "downloadable",
        "downloading",
        "activation-required"
    ]);

    function emit(status) {
        listeners.forEach(function (listener) {
            try { listener(status); } catch (error) {}
        });
        return status;
    }

    async function resolve(sourceLanguage, targetLanguage) {
        const source = sourceLanguage || "ja";
        const target = targetLanguage || "zh";
        if (local && typeof local.status === "function") {
            const localStatus = await local.status(source, target);
            if (LOCAL_STATES.has(localStatus.state)) {
                return {
                    provider: local,
                    status: Object.assign({}, localStatus, {
                        provider: PROVIDER_ID,
                        activeProvider: local.id,
                        mode: "local"
                    })
                };
            }
        }
        if (remote && typeof remote.status === "function") {
            const remoteStatus = await remote.status(source, target);
            return {
                provider: remoteStatus.supported ? remote : null,
                status: Object.assign({}, remoteStatus, {
                    provider: PROVIDER_ID,
                    activeProvider: remote.id,
                    mode: "remote"
                })
            };
        }
        return {
            provider: null,
            status: {
                provider: PROVIDER_ID,
                activeProvider: null,
                mode: "remote",
                state: "unconfigured",
                supported: false,
                reason: "remote-provider-missing"
            }
        };
    }

    async function status(sourceLanguage, targetLanguage) {
        return emit((await resolve(sourceLanguage, targetLanguage)).status);
    }

    async function translate(text, sourceLanguage, targetLanguage) {
        const route = await resolve(sourceLanguage, targetLanguage);
        if (!route.provider) {
            const error = new Error(
                route.status.state === "unconfigured" ?
                    "在线翻译尚未配置" : "Translation is unavailable"
            );
            error.code = route.status.state === "unconfigured" ?
                "TRANSLATION_PROXY_UNCONFIGURED" :
                "TRANSLATION_UNAVAILABLE";
            throw error;
        }
        return route.provider.translate(
            text,
            sourceLanguage,
            targetLanguage
        );
    }

    function subscribe(listener) {
        if (typeof listener !== "function") return function () {};
        listeners.add(listener);
        return function () { listeners.delete(listener); };
    }

    [local, remote].forEach(function (provider) {
        if (provider && typeof provider.subscribe === "function") {
            unsubscribers.push(provider.subscribe(function (event) {
                emit(Object.assign({}, event, {
                    provider: PROVIDER_ID,
                    activeProvider: provider.id,
                    mode: provider === local ? "local" : "remote"
                }));
            }));
        }
    });

    const router = Object.freeze({
        id: PROVIDER_ID,
        version: VERSION,
        translate,
        status,
        subscribe,
        resolve,
        get localProvider() { return local; },
        get remoteProvider() { return remote; }
    });

    window.TranslationProviderRouter = router;
    if (
        window.TranslationProvider &&
        typeof window.TranslationProvider.set === "function"
    ) {
        window.TranslationProvider.set(router);
    }
})();
