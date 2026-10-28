export const createReportArchive = (initialReports = []) => {
    const reports = new Map(initialReports.map((report) => [report.id, report]));
    let writes = Promise.resolve();

    return Object.freeze({
        findByReportKey: async (reportKey) => (
            [...reports.values()].find((report) => report.reportKey === reportKey) ?? null
        ),
        list: async () => [...reports.values()].sort((left, right) => left.generatedAt - right.generatedAt),
        save: (report) => {
            writes = writes.then(() => {
                reports.set(report.id, report);
                return report;
            });
            return writes;
        },
    });
};
