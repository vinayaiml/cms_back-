import { existsSync, readFileSync } from "fs";
import { join } from "path";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml: any = require("js-yaml");

describe("CMS-81 Robot OpenAPI Contract Validation Suite", () => {
  let openapi: any;

  beforeAll(() => {
    const candidatePaths = [
      join(__dirname, "../../../docs/api/openapi.yaml"),
      join(__dirname, "../../../../docs/api/openapi.yaml"),
    ];
    const openApiPath = candidatePaths.find((path) => existsSync(path));
    if (!openApiPath) {
      throw new Error("OpenAPI contract not found");
    }
    const rawYaml = readFileSync(openApiPath, "utf8");
    openapi = yaml.load(rawYaml) as any;
  });

  const requiredRobotIdentityPaths = [
    {
      path: "/v1/robot/identity/enrollments",
      method: "post",
      operationId: "enrollRobotIdentity",
      expectedStatusCodes: ["201", "400", "401", "403", "429", "500"],
    },
    {
      path: "/v1/robot/identity/gallery",
      method: "get",
      operationId: "getRobotIdentityGallery",
      expectedStatusCodes: ["200", "304", "401", "403", "500"],
    },
    {
      path: "/v1/robot/identity/{identityId}/templates",
      method: "post",
      operationId: "addRobotIdentityTemplate",
      expectedStatusCodes: ["201", "400", "401", "403", "404", "429", "500"],
    },
    {
      path: "/v1/robot/identity/feedback",
      method: "post",
      operationId: "submitRobotIdentityFeedback",
      expectedStatusCodes: ["201", "400", "401", "403", "404", "429", "500"],
    },
    {
      path: "/v1/robot/identity/models/{modelId}",
      method: "get",
      operationId: "getRobotRecognitionModel",
      expectedStatusCodes: ["200", "401", "403", "404", "500"],
    },
    {
      path: "/v1/robot/identity/models/{modelId}/download",
      method: "get",
      operationId: "downloadRobotRecognitionModel",
      expectedStatusCodes: ["200", "401", "403", "404", "500"],
    },
  ];

  it("contains all required /v1/robot/identity/* endpoint paths in openapi.yaml", () => {
    expect(openapi).toBeDefined();
    expect(openapi.paths).toBeDefined();

    for (const item of requiredRobotIdentityPaths) {
      const pathDef = openapi.paths[item.path];
      expect(pathDef).toBeDefined();
      expect(pathDef[item.method]).toBeDefined();
      expect(pathDef[item.method].operationId).toBe(item.operationId);
      expect(pathDef[item.method].tags).toContain("Robot");
    }
  });

  it("enforces robotBearerAuth security for every robot identity path", () => {
    for (const item of requiredRobotIdentityPaths) {
      const operation = openapi.paths[item.path][item.method];
      expect(operation.security).toEqual(
        expect.arrayContaining([{ robotBearerAuth: [] }]),
      );
    }
  });

  it("defines standard and error HTTP status codes for every robot identity path", () => {
    for (const item of requiredRobotIdentityPaths) {
      const operation = openapi.paths[item.path][item.method];
      const responses = operation.responses;
      expect(responses).toBeDefined();

      for (const code of item.expectedStatusCodes) {
        expect(responses[code]).toBeDefined();
      }
    }
  });

  it("defines required schemas under components/schemas", () => {
    const schemas = openapi.components?.schemas;
    expect(schemas).toBeDefined();

    expect(schemas.RobotIdentityEnrollmentRequest).toBeDefined();
    expect(schemas.RobotIdentityGalleryDeltaResponse).toBeDefined();
    expect(schemas.RobotIdentityGalleryUpsertItem).toBeDefined();
    expect(schemas.RobotIdentityGalleryDeletionItem).toBeDefined();
    expect(schemas.RobotIdentityTemplateRequest).toBeDefined();
    expect(schemas.RobotIdentityTemplateResponse).toBeDefined();
    expect(schemas.RobotIdentityFeedbackRequest).toBeDefined();
    expect(schemas.RobotIdentityFeedbackResponse).toBeDefined();
    expect(schemas.RobotRecognitionModelResponse).toBeDefined();
    expect(schemas.RobotRecognitionModelDownloadResponse).toBeDefined();
    expect(schemas.IdentityEmbeddingRecord).toBeDefined();
  });

  it("defines examples covering success, replay/idempotency, locked/inactive, unauthorized, rate limit, and invalid model/token", () => {
    const enrollPost = openapi.paths["/v1/robot/identity/enrollments"].post;
    expect(enrollPost.requestBody.content["application/json"].examples.success).toBeDefined();
    expect(enrollPost.requestBody.content["application/json"].examples.replayIdempotent).toBeDefined();
    expect(enrollPost.responses["400"].content["application/json"].examples.invalidModel).toBeDefined();
    expect(enrollPost.responses["403"].content["application/json"].examples.inactiveOrg).toBeDefined();
    expect(enrollPost.responses["403"].content["application/json"].examples.inactiveLicense).toBeDefined();
    expect(enrollPost.responses["429"].content["application/json"].examples.rateLimitExceeded).toBeDefined();

    const galleryGet = openapi.paths["/v1/robot/identity/gallery"].get;
    expect(galleryGet.responses["200"].content["application/json"].examples.success).toBeDefined();
    expect(galleryGet.responses["304"]).toBeDefined();

    const tmplPost = openapi.paths["/v1/robot/identity/{identityId}/templates"].post;
    expect(tmplPost.responses["201"].content["application/json"].examples.success).toBeDefined();
    expect(tmplPost.responses["400"].content["application/json"].examples.belowThreshold).toBeDefined();

    const feedPost = openapi.paths["/v1/robot/identity/feedback"].post;
    expect(feedPost.requestBody.content["application/json"].examples.confirmed).toBeDefined();
    expect(feedPost.requestBody.content["application/json"].examples.rejected).toBeDefined();

    const downloadGet = openapi.paths["/v1/robot/identity/models/{modelId}/download"].get;
    expect(downloadGet.responses["403"].content["application/json"].examples.invalidToken).toBeDefined();
  });
});
