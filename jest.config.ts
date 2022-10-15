import type { Config } from "@jest/types";

const jestConfig: Config.InitialOptions = {
  preset: "ts-jest",
  testEnvironment: "node",
  verbose: true,
  clearMocks: true,
  moduleFileExtensions: ["js", "ts"],
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.test.json" }],
  },
  silent: true,
  projects: [
    {
      displayName: "generate-dotenv",
      testMatch: ["<rootDir>/packages/**/*.test.ts"],
      transform: {
        "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.spec.json" }],
      },
    },
  ],
};

export default jestConfig;
