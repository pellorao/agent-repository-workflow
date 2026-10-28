import {assertSafePath} from '../common/canonical-contract.mjs';
import {ARTIFACT_EFFORT_DIRECTORY_PATTERN, formatCanonicalArtifactId, parseCanonicalArtifactId} from './artifact-identity.mjs';

const IMPLEMENTATION_STATUSES = new Set([
    'needs-triage',
    'needs-info',
    'ready-for-agent',
    'ready-for-human',
    'completed',
    'wontfix',
]);
const WAYFINDER_TYPES = new Set(['research', 'prototype', 'grilling', 'task']);
const WAYFINDER_STATUSES = new Set(['open', 'claimed', 'resolved']);
export const TERMINAL_STATUSES = new Set(['completed', 'wontfix', 'resolved']);

/** @typedef {'blockedBy' | 'moduleImplementation' | 'applicationSource' | 'status' | 'type'} MetadataKind */
/** @typedef {{index: number, syntax: 'bold' | 'plain', value: string}} MetadataField */
/** @typedef {Record<MetadataKind, MetadataField[]>} IssueMetadata */
/** @typedef {{index: number, title: string}} IssueHeading */
/** @typedef {{bodyLines: string[], end: number, start: number}} IssueSection */
/** @typedef {{blockerSections: IssueSection[], frontmatterEnd: number, heading: IssueHeading | null, lines: string[], metadata: IssueMetadata, normalized: string}} IndexedIssueText */
/** @typedef {{kind: 'issue', number: string, syntax: 'canonical' | 'legacy', title: string | null}} IssueBlocker */
/** @typedef {{coordinate: string, description: string, kind: 'external-dependency'}} ExternalDependency */
/** @typedef {{kind: 'issue', number: string, title: string | null}} IssueBlockerReference */
/** @typedef {{empty: boolean, meaningfulValues: string[], parsed: Array<ExternalDependency | IssueBlocker | null>}} ParsedBlockerTokens */
/** @typedef {{blockers: IssueBlocker[], duplicateNumber: string | null, empty: boolean, meaningfulValues: string[]}} ValidatedBlockerSet */
/** @typedef {{effort: string, number: string, sourceKey: string, text: string}} IssueDocumentInput */
/** @typedef {{association?: {coordinate: string, kind: 'module-implementation' | 'application-source'}, blockerRecords: IssueRecord[], blockers: IssueBlockerReference[], effortNumber: string, id: string, kind: 'implementation' | 'application-source' | 'wayfinder', number: string, sourceKey: string, status: string, title: string}} IssueRecord */
/** @typedef {{effortNumber: string, number: string, record: IssueRecord | null, sourceKey: string}} IssueSource */
/** @typedef {{message: string, sourceKey: string, unresolvedReference?: {effortNumber: string, number: string}}} IssueDiagnostic */
/** @typedef {{changed: boolean, sourceKey: string, text: string}} IssueMigrationOutput */
/** @typedef {{message: string, sourceKey: string}} IssueMigrationDiagnostic */

/** @param {RegExpExecArray} match @param {string} name @returns {string} */
const requiredGroup = (match, name) => {
    const value = match.groups?.[name];
    if (value === undefined) throw new Error(`Required regular expression group is missing: ${name}.`);
    return value;
};

const compareStrings = (/** @type {string | number} */ left, /** @type {string | number} */ right) => left < right ? -1 : left > right ? 1 : 0;

const normalizeText = (/** @type {string} */ text) => text.replace(/\r\n?/g, '\n');

/** @param {string} value */
const parseQualifiedIssueCoordinate = value => {
    try {
        const parsed = parseCanonicalArtifactId(value);
        return parsed.kind === 'issue' && parsed.qualifier !== null ? parsed : null;
    } catch {
        return null;
    }
};

const findFrontmatterEnd = (/** @type {string[]} */ lines) => {
    if (lines[0]?.trim() !== '---') {
        return -1;
    }

    const end = lines.findIndex((/** @type {string} */ line, /** @type {number} */ index) => index > 0 && line.trim() === '---');

    if (end < 0) {
        throw new Error('YAML frontmatter is not closed.');
    }

    return end;
};

