const SKILL_IDENTITY = /^[a-z]+(?:-[a-z]+)*$/u;

export const isSkillIdentity = (/** @type {unknown} */ value) => typeof value === 'string' && SKILL_IDENTITY.test(value);
