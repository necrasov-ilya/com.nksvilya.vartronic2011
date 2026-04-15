const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function readDirectoryJson(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return [];
  }

  return fs
    .readdirSync(absolutePath)
    .filter(fileName => fileName.endsWith('.json'))
    .sort()
    .map(fileName => ({
      id: path.basename(fileName, '.json'),
      payload: readJson(path.join(relativePath, fileName)),
    }));
}

function composeFlow() {
  const sections = ['actions', 'conditions', 'triggers'];
  const flow = {};

  for (const section of sections) {
    const cards = readDirectoryJson(path.join('.homeycompose', 'flow', section))
      .map(({ id, payload }) => ({
        id,
        ...payload,
      }));

    if (cards.length > 0) {
      flow[section] = cards;
    }
  }

  return flow;
}

function composeCapabilities() {
  const capabilities = {};

  for (const { id, payload } of readDirectoryJson(path.join('.homeycompose', 'capabilities'))) {
    capabilities[id] = payload;
  }

  return capabilities;
}

function composeDrivers() {
  const driversRoot = path.join(root, '.homeycompose', 'drivers');
  if (!fs.existsSync(driversRoot)) {
    return [];
  }

  return fs
    .readdirSync(driversRoot)
    .sort()
    .map(driverId => {
      const driverManifest = readJson(path.join('.homeycompose', 'drivers', driverId, 'driver.compose.json'));
      const driverTargetDir = path.join(root, 'drivers', driverId);
      fs.mkdirSync(driverTargetDir, { recursive: true });
      fs.writeFileSync(
        path.join(driverTargetDir, 'driver.compose.json'),
        `${JSON.stringify(driverManifest, null, 2)}\n`,
        'utf8',
      );

      return {
        id: driverId,
        ...driverManifest,
      };
    });
}

function generateManifest() {
  const manifest = {
    _comment: 'This file is generated. Please edit .homeycompose/* instead.',
    ...readJson(path.join('.homeycompose', 'app.json')),
  };

  const capabilities = composeCapabilities();
  const flow = composeFlow();
  const drivers = composeDrivers();

  if (Object.keys(capabilities).length > 0) {
    manifest.capabilities = capabilities;
  }

  if (Object.keys(flow).length > 0) {
    manifest.flow = flow;
  }

  if (drivers.length > 0) {
    manifest.drivers = drivers;
  }

  return manifest;
}

fs.writeFileSync(
  path.join(root, 'app.json'),
  `${JSON.stringify(generateManifest(), null, 2)}\n`,
  'utf8',
);