const isFence = (/** @type {string} */ line) => /^\s*(```|~~~)/.test(line);

/** @param {string[]} lines @param {(line: string) => boolean} predicate @param {number} [startIndex] */
export const findUnfencedLineIndexes = (lines, predicate, startIndex = 0) => {
    /** @type {number[]} */
    const indexes = [];
    let fenced = false;

    for (let index = startIndex; index < lines.length; index += 1) {
        if (isFence(lines[index])) {
            fenced = !fenced;
            continue;
        }

        if (!fenced && predicate(lines[index])) indexes.push(index);
    }

    return indexes;
};

/** 按行拆分并定位围栏代码外以 `prefix` 开头的行, 行尾 `\r` 留在行内. @param {string} text @param {string} prefix */
export const findUnfencedPrefixedLines = (text, prefix) => {
    const lines = text.split('\n');
    return {indexes: findUnfencedLineIndexes(lines, line => line.startsWith(prefix)), lines};
};

/** 定位唯一的围栏外 `Status: <status>` 行; 不唯一或状态不符时返回 null. `cr` 是该行尾的 `\r` 或空串. @param {string} text @param {string} status */
export const locateStatusLine = (text, status) => {
    const {indexes, lines} = findUnfencedPrefixedLines(text, 'Status: ');
    if (indexes.length !== 1 || lines[indexes[0]].replace(/\r$/u, '') !== `Status: ${status}`) return null;
    return {cr: lines[indexes[0]].endsWith('\r') ? '\r' : '', index: indexes[0], lines};
};

/** @param {string[]} lines @returns {string[]} */
const normalizeAcceptanceTaskListMarkers = lines => {
    let fenced = false;

    return lines.map(line => {
        if (isFence(line)) {
            fenced = !fenced;
            return line;
        }

        if (fenced) return line;

        return line.replace(/^( {0,3}[-+*](?: {1,4}|\t))\[[xX]\](?=$|[ \t])/, '$1[ ]');
    });
};

/** @param {string[]} lines @param {number} startIndex @returns {IssueHeading | null} */
const findFirstHeading = (lines, startIndex) => {
    let fenced = false;

    for (let index = startIndex; index < lines.length; index += 1) {
        if (isFence(lines[index])) {
            fenced = !fenced;
            continue;
        }

        if (!fenced) {
            const match = /^# (.+?)\s*$/.exec(lines[index]);

            if (match && match[1].trim().length > 0) {
                return {index, title: match[1].trim()};
            }
        }
    }

    return null;
};

/** @param {string[]} lines @param {number} frontmatterEnd @param {number} headingIndex */
const assertHeadingIsFirstRenderedContent = (lines, frontmatterEnd, headingIndex) => {
    const preamble = lines.slice(frontmatterEnd + 1, headingIndex);

    if (preamble.some(line => line.trim().length > 0)) {
        throw new Error('Rendered content appears before the first level-one heading.');
    }
};

/** @param {string[]} lines @param {number} frontmatterEnd @returns {IssueMetadata} */
const readMetadata = (lines, frontmatterEnd) => {
    /** @type {IssueMetadata} */
    const metadata = {type: [], status: [], blockedBy: [], moduleImplementation: [], applicationSource: []};
    let fenced = false;

    for (let index = frontmatterEnd + 1; index < lines.length; index += 1) {
        const line = lines[index];

        if (isFence(line)) {
            fenced = !fenced;
            continue;
        }

        if (fenced) {
            continue;
        }

        /** @type {Array<[MetadataKind, RegExp]>} */
        const fields = [
            ['type', /^(?:(?<bold>\*\*)Type:\*\*|Type:)\s*(?<value>.*)$/],
            ['status', /^(?:(?<bold>\*\*)Status:\*\*|Status:)\s*(?<value>.*)$/],
            ['moduleImplementation', /^(?:(?<bold>\*\*)Module implementation issue:\*\*|Module implementation issue:)\s*(?<value>.*)$/],
            ['applicationSource', /^(?:(?<bold>\*\*)Application source issue:\*\*|Application source issue:)\s*(?<value>.*)$/],
            ['blockedBy', /^(?:(?<bold>\*\*)Blocked by:\*\*|Blocked by:)\s*(?<value>.*)$/],
        ];

        for (const [field, pattern] of fields) {
            const match = pattern.exec(line);

            if (match) {
                metadata[field].push({
                    index,
                    syntax: match.groups?.bold ? 'bold' : 'plain',
                    value: requiredGroup(match, 'value').trim(),
                });
                break;
            }
        }
    }

    return metadata;
};

/** @param {string[]} lines @param {number} headingIndex @param {string} heading @returns {IssueSection[]} */
const findSections = (lines, headingIndex, heading) => {
    /** @type {IssueSection[]} */
    const sections = [];
    const sectionIndexes = findUnfencedLineIndexes(lines, (/** @type {string} */ line) => /^##\s+/.test(line), headingIndex + 1);

    for (const [position, index] of sectionIndexes.entries()) {
        if (lines[index].trim() !== heading) continue;
        const endIndex = sectionIndexes[position + 1] ?? lines.length;
        sections.push({
            bodyLines: lines.slice(index + 1, endIndex),
            end: endIndex,
            start: index,
        });
    }

    return sections;
};

/** @param {string} text @returns {IndexedIssueText} */
const indexIssueText = text => {
    const normalized = normalizeText(text);
    const lines = normalized.split('\n');
    const frontmatterEnd = findFrontmatterEnd(lines);
    const heading = findFirstHeading(lines, frontmatterEnd + 1);

    return {
        blockerSections: heading ? findSections(lines, heading.index, '## Blocked by') : [],
        frontmatterEnd,
        heading,
        lines,
        metadata: readMetadata(lines, frontmatterEnd),
        normalized,
    };
};

/** @param {{text: string}} input */
export const readApplicationSourceField = ({text}) => {
    const {lines, metadata} = indexIssueText(text);
    const field = metadata.applicationSource.length === 1 ? metadata.applicationSource[0] : null;
    return field === null ? null : lines[field.index];
};

/** @typedef {{code: string, message: string, path?: string}} DownstreamDiagnostic */
/** @typedef {{commentsEnd: number, commentsStart?: number, diagnostics: [], downstreamStart?: number, lines: string[], lineStarts: number[], status: 'succeeded', value: {content: string, hasItems: boolean, present: boolean}}} DownstreamInspectionSuccess */
/** @typedef {{diagnostics: DownstreamDiagnostic[], status: 'blocked'}} DownstreamInspectionBlocked */

/** @param {string[]} lines */
const trimBlankLines = lines => {
    let start = 0;
    let end = lines.length;
    while (start < end && lines[start].trim().length === 0) start += 1;
    while (end > start && lines[end - 1].trim().length === 0) end -= 1;
    return lines.slice(start, end);
};

/** @param {string[]} lines */
const inspectDownstreamContent = lines => {
    const contentLines = trimBlankLines(lines);
    if (contentLines.length === 0) return {content: '', hasItems: false, valid: true};
    const sentinelLines = contentLines.filter(line => line.startsWith('- ') && line.slice(2).trim() === 'None.');
    if (sentinelLines.length > 0) return contentLines.length === 1
        ? {content: '- None.', hasItems: false, valid: true}
        : {content: contentLines.join('\n'), hasItems: false, valid: false};
    let hasItems = false;
    for (const line of contentLines) {
        if (line.trim().length === 0) continue;
        if (line.startsWith('- ') && /\S/u.test(line.slice(2))) {
            hasItems = true;
            continue;
        }
        if (/^(?: {2,}|\t)/u.test(line)) continue;
        return {content: contentLines.join('\n'), hasItems, valid: false};
    }
    return {content: contentLines.join('\n'), hasItems, valid: hasItems};
};

/** @param {string} text */
const findLineStarts = text => {
    const starts = [0];
    for (let index = 0; index < text.length; index += 1) {
        if (text[index] === '\r' && text[index + 1] === '\n') index += 1;
        if (text[index] === '\r' || text[index] === '\n') starts.push(index + 1);
    }
    return starts;
};

/** @param {string[]} lines */
const hasUnclosedFence = lines => {
    let fenced = false;
    for (const line of lines) {
        if (isFence(line)) fenced = !fenced;
    }
    return fenced;
};

/** @param {string} text @param {string} block */
const appendManagedBlock = (text, block) => {
    if (text.length === 0) return block;
    const lastBreak = /(?:\r\n|\r|\n)$/u.exec(text);
    if (lastBreak === null) return `${text}\n\n${block}`;
    const beforeLastBreak = text.slice(0, -lastBreak[0].length);
    return /(?:\r\n|\r|\n)$/u.test(beforeLastBreak) ? `${text}${block}` : `${text}\n${block}`;
};

/** @param {string} text @param {string} path @returns {DownstreamInspectionSuccess | DownstreamInspectionBlocked} */
const inspectDownstreamChanges = (text, path) => {
    const normalized = normalizeText(text);
    const lines = normalized.split('\n');
    const lineStarts = findLineStarts(text);
    if (hasUnclosedFence(lines)) {
        return {diagnostics: [{code: 'downstream-changes-position-invalid', message: 'Downstream changes requires closed fenced code boundaries.', path}], status: /** @type {'blocked'} */ ('blocked')};
    }
    const headings = findUnfencedLineIndexes(lines, line => /^#{1,6}(?:[ \t]+|$)/u.test(line));
    const levelTwo = findUnfencedLineIndexes(lines, line => /^##\s+/.test(line));
    const comments = levelTwo.filter(index => lines[index] === '## Comments');
    if (comments.length > 1) {
        return {diagnostics: [{code: 'downstream-comments-duplicate', message: 'Issue contains more than one Comments section.', path}], status: /** @type {'blocked'} */ ('blocked')};
    }
    const downstream = findUnfencedLineIndexes(lines, line => line === '### Downstream changes');
    if (downstream.length > 1) {
        return {diagnostics: [{code: 'downstream-changes-duplicate', message: 'Issue contains more than one Downstream changes subsection.', path}], status: /** @type {'blocked'} */ ('blocked')};
    }
    if (downstream.length === 0) {
        const commentsStart = comments[0];
        const commentsEnd = commentsStart === undefined
            ? lines.length
            : levelTwo.find(index => index > commentsStart) ?? lines.length;
        if (commentsStart !== undefined && commentsEnd < lines.length && lines.slice(commentsEnd).some(line => line.trim().length > 0)) {
            return {diagnostics: [{code: 'downstream-changes-position-invalid', message: 'Downstream changes must be the final managed issue content.', path}], status: /** @type {'blocked'} */ ('blocked')};
        }
        return {
            commentsEnd,
            commentsStart,
            diagnostics: [],
            lineStarts,
            lines,
            status: /** @type {'succeeded'} */ ('succeeded'),
            value: {content: '', hasItems: false, present: false},
        };
    }
    const commentsStart = comments[0];
    const downstreamStart = downstream[0];
    const commentsEnd = commentsStart === undefined
        ? lines.length
        : levelTwo.find(index => index > commentsStart) ?? lines.length;
    if (commentsStart === undefined || downstreamStart <= commentsStart || downstreamStart >= commentsEnd) {
        return {diagnostics: [{code: 'downstream-changes-position-invalid', message: 'Downstream changes must belong to the unique Comments section.', path}], status: /** @type {'blocked'} */ ('blocked')};
    }
    if (headings.some(index => index > commentsStart && index < downstreamStart)) {
        return {diagnostics: [{code: 'downstream-changes-position-invalid', message: 'Downstream changes must directly follow ordinary Comments content without another heading boundary.', path}], status: /** @type {'blocked'} */ ('blocked')};
    }
    if (commentsEnd < lines.length && lines.slice(commentsEnd).some(line => line.trim().length > 0)) {
        return {diagnostics: [{code: 'downstream-changes-position-invalid', message: 'Downstream changes must be the final managed issue content.', path}], status: /** @type {'blocked'} */ ('blocked')};
    }
    const laterSubsection = findUnfencedLineIndexes(lines, line => /^###\s+/.test(line), downstreamStart + 1)
        .find(index => index < commentsEnd);
    if (laterSubsection !== undefined) {
        return {diagnostics: [{code: 'downstream-changes-position-invalid', message: 'Downstream changes must be the final Comments subsection.', path}], status: /** @type {'blocked'} */ ('blocked')};
    }
    const inspected = inspectDownstreamContent(lines.slice(downstreamStart + 1, commentsEnd));
    if (!inspected.valid) {
        return {diagnostics: [{code: 'downstream-changes-content-invalid', message: 'Downstream changes content is not a safe list.', path}], status: /** @type {'blocked'} */ ('blocked')};
    }
    return {
        commentsEnd,
        commentsStart,
        diagnostics: [],
        downstreamStart,
        lineStarts,
        lines,
        status: /** @type {'succeeded'} */ ('succeeded'),
        value: {content: inspected.content, hasItems: inspected.hasItems, present: true},
    };
};

/**
 * Read the optional final Downstream changes subsection from an issue document.
 * The returned content uses LF and excludes the heading and surrounding blank lines.
 * @param {{path: string, text: string}} input
 */
export const readDownstreamChanges = input => {
    const inspected = inspectDownstreamChanges(input.text, input.path);
    return inspected.status === 'succeeded'
        ? {diagnostics: [], status: inspected.status, value: inspected.value}
        : inspected;
};

/**
 * Replace or append the final Downstream changes subsection while preserving preceding issue content.
 * @param {{content: string, path: string, text: string}} input
 */
export const replaceDownstreamChanges = input => {
    const inspected = inspectDownstreamChanges(input.text, input.path);
    if (inspected.status !== 'succeeded') return inspected;
    const desired = inspectDownstreamContent(normalizeText(input.content).split('\n'));
    if (!desired.valid || !desired.hasItems && desired.content !== '- None.') {
        return {diagnostics: [{code: 'downstream-changes-content-invalid', message: 'Replacement Downstream changes content is not a safe list.', path: input.path}], status: /** @type {'blocked'} */ ('blocked')};
    }
    const subsection = `### Downstream changes\n\n${desired.content}\n`;
    let text;
    if (inspected.downstreamStart !== undefined) {
        const start = inspected.lineStarts[inspected.downstreamStart] ?? input.text.length;
        const end = inspected.lineStarts[inspected.commentsEnd] ?? input.text.length;
        text = `${input.text.slice(0, start)}${subsection}${input.text.slice(end)}`;
    } else if (inspected.commentsStart !== undefined) {
        const offset = inspected.lineStarts[inspected.commentsEnd] ?? input.text.length;
        text = `${appendManagedBlock(input.text.slice(0, offset), subsection)}${input.text.slice(offset)}`;
    } else {
        text = appendManagedBlock(input.text, `## Comments\n\n${subsection}`);
    }
    return {diagnostics: [], status: /** @type {'succeeded'} */ ('succeeded'), text};
};

