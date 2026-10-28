export const reportNotice = (report) => Object.freeze({
    reportId: report.id,
    generatedAt: report.generatedAt,
    from: report.from,
    until: report.until,
    buildings: report.buildings.map((building) => building.buildingId),
});

export const archiveAndNotify = async (archive, publish, report) => {
    const saved = await archive.save(report);
    await publish(reportNotice(saved));
    return saved;
};
