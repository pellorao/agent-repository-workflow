export const reportNotice = (report) => Object.freeze({
    reportId: report.id,
    generatedAt: report.generatedAt,
    from: report.from,
    until: report.until,
    buildings: report.buildings.map((building) => building.buildingId),
});
