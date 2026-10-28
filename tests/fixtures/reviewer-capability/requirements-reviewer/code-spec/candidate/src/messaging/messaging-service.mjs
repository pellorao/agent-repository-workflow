import {QUEUE_LIMIT, digestNotice, groupDigests, markSent, queuedFor, withdraw} from './digest.mjs';
import {loadCatalog, normalizeLocale, resolveTemplate} from './locale-catalog.mjs';
import {isQuiet, prepareQuietHours, releaseTime} from './quiet-hours.mjs';
import {renderTemplate} from './template-render.mjs';

const requiredText = (value, label) => {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) throw new Error(`${label} is required`);
    return text;
};

const normalizeMessageKey = (key) => (typeof key === 'string' && key.trim() !== '' ? key.trim().toLowerCase() : null);

const draftMessage = ({member, request}) => {
    const memberId = requiredText(member.id, 'member');
    const templateName = requiredText(request.templateName, 'template');
    return {memberId, templateName, messageKey: normalizeMessageKey(request.messageKey)};
};

const sentNotice = (message) => Object.freeze({messageId: message.id, memberId: message.memberId, body: message.body});

export const sendMessage = async ({catalog, member, nextId, now, request, send, store}) => {
    const draft = draftMessage({member, request});
    if (draft.messageKey !== null) {
        const existing = await store.findByMessageKey(draft.messageKey);
        if (existing !== null) return existing;
    }
    const hours = prepareQuietHours(member);
    const resolved = resolveTemplate(loadCatalog(catalog), draft.templateName, normalizeLocale(member.locale));
    const body = renderTemplate(resolved.template, request.values ?? {});
    const at = now();
    const quiet = isQuiet(hours, at);
    if (quiet && queuedFor(await store.list({state: 'queued'}), draft.memberId).length >= QUEUE_LIMIT) {
        throw new Error('member has too many queued messages');
    }
    const base = {
        id: nextId(),
        memberId: draft.memberId,
        messageKey: draft.messageKey,
        templateName: draft.templateName,
        locale: resolved.locale,
        body,
    };
    if (quiet) {
        const queued = {
            ...base,
            state: 'queued',
            queuedAt: at,
            releaseAt: releaseTime(hours, at),
        };
        return store.save(queued);
    }
    const sent = {...base, state: 'sent', sentAt: at};
    const saved = store.save(sent);
    await send(sentNotice(sent));
    return saved;
};

export const flushDigests = async ({now, sendDigest, store}) => {
    const at = now();
    const digests = groupDigests(await store.list({state: 'queued'}), at);
    const notices = [];
    for (const digest of digests) {
        const sent = digest.messages.map((message) => markSent(message, at));
        for (const message of sent) await store.save(message);
        const notice = digestNotice(digest.memberId, sent);
        await sendDigest(notice);
        notices.push(notice);
    }
    return notices;
};

export const withdrawMessage = async ({messageId, now, store}) => {
    const message = await store.findById(messageId);
    if (message === null) throw new Error('message is unknown');
    const next = withdraw(message, now());
    if (next === message) return message;
    return store.save(next);
};
