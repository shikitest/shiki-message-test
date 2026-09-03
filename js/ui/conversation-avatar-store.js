(function (global) {
    'use strict';

    const STORE_SUFFIX = 'conversationAvatarMediaV1:';
    const objectUrls = new Map();

    function key(sessionId) {
        return String(global.APP_PREFIX || 'CHAT_APP_V3_') + STORE_SUFFIX + String(sessionId || '');
    }

    function storage() {
        if (!global.localforage || typeof global.localforage.getItem !== 'function') {
            throw new Error('Conversation avatar storage is unavailable');
        }
        return global.localforage;
    }

    function revoke(sessionId) {
        const id = String(sessionId || '');
        const url = objectUrls.get(id);
        if (url && global.URL && typeof global.URL.revokeObjectURL === 'function') {
            global.URL.revokeObjectURL(url);
        }
        objectUrls.delete(id);
    }

    async function save(sessionId, file) {
        const id = String(sessionId || '');
        if (!id || !file || typeof file.size !== 'number') throw new Error('Invalid avatar file');
        if (!/^image\//i.test(file.type || '')) throw new Error('请选择图片文件');
        if (file.size > 8 * 1024 * 1024) throw new Error('头像文件不能超过 8MB');
        await storage().setItem(key(id), file);
        revoke(id);
        return 'local-avatar:' + id;
    }

    async function getObjectUrl(sessionId) {
        const id = String(sessionId || '');
        if (!id) return null;
        if (objectUrls.has(id)) return objectUrls.get(id);
        const blob = await storage().getItem(key(id));
        if (!blob || !global.URL || typeof global.URL.createObjectURL !== 'function') return null;
        const url = global.URL.createObjectURL(blob);
        objectUrls.set(id, url);
        return url;
    }

    async function remove(sessionId) {
        const id = String(sessionId || '');
        if (!id) return;
        revoke(id);
        await storage().removeItem(key(id));
    }

    global.addEventListener('pagehide', function () {
        Array.from(objectUrls.keys()).forEach(revoke);
    });

    global.ConversationAvatarStore = Object.freeze({
        key: key,
        save: save,
        getObjectUrl: getObjectUrl,
        remove: remove,
        revoke: revoke
    });
})(window);
