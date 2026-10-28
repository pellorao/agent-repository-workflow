import {accessWindow} from './policy.mjs';

export const confirmationNotice = (reservation) => {
    const window = accessWindow(reservation);
    return Object.freeze({reservationId: reservation.id, accessFrom: window.startAt, accessUntil: window.endAt});
};

export const cancellationNotice = (reservation) => Object.freeze({
    reservationId: reservation.id,
    canceledAt: reservation.canceledAt,
    fee: reservation.fee,
});

export const persistAndNotify = async (store, send, reservation) => {
    const saved = await store.save(reservation);
    await send(reservation);
    return saved;
};