/**
 * 读取完整 implementation issue text 中唯一且位置正确的 Spec Requirement.
 * 同时返回 What to build, Spec Requirement 和 Acceptance criteria 的准确连续字节, 供调用方绑定 issue 授权范围.
 * Governing requirement path 使用 Repository 根目录基准, 不读取目标文件或修改 issue bytes.
 */
export const readIssueRequirement = (/** @type {{issuePath: string, text: string}} */ {issuePath, text}) => {
    assertSafePath(issuePath, 'Issue path');
    const normalized = normalizeText(text);
    const lines = normalized.split('\n');
    const lineOffsets = [];
    let offset = 0;
    for (const line of lines) {
        lineOffsets.push(offset);
        offset += line.length + 1;
    }
    const sectionIndexes = findUnfencedLineIndexes(lines, (/** @type {string} */ line) => /^## /.test(line));
    const whatToBuildIndexes = sectionIndexes.filter(index => lines[index] === '## What to build');
    const requirementIndexes = sectionIndexes.filter(index => lines[index] === '## Spec Requirement');
    const acceptanceIndexes = sectionIndexes.filter(index => lines[index] === '## Acceptance criteria');

    if (whatToBuildIndexes.length !== 1
        || requirementIndexes.length !== 1
        || acceptanceIndexes.length !== 1
        || !(whatToBuildIndexes[0] < requirementIndexes[0] && requirementIndexes[0] < acceptanceIndexes[0])
        || sectionIndexes.filter(index => index >= whatToBuildIndexes[0] && index <= acceptanceIndexes[0])
            .some((index, position) => index !== [whatToBuildIndexes[0], requirementIndexes[0], acceptanceIndexes[0]][position])) {
        throw new Error('Issue has malformed Spec Requirement placement.');
    }

    const nextSectionIndex = sectionIndexes.find(index => index > acceptanceIndexes[0]);
    const subjectContent = normalized.slice(
        lineOffsets[whatToBuildIndexes[0]],
        nextSectionIndex === undefined ? normalized.length : lineOffsets[nextSectionIndex],
    );
    const subjectLines = subjectContent.split('\n');
    const acceptanceSubjectIndex = acceptanceIndexes[0] - whatToBuildIndexes[0];
    const subjectIdentityContent = [
        ...subjectLines.slice(0, acceptanceSubjectIndex + 1),
        ...normalizeAcceptanceTaskListMarkers(subjectLines.slice(acceptanceSubjectIndex + 1)),
    ].join('\n');
    const requirementContent = normalized.slice(lineOffsets[requirementIndexes[0]], lineOffsets[acceptanceIndexes[0]]);
    const heading = '## Spec Requirement\n';
    const content = requirementContent.slice(heading.length).trim();

    if (content === 'Not required') return {kind: 'exception', requirements: [], subjectContent, subjectIdentityContent};

    const contentLines = content.split('\n');

    if (contentLines[0] !== 'Governing requirements:' || contentLines[1] !== '' || contentLines.length < 3) {
        throw new Error('Issue has malformed governing requirements.');
    }

    return {
        kind: 'normal',
        requirements: contentLines.slice(2).map((/** @type {string} */ line) => {
            const match = /^- `([^`#]+?)(?:#([a-z0-9][a-z0-9-]*))?`$/.exec(line);

            if (!match) throw new Error('Issue has malformed governing requirement reference.');
            assertSafePath(match[1], 'Issue governing requirement path');
            return {anchor: match[2] ?? null, filePath: match[1]};
        }),
        subjectContent,
        subjectIdentityContent,
    };
};

/**
 * Read the exact issue sections protected by Module correction soft locks.
 * Acceptance task-list completion markers are canonicalized for comparison.
 * @param {{text: string}} input
 */
export const readModuleCorrectionSoftLocks = input => {
    const lines = normalizeText(input.text).split('\n');
    const headings = findUnfencedLineIndexes(lines, line => /^##\s+/.test(line));
    const names = ['## What to build', '## Spec Requirement', '## Acceptance criteria', '## Blocked by'];
    return Object.fromEntries(names.map(name => {
        const matches = headings.filter(index => lines[index] === name);
        if (matches.length !== 1) throw new Error(`Module correction issue must contain one ${name.slice(3)} section.`);
        const start = matches[0];
        const end = headings.find(index => index > start) ?? lines.length;
        const content = lines.slice(start, end);
        return [name.slice(3), name === '## Acceptance criteria'
            ? [content[0], ...normalizeAcceptanceTaskListMarkers(content.slice(1))].join('\n')
            : content.join('\n')];
    }));
};

/** @returns {ExternalDependency | IssueBlocker | null} */
const parseBlockerToken = (/** @type {string} */ token, /** @type {string} */ effort) => {
    const value = token.trim().replace(/^[-*]\s+/, '').trim();

    if (value.length === 0) {
        throw new Error('Blocked by contains an empty blocker.');
    }

    if (/^None(?:\s|—|-|$)/.test(value)) {
        return null;
    }

    const externalDependency = /^External dependency: `(?<coordinate>[^`]+)` - (?<description>\S(?:.*\S)?)$/u.exec(value);
    if (externalDependency) {
        const coordinate = requiredGroup(externalDependency, 'coordinate');
        if (parseQualifiedIssueCoordinate(coordinate) === null) throw new Error(`Blocked by cannot be parsed: ${value}.`);
        return {
            coordinate,
            description: requiredGroup(externalDependency, 'description'),
            kind: 'external-dependency',
        };
    }

    const markdownLink = /^\[(?<title>[^\]]+)\]\((?<reference>[^)]+)\)$/.exec(value);

    if (markdownLink) {
        const blocker = parseBlockerToken(requiredGroup(markdownLink, 'reference'), effort);
        if (blocker?.kind === 'external-dependency') throw new Error(`Blocked by cannot be parsed: ${value}.`);
        return blocker ? {...blocker, syntax: 'legacy', title: requiredGroup(markdownLink, 'title').trim()} : blocker;
    }

    const localCanonical = /^issue:/.test(value) ? (() => {
        try {
            const parsed = parseCanonicalArtifactId(value);
            return parsed.kind === 'issue' && parsed.qualifier === null ? parsed : null;
        } catch {
            return null;
        }
    })() : null;
    if (localCanonical) {
        if (localCanonical.issueNumber === null) throw new Error(`Blocked by cannot be parsed: ${value}.`);
        const effortNumber = ARTIFACT_EFFORT_DIRECTORY_PATTERN.exec(effort)?.groups?.number;
        if (effortNumber === undefined || localCanonical.effortNumber !== effortNumber) {
            throw new Error(`Blocked by explicitly references another effort: ${localCanonical.effortNumber}.`);
        }
        return {kind: 'issue', number: localCanonical.issueNumber, syntax: 'canonical', title: null};
    }

    const canonicalId = /^(?<effort>[a-z0-9][a-z0-9-]*):(?<number>\d{2})-[a-z0-9][a-z0-9-]*(?:\s+(?:—|-)\s+(?<title>.+))?$/.exec(value);

    if (canonicalId) {
        const referencedEffort = requiredGroup(canonicalId, 'effort');
        if (referencedEffort !== effort) {
            throw new Error(`Blocked by explicitly references another effort: ${referencedEffort}.`);
        }

        return {kind: 'issue', number: requiredGroup(canonicalId, 'number'), syntax: 'legacy', title: canonicalId.groups?.title?.trim() ?? null};
    }

    const number = /^(?<number>\d{2})(?:\s+(?:—|-)\s+(?<title>.+))?$/.exec(value);

    if (number) {
        return {kind: 'issue', number: requiredGroup(number, 'number'), syntax: 'canonical', title: number.groups?.title?.trim() ?? null};
    }

    const path = /\.scratch[\\/](?<effort>[a-z0-9][a-z0-9-]*)[\\/]issues[\\/](?<number>\d{2})-[a-z0-9][a-z0-9-]*\.md/.exec(value);

    if (path) {
        const referencedEffort = requiredGroup(path, 'effort');
        if (referencedEffort !== effort) {
            throw new Error(`Blocked by explicitly references another effort: ${referencedEffort}.`);
        }

        return {kind: 'issue', number: requiredGroup(path, 'number'), syntax: 'legacy', title: readPathTitle(value, path)};
    }

    const issuePath = /(?:^|[\\/])(?:(?<effort>[a-z0-9][a-z0-9-]*)[\\/])?issues[\\/](?<number>\d{2})-[a-z0-9][a-z0-9-]*\.md/.exec(value);

    if (issuePath) {
        const referencedEffort = issuePath.groups?.effort;
        if (referencedEffort && referencedEffort !== effort) {
            throw new Error(`Blocked by explicitly references another effort: ${referencedEffort}.`);
        }

        return {kind: 'issue', number: requiredGroup(issuePath, 'number'), syntax: 'legacy', title: readPathTitle(value, issuePath)};
    }

    throw new Error(`Blocked by cannot be parsed: ${value}.`);
};

/** @param {string[]} values @param {string} effort @returns {IssueBlocker[]} */
const parseBlockerValues = (values, effort) => {
    const parsedSet = parseBlockerTokens(values, effort);

    if (parsedSet.empty) {
        throw new Error('Blocked by cannot be empty.');
    }

    const legacyIndex = parsedSet.parsed.findIndex(blocker => blocker?.kind === 'issue' && blocker.syntax === 'legacy');

    if (legacyIndex >= 0) {
        throw new Error(`Blocked by cannot be parsed: ${parsedSet.meaningfulValues[legacyIndex]}.`);
    }

    const {blockers, duplicateNumber} = validateBlockerSet(parsedSet);

    if (duplicateNumber) {
        throw new Error(`Blocked by repeats issue ${duplicateNumber}.`);
    }

    return blockers;
};

/** @param {string[]} values @param {string} effort @returns {ParsedBlockerTokens} */
const parseBlockerTokens = (values, effort) => {
    const meaningfulValues = values.map((/** @type {string} */ value) => value.trim()).filter(Boolean);

    if (meaningfulValues.length === 0) {
        return {empty: true, meaningfulValues, parsed: []};
    }

    const parsed = meaningfulValues.map(value => parseBlockerToken(value, effort));
    return {empty: false, meaningfulValues, parsed};
};

/** @param {ParsedBlockerTokens} input @returns {ValidatedBlockerSet} */
const validateBlockerSet = ({empty, meaningfulValues, parsed}) => {
    if (empty) {
        return {blockers: [], duplicateNumber: null, empty, meaningfulValues};
    }

    const noneCount = parsed.filter(entry => entry === null).length;
    const blockers = parsed.filter((/** @returns {entry is IssueBlocker} */ entry) => entry?.kind === 'issue');
    const externalDependencies = parsed.filter(entry => entry?.kind === 'external-dependency');

    if (noneCount > 0 && blockers.length + externalDependencies.length > 0) {
        throw new Error('Blocked by cannot mix None with concrete blockers.');
    }

    if (noneCount > 0) {
        if (noneCount !== 1) {
            throw new Error('Blocked by repeats None.');
        }

        return {blockers: [], duplicateNumber: null, empty: false, meaningfulValues};
    }

    /** @type {Set<string>} */
    const numbers = new Set();
    /** @type {string | null} */
    let duplicateNumber = null;

    for (const blocker of blockers) {
        if (numbers.has(blocker.number)) {
            duplicateNumber ??= blocker.number;
        }

        numbers.add(blocker.number);
    }

    return {blockers, duplicateNumber, empty: false, meaningfulValues};
};

/** @param {IssueSection} section @param {string} effort @returns {IssueBlocker[]} */
const parseBlockerSection = (section, effort) => {
    const values = section.bodyLines
        .map((/** @type {string} */ line) => line.trim())
        .filter(Boolean)
        .map((/** @type {string} */ line) => {
            const match = /^[-*]\s+(.+)$/.exec(line);

            if (!match) {
                throw new Error(`Blocked by section requires bullet items: ${line}.`);
            }

            return match[1];
        });

    if (values.length === 0) {
        throw new Error('Blocked by section must contain a bullet item.');
    }

    return parseBlockerValues(values, effort);
};

const compareBlockers = (/** @type {IssueBlocker[]} */ left, /** @type {IssueBlocker[]} */ right) =>
    left.map((/** @type {IssueBlocker} */ blocker) => blocker.number).join(',') === right.map((/** @type {IssueBlocker} */ blocker) => blocker.number).join(',');

/** @param {string} text @param {{effort: string, effortNumber: string, number: string, sourceKey: string}} input @returns {IssueRecord} */
const parseIssueText = (text, {effort, effortNumber, number, sourceKey}) => {
    const {blockerSections, frontmatterEnd, heading, lines, metadata: indexedMetadata} = indexIssueText(text);

    if (!heading) {
        throw new Error('The issue has no first level-one heading.');
    }

    assertHeadingIsFirstRenderedContent(lines, frontmatterEnd, heading.index);

    const metadata = Object.fromEntries(Object.entries(indexedMetadata).map(([field, values]) => [
        field,
        values.filter(value => value.syntax === 'plain'),
    ]));

    if (metadata.type.length > 1) {
        throw new Error('Type is repeated.');
    }

    if (metadata.status.length > 1) {
        throw new Error('Status is repeated.');
    }

    const indexedAssociations = [...indexedMetadata.moduleImplementation, ...indexedMetadata.applicationSource];
    if (indexedMetadata.moduleImplementation.length > 1 || indexedMetadata.applicationSource.length > 1) {
        throw new Error('Application association field is repeated.');
    }
    if (indexedMetadata.moduleImplementation.length === 1 && indexedMetadata.applicationSource.length === 1) {
        throw new Error('Application association fields are mutually exclusive.');
    }
    if (indexedAssociations.some(field => field.syntax !== 'plain')) {
        throw new Error('Application association field must use canonical plain metadata syntax.');
    }

    const associationField = indexedAssociations[0];
    const associationMatch = associationField === undefined ? null : /^`(?<coordinate>[^`]+)`$/u.exec(associationField.value);
    const associationCoordinate = associationMatch?.groups?.coordinate ?? null;
    if (associationField !== undefined && (associationCoordinate === null || parseQualifiedIssueCoordinate(associationCoordinate) === null)) {
        throw new Error('Application association coordinate is malformed.');
    }
    if (associationField !== undefined
        && (metadata.status.length !== 1 || associationField.index !== metadata.status[0].index + 1)) {
        throw new Error('Application association field must immediately follow Status.');
    }

    const typeValue = metadata.type[0]?.value;
    const isWayfinder = typeValue !== undefined;

    if (isWayfinder && associationField !== undefined) {
        throw new Error('Wayfinder issue cannot contain an Application association field.');
    }

    if (isWayfinder && !WAYFINDER_TYPES.has(typeValue)) {
        throw new Error(`Unknown Wayfinder Type: ${typeValue || '(empty)'}.`);
    }

    const statusValue = metadata.status[0]?.value;

    if (isWayfinder) {
        if (statusValue !== undefined && !WAYFINDER_STATUSES.has(statusValue)) {
            throw new Error(`Invalid Wayfinder Status: ${statusValue || '(empty)'}.`);
        }
    } else {
        if (statusValue === undefined || statusValue.length === 0) {
            throw new Error('Implementation issue must have one non-empty Status.');
        }

        if (!IMPLEMENTATION_STATUSES.has(statusValue)) {
            throw new Error(`Unknown implementation Status: ${statusValue}.`);
        }
    }

    const sections = blockerSections;

    if (sections.length > 1) {
        throw new Error('Blocked by section is repeated.');
    }

    if (!isWayfinder && metadata.blockedBy.length > 0) {
        throw new Error('Implementation issue must use a Blocked by section.');
    }

    if (metadata.blockedBy.length > 1) {
        throw new Error('Blocked by is repeated.');
    }

    const sectionBlockers = sections.length === 1 ? parseBlockerSection(sections[0], effort) : null;
    const inlineBlockers = metadata.blockedBy.length === 1 ? parseBlockerValues(metadata.blockedBy[0].value.split(','), effort) : null;

    if (sectionBlockers && inlineBlockers && !compareBlockers(sectionBlockers, inlineBlockers)) {
        throw new Error('Blocked by section and field disagree.');
    }

    return {
        blockerRecords: [],
        blockers: (inlineBlockers ?? sectionBlockers ?? []).map(({kind, number, title}) => ({kind, number, title})),
        effortNumber,
        id: formatCanonicalArtifactId({effortNumber, issueNumber: number, kind: 'issue', qualifier: null}),
        kind: isWayfinder ? 'wayfinder' : indexedMetadata.moduleImplementation.length === 1 ? 'application-source' : 'implementation',
        number,
        sourceKey,
        status: statusValue ?? 'open',
        title: heading.title,
        ...(associationField === undefined || associationCoordinate === null ? {} : {
            association: {
                coordinate: associationCoordinate,
                kind: indexedMetadata.moduleImplementation.length === 1 ? 'module-implementation' : 'application-source',
            },
        }),
    };
};

/**
 * 判断 Markdown text 是否带有需要 updater 处理的 legacy Issue 结构。
 * 此检测只观察文本, 不决定 strict read 的 semantic validity。
 */
export const hasLegacyIssueShape = (/** @type {string} */ text) => {
    const normalized = normalizeText(text);

    if (findUnfencedLineIndexes(normalized.split('\n'), line => /^\*\*(?:Status|Type|Blocked by):\*\*/.test(line)).length > 0) {
        return true;
    }

    let index;

    try {
        index = indexIssueText(normalized);
    } catch {
        const lines = normalized.split('\n');
        index = {frontmatterEnd: -1, heading: findFirstHeading(lines, 0), lines};
    }

    const {frontmatterEnd, heading, lines} = index;

    if (!heading) {
        return false;
    }

    if (lines.slice(frontmatterEnd + 1, heading.index).some(line => line.trim().length > 0)) {
        return true;
    }

    const unfenced = (/** @type {string} */ prefix) => findUnfencedLineIndexes(lines, line => line.startsWith(prefix)).length > 0;
    return unfenced('Blocked by:') && !unfenced('Type:');
};

const normalizeOutput = (/** @type {string[]} */ lines) => `${lines.join('\n').replace(/\n+$/g, '')}\n`;

/** @param {string} value @param {RegExpExecArray} match */
const readPathTitle = (value, match) => {
    const suffix = value.slice(match.index + match[0].length).trim();

    if (suffix === '' || suffix === '`') {
        return null;
    }

    const title = /^`?\s*(?:—|-)\s+(.+)$/.exec(suffix);

    if (!title) {
        throw new Error(`Blocked by path suffix cannot be parsed: ${suffix}.`);
    }

    return title[1].trim();
};

/** @param {string[]} values @param {string} effort @returns {Array<ExternalDependency | IssueBlocker>} */
const parseLegacyBlockers = (values, effort) => {
    const parsedSet = parseBlockerTokens(values, effort);
    const {duplicateNumber, empty} = validateBlockerSet(parsedSet);

    if (empty) {
        return [];
    }

    if (duplicateNumber) {
        throw new Error('Blocked by repeats an issue.');
    }

    return parsedSet.parsed.filter((/** @returns {entry is ExternalDependency | IssueBlocker} */ entry) => entry !== null);
};

/** @param {MetadataField} field @param {string} effort @returns {Array<ExternalDependency | IssueBlocker>} */
const parseLegacyFieldBlockers = (field, effort) => {
    if (field.value.length === 0) {
        throw new Error('Blocked by cannot be empty.');
    }

    return parseLegacyBlockers(field.value.split(','), effort);
};

/** @param {IssueSection} section @param {string} effort @param {boolean} [allowNonBullet] @returns {Array<ExternalDependency | IssueBlocker>} */
const parseLegacySectionBlockers = (section, effort, allowNonBullet = false) => {
    const values = section.bodyLines.filter((/** @type {string} */ line) => line.trim().length > 0);

    if (values.length === 0) {
        throw new Error('Blocked by section cannot be empty.');
    }

    if (values.some((/** @type {string} */ line) => !/^[-*]\s+/.test(line.trim()))) {
        if (allowNonBullet && values.length === 1) {
            const normalized = values[0].trim();

            if (/^None\s+(?:—|-)\s+can start immediately\.?$/.test(normalized)) {
                return [];
            }

            const blocker = parseBlockerToken(normalized, effort);

            if (blocker === null) {
                throw new Error(`Blocked by cannot be parsed: ${normalized}.`);
            }
            if (blocker.kind === 'external-dependency') {
                throw new Error(`Blocked by cannot be migrated from a non-bullet External dependency: ${normalized}.`);
            }

            return [blocker];
        }

        throw new Error('Blocked by section contains a non-bullet value.');
    }

    return parseLegacyBlockers(values, effort);
};

/** @param {string[]} lines @param {Set<number>} indexes @param {IssueSection[]} ranges */
const removeMigrationStructure = (lines, indexes, ranges) => lines.filter((/** @type {string} */ line, /** @type {number} */ index) =>
    !indexes.has(index) && !ranges.some((/** @type {{ start: number; end: number; }} */ range) => index >= range.start && index < range.end),
);

/** @param {string[]} lines @returns {{heading: IssueHeading, lines: string[], preamble: string[]}} */
const splitPreamble = lines => {
    const frontmatterEnd = findFrontmatterEnd(lines);
    const heading = findFirstHeading(lines, frontmatterEnd + 1);

    if (!heading) {
        throw new Error('The issue has no readable first level-one heading.');
    }

    const preamble = lines.slice(frontmatterEnd + 1, heading.index).filter((/** @type {string} */ line) => line.trim().length > 0);
    const remaining = [...lines.slice(0, frontmatterEnd + 1), ...lines.slice(heading.index)];
    const movedHeading = findFirstHeading(remaining, frontmatterEnd + 1);
    if (movedHeading === null) throw new Error('The moved issue heading is missing.');
    return {heading: movedHeading, lines: remaining, preamble};
};

/** @param {string[]} lines @param {IssueHeading} heading @param {string[]} metadata @param {string[]} preamble */
const insertAfterHeading = (lines, heading, metadata, preamble) => {
    const body = lines.slice(heading.index + 1);

    while (body[0] === '') {
        body.shift();
    }

    const inserted = [...metadata, ...(preamble.length > 0 ? ['', ...preamble] : [])];
    return [
        ...lines.slice(0, heading.index + 1),
        ...(inserted.length > 0 ? ['', ...inserted] : []),
        ...(body.length > 0 ? ['', ...body] : []),
    ];
};

/** @param {string[]} lines @param {Array<ExternalDependency | IssueBlocker>} blockers */
const insertBlockerSection = (lines, blockers) => {
    /** @type {number[]} */
    const sectionIndexes = [];
    let fenced = false;

    for (const [index, line] of lines.entries()) {
        if (isFence(line)) {
            fenced = !fenced;
            continue;
        }

        if (!fenced && /^##\s+/.test(line)) {
            sectionIndexes.push(index);
        }
    }

    const acceptance = sectionIndexes.find(index => lines[index].trim() === '## Acceptance criteria') ?? -1;
    const comments = sectionIndexes.find(index => lines[index].trim() === '## Comments') ?? -1;
    let insertion = lines.length;

    if (acceptance >= 0) {
        insertion = sectionIndexes.find(index => index > acceptance) ?? lines.length;
    } else if (comments >= 0) {
        insertion = comments;
    }

    const before = lines.slice(0, insertion);
    const after = lines.slice(insertion);

    while (before.at(-1) === '') {
        before.pop();
    }
    while (after[0] === '') {
        after.shift();
    }

    return [
        ...before,
        '',
        '## Blocked by',
        '',
        ...(blockers.length === 0
            ? ['- None - can start immediately']
            : blockers.map(blocker => blocker.kind === 'external-dependency'
                ? `- External dependency: \`${blocker.coordinate}\` - ${blocker.description}`
                : `- ${blocker.number}${blocker.title ? ` - ${blocker.title}` : ''}`)),
        ...(after.length > 0 ? ['', ...after] : []),
    ];
};

