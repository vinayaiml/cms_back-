import { Test } from "@nestjs/testing";
import { Reflector } from "@nestjs/core";

describe("AppModule", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      JWT_SECRET: "test-jwt-secret-12345678901234567890",
      LICENSE_SECRET_KEY: "test-license-secret-12345678901234567890",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/whizrobot_test",
      CORS_ALLOWED_ORIGINS: "http://localhost:3000",
      REDIS_ENABLED: "false",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("compiles the full application module wiring", async () => {
    const { AppModule } = await import("./app.module");
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      providers: [Reflector],
    }).compile();

    await moduleRef.close();
  });
});
