module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: ['src/**/*.ts', '!src/types/**/*.d.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/.homeybuild/'],
};