/** @param {MetadataField[]} blockerFields @param {IssueSection[]} sections @param {string} repeatedMessage */
const assertMigrationBlockerLocations = (blockerFields, sections, repeatedMessage) => {
    if (blockerFields.length > 1 || sections.length > 1) {
        throw new Error(repeatedMessage);
    }
    if (blockerFields.length === 1 && sections.length === 1) {
        throw new Error('Blocked by cannot mix inline and section formats.');
    }
};

/** @param {{lines: string[], typeFields: MetadataField[], statusFields: MetadataField[], blockerFields: MetadataField[], sections: IssueSection[], effort: string}} input */
const migrateWayfinderText = ({lines, typeFields, statusFields, blockerFields, sections, effort}) => {
    if (typeFields.length !== 1 || !WAYFINDER_TYPES.has(typeFields[0]?.value)) {
        throw new Error('Wayfinder Type must be one supported non-empty value.');
    }
    if (statusFields.length > 1 || (statusFields.length === 1 && statusFields[0].value.length === 0)) {
        throw new Error('Wayfinder Status is repeated or empty.');
    }
    assertMigrationBlockerLocations(blockerFields, sections, 'Wayfinder Blocked by is repeated.');

    const parsedBlockers = blockerFields.length === 1
        ? parseLegacyFieldBlockers(blockerFields[0], effort)
        : sections.length === 1
            ? parseLegacySectionBlockers(sections[0], effort)
            : [];
    if (parsedBlockers.some(blocker => blocker.kind === 'external-dependency')) {
        throw new Error('Wayfinder Blocked by cannot contain an External dependency.');
    }
    const blockers = parsedBlockers.filter((/** @returns {blocker is IssueBlocker} */ blocker) => blocker.kind === 'issue');
    const indexes = new Set([...typeFields, ...statusFields, ...blockerFields].map(field => field.index));
    const moved = splitPreamble(removeMigrationStructure(lines, indexes, sections));
    const metadata = [
        `Type: ${typeFields[0].value}`,
        ...(statusFields.length === 1 ? [`Status: ${statusFields[0].value}`] : []),
        ...(blockerFields.length === 1 || sections.length === 1
            ? [`Blocked by: ${blockers.length === 0 ? 'None' : blockers.map(blocker => blocker.number).join(', ')}`]
            : []),
    ];

    return normalizeOutput(insertAfterHeading(moved.lines, moved.heading, metadata, moved.preamble));
};

