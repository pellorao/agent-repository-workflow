export const createScheduleStore = ({schedules = [], closures = []} = {}) => {
    const byBuilding = new Map(schedules.map((schedule) => [schedule.buildingId, schedule]));
    const closureRecords = new Map(closures.map((closure) => [closure.id, closure]));
    let writes = Promise.resolve();

    const enqueue = (work) => {
        writes = writes.then(work);
        return writes;
    };

    return Object.freeze({
        findSchedule: async (buildingId) => byBuilding.get(buildingId) ?? null,
        findClosure: async (closureId) => closureRecords.get(closureId) ?? null,
        listClosures: async (buildingId) => [...closureRecords.values()].filter((closure) => closure.buildingId === buildingId),
        saveSchedule: (schedule) => enqueue(() => {
            byBuilding.set(schedule.buildingId, schedule);
            return schedule;
        }),
        saveClosure: (closure) => enqueue(() => {
            closureRecords.set(closure.id, closure);
            return closure;
        }),
    });
};
