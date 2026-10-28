import {buildCsv} from './csv-format.mjs';
import {prepareFilter, selectRows} from './export-filter.mjs';
import {HISTORY_COLUMNS, RESERVATION_COLUMNS, ROOM_COLUMNS} from './reservation-columns.mjs';

const normalizeRequestKey = (key) => (typeof key === 'string' && key.trim() !== '' ? key.trim().toLowerCase() : null);

const deliveryNotice = (job) => Object.freeze({exportId: job.id, rowCount: job.rowCount, csv: job.csv});

export const exportRecords = ({columns, rows}) => buildCsv(columns, rows);

const byId = (left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

export const exportRooms = ({rooms}) => buildCsv(ROOM_COLUMNS, rooms.filter((room) => room.active === true).sort(byId));

export const exportHistory = async ({request, source}) => {
    const rows = selectRows(prepareFilter(request), await source.list()).flatMap((reservation) => (
        reservation.history.map((entry) => ({reservationId: reservation.id, state: entry.state, at: entry.at}))
    ));
    return buildCsv(HISTORY_COLUMNS, rows);
};

export const exportReservations = async ({deliver, nextId, now, request, source, store}) => {
    const filter = prepareFilter(request);
    const requestKey = normalizeRequestKey(request.requestKey);
    if (requestKey !== null) {
        const existing = await store.findByRequestKey(requestKey);
        if (existing !== null) return existing;
    }
    const rows = selectRows(filter, await source.list());
    const csv = buildCsv(RESERVATION_COLUMNS, rows);
    const job = Object.freeze({
        id: nextId(),
        requestKey,
        createdAt: now(),
        from: filter.from,
        until: filter.until,
        states: filter.states,
        buildingId: filter.buildingId,
        columns: RESERVATION_COLUMNS.map((column) => column.name),
        rowCount: rows.length,
        csv,
    });
    await store.save(job);
    await deliver(deliveryNotice(job));
    return job;
};