/** @param {IssueBlocker} blocker @param {Map<string, string[]>} titles @returns {IssueBlocker} */
const resolveImplementationBlocker = (blocker, titles) => {
    if (blocker.title) {
        return blocker;
    }

    const candidates = titles.get(blocker.number) ?? [];

    if (candidates.length > 1) {
        throw new Error(`Blocked by title cannot be determined because issue ${blocker.number} is repeated.`);
    }

    return {...blocker, title: candidates[0] ?? null};
};

/** @param {{lines: string[], statusFields: MetadataField[], blockerFields: MetadataField[], sections: IssueSection[], effort: string, titles: Map<string, string[]>}} input */
const migrateImplementationText = ({lines, statusFields, blockerFields, sections, effort, titles}) => {
    if (statusFields.length !== 1 || statusFields[0].value.length === 0) {
        throw new Error('Implementation issue must have one non-empty Status.');
    }
    assertMigrationBlockerLocations(blockerFields, sections, 'Blocked by is repeated.');

    const fieldBlockers = blockerFields.length === 1 ? parseLegacyFieldBlockers(blockerFields[0], effort) : null;
    const sectionBlockers = sections.length === 1 ? parseLegacySectionBlockers(sections[0], effort, true) : null;
    const blockers = (fieldBlockers ?? sectionBlockers ?? []).map(blocker => blocker.kind === 'issue'
        ? resolveImplementationBlocker(blocker, titles)
        : blocker);
    const indexes = new Set([...statusFields, ...blockerFields].map(field => field.index));
    const moved = splitPreamble(removeMigrationStructure(lines, indexes, sections));
    const withMetadata = insertAfterHeading(moved.lines, moved.heading, [`Status: ${statusFields[0].value}`], moved.preamble);
    return normalizeOutput(insertBlockerSection(withMetadata, blockers));
};

