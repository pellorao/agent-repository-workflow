export const createExportStore = (initialJobs = []) => {
    const jobs = new Map(initialJobs.map((job) => [job.id, job]));
    let writes = Promise.resolve();

    return Object.freeze({
        findByRequestKey: async (requestKey) => [...jobs.values()].find((job) => job.requestKey === requestKey) ?? null,
        list: async () => [...jobs.values()],
        save: (job) => {
            writes = writes.then(() => {
                jobs.set(job.id, job);
                return job;
            });
            return writes;
        },
    });
};
