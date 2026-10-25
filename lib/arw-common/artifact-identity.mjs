const EFFORT_NUMBER_PATTERN = /^(?!0000)\d{4}$/;
const ISSUE_NUMBER_PATTERN = /^(?!00)\d{2}$/;
const QUALIFIER_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const LOCAL_ISSUE_PATTERN = /^issue:(?<effortNumber>(?!0000)\d{4}):(?<issueNumber>(?!00)\d{2})$/;
const QUALIFIED_ISSUE_PATTERN = /^issue:(?<qualifier>[a-z0-9][a-z0-9-]*):(?<effortNumber>(?!0000)\d{4}):(?<issueNumber>(?!00)\d{2})$/;
const PROJECTION_PATTERN = /^(?<kind>map|spec):(?<effortNumber>(?!0000)\d{4})$/;

/** @typedef {'issue' | 'map' | 'spec'} ArtifactKind */
/** @typedef {{effortNumber: string, issueNumber: string | null, kind: ArtifactKind, qualifier: string | null}} CanonicalArtifactId */

/** @param {RegExpExecArray} match @param {string} name */
const requiredGroup = (match, name) => {
    const value = match.groups?.[name];
    if (value === undefined) throw new Error(`Canonical ID parser is missing ${name}.`);
    return value;
};

/**
 * Parse one local or qualified ARW Artifact Canonical ID into its closed numeric identity value.
 * Qualified names are accepted only for issue IDs; path resolution separately requires a local value.
 * @param {unknown} value
 * @returns {CanonicalArtifactId}
 */
export const parseCanonicalArtifactId = value => {
    if (typeof value !== 'string') throw new Error('Canonical ID must be a string.');

    const localIssue = LOCAL_ISSUE_PATTERN.exec(value);
    if (localIssue) {
        return {
            effortNumber: requiredGroup(localIssue, 'effortNumber'),
            issueNumber: requiredGroup(localIssue, 'issueNumber'),
            kind: 'issue',
            qualifier: null,
        };
    }

    const qualifiedIssue = QUALIFIED_ISSUE_PATTERN.exec(value);
    if (qualifiedIssue) {
        return {
            effortNumber: requiredGroup(qualifiedIssue, 'effortNumber'),
            issueNumber: requiredGroup(qualifiedIssue, 'issueNumber'),
            kind: 'issue',
            qualifier: requiredGroup(qualifiedIssue, 'qualifier'),
        };
    }

    const projection = PROJECTION_PATTERN.exec(value);
    if (projection) {
        return {
            effortNumber: requiredGroup(projection, 'effortNumber'),
            issueNumber: null,
            kind: /** @type {'map' | 'spec'} */ (requiredGroup(projection, 'kind')),
            qualifier: null,
        };
    }

    throw new Error('Canonical ID must use issue:NNNN:NN, issue:<name>:NNNN:NN, map:NNNN, or spec:NNNN with nonzero fixed-width numbers.');
};

/** @param {CanonicalArtifactId} value */
export const formatCanonicalArtifactId = value => {
    if (!['issue', 'map', 'spec'].includes(value?.kind) || !EFFORT_NUMBER_PATTERN.test(value?.effortNumber ?? '')) {
        throw new Error('Canonical ID value has an invalid kind or effort number.');
    }

    if (value.kind === 'issue') {
        if (!ISSUE_NUMBER_PATTERN.test(value.issueNumber ?? '')) throw new Error('Canonical ID value has an invalid issue number.');
        if (value.qualifier !== null && !QUALIFIER_PATTERN.test(value.qualifier ?? '')) throw new Error('Canonical ID value has an invalid qualifier.');
        return value.qualifier === null
            ? `issue:${value.effortNumber}:${value.issueNumber}`
            : `issue:${value.qualifier}:${value.effortNumber}:${value.issueNumber}`;
    }

    if (value.issueNumber !== null || value.qualifier !== null) {
        throw new Error('Canonical ID map and spec values cannot contain an issue number or qualifier.');
    }
    return `${value.kind}:${value.effortNumber}`;
};