/** @param {string} text @param {string} effort @param {Map<string, string[]>} titles */
const migrateIssueText = (text, effort, titles) => {
    const {blockerSections, heading, lines, metadata, normalized} = indexIssueText(text);

    if (!heading) {
        throw new Error('The issue has no readable first level-one heading.');
    }

    const typeFields = metadata.type;
    const statusFields = metadata.status;
    const blockerFields = metadata.blockedBy;
    const sections = blockerSections;
    const migrated = typeFields.length > 0
        ? migrateWayfinderText({lines, typeFields, statusFields, blockerFields, sections, effort})
        : migrateImplementationText({lines, statusFields, blockerFields, sections, effort, titles});

    return {changed: migrated !== normalized, text: migrated};
};

/**
 * 把同一 effort 的一组 legacy 或 canonical Issue Markdown documents 转换为 canonical text。
 * 函数不读取 filesystem, 通过 opaque sourceKey 返回每份成功 output 或首个确定性 diagnostic, 并用整组 H1 titles 补齐 implementation blocker title。
 */
/** @param {IssueDocumentInput[]} documents @returns {{diagnostics: IssueMigrationDiagnostic[], outputs: IssueMigrationOutput[]}} */
export const migrateIssueDocuments = documents => {
    /** @type {IssueMigrationDiagnostic[]} */
    const diagnostics = [];
    /** @type {IssueMigrationOutput[]} */
    const outputs = [];
    /** @type {Map<string, string[]>} */
    const titles = new Map();

    for (const document of documents) {
        try {
            const lines = normalizeText(document.text).split('\n');
            const frontmatterEnd = findFrontmatterEnd(lines);
            const heading = findFirstHeading(lines, frontmatterEnd + 1);

            if (heading) {
                titles.set(document.number, [...(titles.get(document.number) ?? []), heading.title]);
            }
        } catch {
            // 每份文档的确定性结构错误由实际 migration pass 关联 sourceKey。
        }
    }

    for (const document of documents) {
        try {
            const migration = migrateIssueText(document.text, document.effort, titles);
            outputs.push({sourceKey: document.sourceKey, ...migration});
        } catch (error) {
            diagnostics.push({message: error instanceof Error ? error.message : String(error), sourceKey: document.sourceKey});
        }
    }

    diagnostics.sort((left, right) =>
        compareStrings(left.sourceKey, right.sourceKey) || compareStrings(left.message, right.message),
    );

    return {diagnostics, outputs};
};

