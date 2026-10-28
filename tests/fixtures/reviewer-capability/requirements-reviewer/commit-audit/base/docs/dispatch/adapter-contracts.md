# Geocoder Contract

- `geocoder.lookup(address)` resolves to the `{lat, lon}` point of a known address.
- `geocoder.distance(from, to)` resolves to the road distance in metres between two points, and rejects when no road connects them.

# Weighing Contract

- `scale.read(packageId)` resolves to the measured weight of that package.
- `weighbridge.read(vehicleId)` resolves to the measured load limit of that vehicle in kilograms.
