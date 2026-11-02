/** @param {URL} url */
export const hasNoUrlExtras = url => url.username === '' && url.password === '' && url.search === '' && url.hash === '';