/** @param {IssueDiagnostic[]} diagnostics @param {string} sourceKey @param {string} message @param {{unresolvedReference?: {effortNumber: string, number: string}}} [details] */
const addDiagnostic = (diagnostics, sourceKey, message, details = {}) => {
    diagnostics.push({message, sourceKey, ...details});
};

/** @param {IssueDiagnostic[]} diagnostics @param {Set<string>} badRecordIds @param {IssueRecord} record @param {string} message */
const addRecordDiagnostic = (diagnostics, badRecordIds, record, message) => {
    badRecordIds.add(record.id);
    addDiagnostic(diagnostics, record.sourceKey, message);
};

/** @param {IssueSource[]} sources @param {IssueDiagnostic[]} diagnostics @param {Set<string>} badRecordIds @returns {Map<string, IssueSource>} */
const indexIssueSources = (sources, diagnostics, badRecordIds) => {
    /** @type {Map<string, IssueSource>} */
    const sourceByNumber = new Map();

    for (const source of sources) {
        const key = `${source.effortNumber}:${source.number}`;

        if (sourceByNumber.has(key)) {
            const previous = sourceByNumber.get(key);
            if (previous === undefined) throw new Error(`Indexed issue source is missing: ${key}.`);
            addDiagnostic(diagnostics, source.sourceKey, `Duplicate issue number ${source.number} in effort ${source.effortNumber}.`);
            addDiagnostic(diagnostics, previous.sourceKey, `Duplicate issue number ${source.number} in effort ${source.effortNumber}.`);
            if (source.record) {
                badRecordIds.add(source.record.id);
            }
            if (previous.record) {
                badRecordIds.add(previous.record.id);
            }
            continue;
        }

        sourceByNumber.set(key, source);
    }

    return sourceByNumber;
};

