const normalizeReader = (reader) => ({
    ...reader,
    id: reader.id.trim(),
    buildingId: reader.buildingId.trim(),
});

export const loadReaders = (rawReaders) => rawReaders.map(normalizeReader);

export const isInstalledIn = (reader, buildingId) => reader.active === true && reader.buildingId === buildingId;

export const findReader = (readers, event) => readers.find((reader) => (
    reader.id === event.readerId && isInstalledIn(reader, event.buildingId)
)) ?? null;

export const requireReader = (readers, event) => {
    const reader = findReader(readers, event);
    if (reader === null) throw new Error(`badge reader ${event.readerId} is unknown`);
    return reader;
};
