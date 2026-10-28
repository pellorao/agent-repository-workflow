import {saveThenNotify} from '../platform/records.mjs';
import {contributions} from './counting-rules.mjs';
import {reportNotice} from './report-notice.mjs';
import {prepareWindow, toWholeMinutes, windowLength} from './report-window.mjs';
import {loadDirectory, normalizeAmenities} from './room-directory.mjs';
import {peakConcurrency, seatDuration, seatUtilization, totalDuration} from './utilization-math.mjs';

const roomRow = (room, parts, length) => Object.freeze({
    roomId: room.id,
    buildingId: room.buildingId,
    capacity: room.capacity,
    reservations: parts.length,
    bookedMinutes: toWholeMinutes(totalDuration(parts)),
    seatUtilization: seatUtilization(seatDuration(parts), room.capacity, length),
});

const busiestRoom = (roomRows) => {
    const ranked = roomRows
        .filter((row) => row.bookedMinutes > 0)
        .sort((left, right) => right.bookedMinutes - left.bookedMinutes || (left.roomId < right.roomId ? -1 : 1));
    return ranked[0]?.roomId ?? null;
};

const buildingRow = (buildingId, rooms, roomRows, parts, length) => {
    const capacity = rooms.reduce((sum, room) => sum + room.capacity, 0);
    return Object.freeze({
        buildingId,
        rooms: rooms.length,
        capacity,
        bookedMinutes: roomRows.reduce((sum, row) => sum + row.bookedMinutes, 0),
        busiestRoomId: busiestRoom(roomRows),
        seatUtilization: seatUtilization(seatDuration(parts), capacity, length),
        ...peakConcurrency(parts),
    });
};

export const buildReport = ({amenities, at, from, rooms, reservations, until}) => {
    const window = prepareWindow({from, until});
    const length = windowLength(window);
    const wanted = normalizeAmenities(amenities);
    const directory = loadDirectory(rooms, wanted);
    const parts = contributions(reservations, directory, window, at);
    const roomRows = directory.rooms.map((room) => roomRow(room, parts.filter((part) => part.roomId === room.id), length));
    const buildingRows = directory.buildingIds.map((buildingId) => buildingRow(
        buildingId,
        directory.rooms.filter((room) => room.buildingId === buildingId),
        roomRows.filter((row) => row.buildingId === buildingId),
        parts.filter((part) => part.buildingId === buildingId),
        length,
    ));
    return {from, until, amenities: wanted, rooms: roomRows, buildings: buildingRows};
};

const normalizeReportKey = (key) => (typeof key === 'string' && key.trim() !== '' ? key.trim().toLowerCase() : null);

export const generateUtilizationReport = async ({archive, nextId, now, publish, request, rooms, source}) => {
    const reportKey = normalizeReportKey(request.reportKey);
    if (reportKey !== null) {
        const existing = await archive.findByReportKey(reportKey);
        if (existing !== null) return existing;
    }
    const at = now();
    const body = buildReport({...request, at, rooms, reservations: await source.list()});
    const report = Object.freeze({id: nextId(), reportKey, generatedAt: at, ...body});
    return saveThenNotify(archive, (saved) => publish(reportNotice(saved)), report);
};