/** @param {IssueRecord[]} records @param {Map<string, IssueSource>} sourceByNumber @param {IssueDiagnostic[]} diagnostics @param {Set<string>} badRecordIds */
const linkBlockerRecords = (records, sourceByNumber, diagnostics, badRecordIds) => {
    for (const record of records) {
        record.blockerRecords = [];

        for (const blocker of record.blockers) {
            const source = sourceByNumber.get(`${record.effortNumber}:${blocker.number}`);

            if (!source) {
                badRecordIds.add(record.id);
                addDiagnostic(diagnostics, record.sourceKey, `Blocked by references unknown issue ${blocker.number}.`, {
                    unresolvedReference: {effortNumber: record.effortNumber, number: blocker.number},
                });
                continue;
            }

            if (!source.record) {
                addRecordDiagnostic(diagnostics, badRecordIds, record, `Blocked by references malformed issue ${blocker.number}.`);
                continue;
            }

            record.blockerRecords.push(source.record);
        }
    }
};

/** @param {IssueRecord[]} records @param {Set<string>} badRecordIds @returns {IssueRecord[][]} */
const findBlockingCycles = (records, badRecordIds) => {
    /** @type {Map<string, number>} */
    const state = new Map();
    /** @type {IssueRecord[]} */
    const stack = [];
    /** @type {Map<string, IssueRecord[]>} */
    const cycles = new Map();

    const visit = (/** @type {IssueRecord} */ record) => {
        if (state.get(record.id) === 2 || badRecordIds.has(record.id)) {
            return;
        }

        if (state.get(record.id) === 1) {
            const cycleStart = stack.findIndex(item => item.id === record.id);
            const cycle = stack.slice(cycleStart);
            cycles.set(cycle.map(item => item.id).sort().join('|'), cycle);
            return;
        }

        state.set(record.id, 1);
        stack.push(record);

        for (const blocker of record.blockerRecords) {
            visit(blocker);
        }

        stack.pop();
        state.set(record.id, 2);
    };

    for (const record of records) {
        visit(record);
    }

    return [...cycles.values()];
};

/** @param {IssueRecord[][]} cycles @param {IssueDiagnostic[]} diagnostics @param {Set<string>} badRecordIds */
const diagnoseBlockingCycles = (cycles, diagnostics, badRecordIds) => {
    for (const cycle of cycles) {
        const cycleIds = cycle.map(record => record.id).sort();

        for (const record of cycle) {
            addRecordDiagnostic(diagnostics, badRecordIds, record, `Blocking cycle detected: ${cycleIds.join(', ')}.`);
        }
    }
};

/** @param {IssueRecord[]} records @param {IssueDiagnostic[]} diagnostics @param {Set<string>} badRecordIds */
const propagateMalformedBlockers = (records, diagnostics, badRecordIds) => {
    let changed = true;

    while (changed) {
        changed = false;

        for (const record of records) {
            if (badRecordIds.has(record.id)) {
                continue;
            }

            const malformedBlocker = record.blockerRecords.find(blocker => badRecordIds.has(blocker.id));

            if (malformedBlocker) {
                addRecordDiagnostic(diagnostics, badRecordIds, record, `Blocked by references malformed issue ${malformedBlocker.id}.`);
                changed = true;
            }
        }
    }
};

/** @param {IssueRecord[]} records @param {IssueSource[]} sources @param {IssueDiagnostic[]} diagnostics @returns {Set<string>} */
const resolveBlockers = (records, sources, diagnostics) => {
    /** @type {Set<string>} */
    const badRecordIds = new Set();
    const sourceByNumber = indexIssueSources(sources, diagnostics, badRecordIds);

    linkBlockerRecords(records, sourceByNumber, diagnostics, badRecordIds);
    diagnoseBlockingCycles(findBlockingCycles(records, badRecordIds), diagnostics, badRecordIds);
    propagateMalformedBlockers(records, diagnostics, badRecordIds);

    return badRecordIds;
};

/**
 * 严格读取同一 effort 的一组 Issue Markdown documents。
 * 每个 input 使用 opaque sourceKey 关联 record 或 diagnostic; malformed documents 和 graph-invalid records 不会作为 partial records 返回。
 * 函数不读取 filesystem, 不解释 sourceKey, 并把外部世界中可能存在的缺失 blocker 作为 structured unresolvedReference 返回给 caller 分类。
 */
/** @param {IssueDocumentInput[]} documents @returns {{diagnostics: IssueDiagnostic[], legacyDetected: boolean, records: IssueRecord[]}} */
export const readIssueDocuments = documents => {
    /** @type {IssueDiagnostic[]} */
    const diagnostics = [];
    /** @type {IssueRecord[]} */
    const records = [];
    /** @type {IssueSource[]} */
    const sources = [];
    let legacyDetected = false;

    for (const document of documents) {
        legacyDetected ||= hasLegacyIssueShape(document.text);

        try {
            const effortNumber = ARTIFACT_EFFORT_DIRECTORY_PATTERN.exec(document.effort)?.groups?.number;
            if (effortNumber === undefined) throw new Error('Issue document effort must use NNNN-<slug>.');
            /** @type {IssueSource} */
            const source = {
                effortNumber,
                number: document.number,
                record: null,
                sourceKey: document.sourceKey,
            };
            sources.push(source);
            const record = parseIssueText(document.text, {
                effort: document.effort,
                effortNumber,
                number: document.number,
                sourceKey: document.sourceKey,
            });
            source.record = record;
            records.push(record);
        } catch (error) {
            addDiagnostic(diagnostics, document.sourceKey, error instanceof Error ? error.message : String(error));
        }
    }

    const badRecordIds = resolveBlockers(records, sources, diagnostics);

    diagnostics.sort((left, right) =>
        compareStrings(left.sourceKey, right.sourceKey) || compareStrings(left.message, right.message),
    );

    return {diagnostics, legacyDetected, records: records.filter(record => !badRecordIds.has(record.id))};
};

export const isIssueExecutable = (/** @type {{ kind: string; status: string; }} */ record) =>
    record.kind === 'implementation'
        ? record.status === 'ready-for-agent' || record.status === 'ready-for-human'
        : record.kind === 'wayfinder' && record.status === 'open';

export const isIssueBlocked = (/** @type {{blockerRecords?: Array<{status: string}>}} */ record) =>
    record.blockerRecords?.some((/** @type {{ status: string; }} */ blocker) => !TERMINAL_STATUSES.has(blocker.status)) ?? false;
