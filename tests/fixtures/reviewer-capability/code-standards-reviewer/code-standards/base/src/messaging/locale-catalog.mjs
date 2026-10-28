export const FALLBACK_LOCALE = 'en';

export const normalizeLocale = (locale) => {
    const normalized = typeof locale === 'string' ? locale.trim().toLowerCase() : '';
    return normalized === '' ? FALLBACK_LOCALE : normalized;
};

export const loadCatalog = (rawCatalog) => new Map(
    Object.entries(rawCatalog).map(([locale, templates]) => [locale.trim().toLowerCase(), templates]),
);

export const localeCandidates = (locale) => [...new Set([locale, locale.split('-')[0], FALLBACK_LOCALE])];

export const resolveTemplate = (catalog, templateName, locale) => {
    for (const candidate of localeCandidates(locale)) {
        const template = catalog.get(candidate)?.[templateName];
        if (typeof template === 'string') return {locale: candidate, template};
    }
    throw new Error('template is unavailable');
};
