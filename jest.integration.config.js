module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.integration-spec.ts'],
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
};