/** @param {unknown} left @param {unknown} right */
export const compareCanonicalArtifactIds = (left, right) => {
    const leftCanonical = formatCanonicalArtifactId(parseCanonicalArtifactId(left));
    const rightCanonical = formatCanonicalArtifactId(parseCanonicalArtifactId(right));
    return leftCanonical < rightCanonical ? -1 : leftCanonical > rightCanonical ? 1 : 0;
};

export const ARTIFACT_EFFORT_DIRECTORY_PATTERN = /^(?<number>(?!0000)\d{4})-(?<slug>[a-z0-9][a-z0-9-]*)$/;
export const ARTIFACT_ISSUE_FILE_PATTERN = /^(?<number>(?!00)\d{2})-(?<slug>[a-z0-9][a-z0-9-]*)\.md$/;
export const ARTIFACT_SLUG_PATTERN = QUALIFIER_PATTERN;

/** @param {unknown} value */
export const parseEffortDirectoryName = value => {
    const match = ARTIFACT_EFFORT_DIRECTORY_PATTERN.exec(typeof value === 'string' ? value : '');
    if (!match) throw new Error('Effort directory must use NNNN-<slug> with a nonzero effort number.');
    return {number: requiredGroup(match, 'number'), slug: requiredGroup(match, 'slug')};
};

/** @param {unknown} value */
export const parseIssueFilename = value => {
    const match = ARTIFACT_ISSUE_FILE_PATTERN.exec(typeof value === 'string' ? value : '');
    if (!match) throw new Error('Issue filename must use NN-<slug>.md with a nonzero issue number.');
    return {number: requiredGroup(match, 'number'), slug: requiredGroup(match, 'slug')};
};

/** @param {unknown} value */
export const formatArtifactIdentityKey = value => {
    const parsed = typeof value === 'string' ? parseCanonicalArtifactId(value) : value;
    const canonical = parseCanonicalArtifactId(formatCanonicalArtifactId(/** @type {CanonicalArtifactId} */ (parsed)));
    if (canonical.qualifier !== null) throw new Error('Artifact identity key requires a local Canonical ID.');
    return canonical.kind === 'issue'
        ? `${canonical.effortNumber}_${canonical.issueNumber}`
        : canonical.effortNumber;
};

/** @param {unknown} value */
export const parseRegisteredArtifactPath = value => {
    if (typeof value !== 'string') throw new Error('Value is not a registered ARW Artifact path.');
    const segments = value.split('/');
    if (segments[0] !== '.scratch') throw new Error('Value is not a registered ARW Artifact path.');

    try {
        const effortDirectory = segments[1];
        const effort = parseEffortDirectoryName(effortDirectory);
        if (segments.length === 4 && segments[2] === 'issues') {
            const issueFilename = segments[3];
            const issue = parseIssueFilename(issueFilename);
            const canonicalId = formatCanonicalArtifactId({
                effortNumber: effort.number,
                issueNumber: issue.number,
                kind: 'issue',
                qualifier: null,
            });
            return {
                canonicalId,
                effortDirectory,
                effortNumber: effort.number,
                issueFilename,
                issueNumber: issue.number,
                kind: /** @type {'issue'} */ ('issue'),
                relativePath: value,
            };
        }
        if (segments.length === 3 && (segments[2] === 'map.md' || segments[2] === 'spec.md')) {
            const kind = /** @type {'map' | 'spec'} */ (segments[2].slice(0, -3));
            return {
                canonicalId: formatCanonicalArtifactId({effortNumber: effort.number, issueNumber: null, kind, qualifier: null}),
                effortDirectory,
                effortNumber: effort.number,
                issueFilename: null,
                issueNumber: null,
                kind,
                relativePath: value,
            };
        }
    } catch {
        throw new Error('Value is not a registered ARW Artifact path.');
    }
    throw new Error('Value is not a registered ARW Artifact path.');
};
