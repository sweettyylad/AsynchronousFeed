// Integration & e2e tests: test/**/*.int-spec.ts, test/**/*.e2e-spec.ts (Testcontainers)
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.int-spec.ts', '<rootDir>/test/**/*.e2e-spec.ts'],
  passWithNoTests: true,
  testTimeout: 120000,
};
