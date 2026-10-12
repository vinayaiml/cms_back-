import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LicenseStatus, PrismaClient } from '@prisma/client';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import * as request from 'supertest';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml: any = require('js-yaml');

/**
 * Calls every /v1/robot/* endpoint against a real app + test database and validates each
 * success body against the response schema declared in docs/api/openapi.yaml.
 */
// Booting the full AppModule and seeding test data takes longer than Jest's 5 s default on CI.
const HOOK_TIMEOUT_MS = 60_000;

describe('Robot API contract (responses match openapi.yaml)', () => {
  process.env.LICENSE_SECRET_KEY ||= 'contract-test-license-secret-1234567890';
  process.env.JWT_SECRET ||= 'contract-test-jwt-secret-1234567890';
  process.env.REDIS_ENABLED ||= 'false';

  const prisma = new PrismaClient();
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const licenseKey = `WHRB${suffix.slice(-6)}`;
  const serialNumber = `CONTRACT-${suffix}`;
  const openapi: any = yaml.load(
    readFileSync(
      [
        join(__dirname, '..', 'docs', 'api', 'openapi.yaml'),
        join(__dirname, '..', '..', 'docs', 'api', 'openapi.yaml'),
      ].find((path) => existsSync(path))!,
      'utf8',
    ),
  );
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ $id: 'openapi', components: openapi.components });

  let app: INestApplication;
  let orgId: number;
  let courseId: number;
  let lessonId: number;
  let createdModel = false;
  let accessToken: string;
  let refreshToken: string;

  function responseSchemaName(path: string, method: string): string {
    const op = openapi.paths[path][method];
    const [, ok] = Object.entries<any>(op.responses).find(([code]) => /^2/.test(code))!;
    const schema: any = Object.values<any>(ok.content)[0].schema;
    return schema.$ref.split('/').pop();
  }

  function expectMatches(path: string, method: string, body: unknown) {
    const name = responseSchemaName(path, method);
    const validate = ajv.getSchema(`openapi#/components/schemas/${name}`)!;
    const valid = validate(body);
    if (!valid) {
      throw new Error(`${method.toUpperCase()} ${path} does not match ${name}: ${ajv.errorsText(validate.errors)}`);
    }
  }

  function requestExample(path: string, method: string): any {
    const content: any = Object.values(openapi.paths[path][method].requestBody.content)[0];
    return content.example ?? Object.values<any>(content.examples)[0].value;
  }

  const robotDevice = {
    manufacturer: 'Sanbot',
    model: 'ELF',
    androidVersion: '6.0',
    apiLevel: 23,
    appVersionName: '0.8.0',
    appVersionCode: 80,
  };

  beforeAll(async () => {
    const { encryptLicenseKey, licenseFingerprint } = await import('../src/common/security/license-secret');
    const org = await prisma.organization.create({
      data: {
        name: `Contract Org ${suffix}`,
        state: 'Test State',
        city: 'Test City',
        authorizedPersonName: 'Test Admin',
        contactNo: '0000000000',
      },
    });
    orgId = org.id;
    // What a real deployment has: the recognition model catalogue row and one course with a lesson.
    const existingModel = await prisma.recognitionModel.findUnique({ where: { modelId: 'face-std-sface-int8-v1' } });
    if (!existingModel) {
      await prisma.recognitionModel.create({
        data: {
          modelId: 'face-std-sface-int8-v1',
          tier: 'standard',
          version: '1.0.0',
          fileId: 'face-std-sface-int8-v1',
          inputSize: '112x112',
          dimension: 128,
          minRamMb: 0,
          minAndroidApi: 23,
          sha256: 'pending-upload',
          status: 'PENDING_UPLOAD',
        },
      });
      createdModel = true;
    }
    const course = await prisma.course.create({ data: { courseCode: `CONTRACT-${suffix}`, courseName: 'Contract Course' } });
    const level = await prisma.level.create({ data: { courseId: course.id, name: 'Level 1', sequence: 1 } });
    const lesson = await prisma.lesson.create({
      data: { courseId: course.id, levelId: level.id, name: 'Lesson 1', sequence: 1, contentUrl: 'https://example.invalid/lesson-1' },
    });
    courseId = course.id;
    lessonId = lesson.id;
    await prisma.robot.create({
      data: {
        orgId,
        serialNumber,
        licenseKey: null,
        licenseKeyCiphertext: encryptLicenseKey(licenseKey),
        licenseKeyFingerprint: licenseFingerprint(licenseKey),
        validFrom: new Date(Date.now() - 86_400_000),
        validUntil: new Date(Date.now() + 30 * 86_400_000),
        licenseStatus: LicenseStatus.ACTIVE,
        hardwareCapabilities: { speaker: true, microphone: true, camera: true, touchDisplay: true },
      },
    });

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await app?.close();
    if (orgId) {
      await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
    }
    if (courseId) {
      await prisma.lesson.deleteMany({ where: { courseId } }).catch(() => undefined);
      await prisma.level.deleteMany({ where: { courseId } }).catch(() => undefined);
      await prisma.course.delete({ where: { id: courseId } }).catch(() => undefined);
    }
    if (createdModel) {
      await prisma.recognitionModel.delete({ where: { modelId: 'face-std-sface-int8-v1' } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  }, HOOK_TIMEOUT_MS);

  function expectStatus(res: request.Response, code: number) {
    if (res.status !== code) {
      throw new Error(`expected ${code}, got ${res.status}: ${JSON.stringify(res.body).slice(0, 400)}`);
    }
  }

  const http = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${accessToken}` });

  it('POST /v1/robot/auth/login', async () => {
    const res = await http()
      .post('/api/v1/robot/auth/login')
      .send({ licenseKey, serialNumber, deviceMetadata: robotDevice })
      ;
    expectStatus(res, 201);
    expectMatches('/v1/robot/auth/login', 'post', res.body);
    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  it('POST /v1/robot/auth/refresh', async () => {
    const res = await http().post('/api/v1/robot/auth/refresh').send({ refreshToken });
    expectStatus(res, 201);
    expectMatches('/v1/robot/auth/refresh', 'post', res.body);
  });

  it('GET /v1/robot/sync', async () => {
    const res = await http().get('/api/v1/robot/sync').set(auth());
    expectStatus(res, 200);
    expectMatches('/v1/robot/sync', 'get', res.body);
  });

  it('GET /v1/robot/sync/changes', async () => {
    const res = await http().get('/api/v1/robot/sync/changes').set(auth());
    expectStatus(res, 200);
    expectMatches('/v1/robot/sync/changes', 'get', res.body);
  });

  it('PUT /v1/robot/device-profile', async () => {
    const res = await http()
      .put('/api/v1/robot/device-profile')
      .set(auth())
      .send({ ...requestExample('/v1/robot/device-profile', 'put'), appVersionCode: robotDevice.appVersionCode })
      ;
    expectStatus(res, 200);
    expectMatches('/v1/robot/device-profile', 'put', res.body);
  });

  it('POST /v1/robot/logs/batch', async () => {
    const body = requestExample('/v1/robot/logs/batch', 'post');
    body.logs = body.logs.map((log: any) => ({ ...log, eventId: `${log.eventId}-${suffix}`, courseId, lessonId }));
    const res = await http().post('/api/v1/robot/logs/batch').set(auth()).send(body);
    expectStatus(res, 201);
    expectMatches('/v1/robot/logs/batch', 'post', res.body);
  });

  it('POST /v1/robot/ai/conversation', async () => {
    const res = await http()
      .post('/api/v1/robot/ai/conversation')
      .set(auth())
      .send({ message: 'Hello', inputMode: 'speech' })
      ;
    expectStatus(res, 201);
    expectMatches('/v1/robot/ai/conversation', 'post', res.body);
  });

  it('POST /v1/robot/ai/conversation/stream emits ack, sentence {index,text,emotion} and done', async () => {
    const res = await http()
      .post('/api/v1/robot/ai/conversation/stream')
      .set(auth())
      .send({ message: 'Hello', inputMode: 'speech' })
      .buffer(true)
      .parse((r, cb) => {
        let data = '';
        r.on('data', (chunk: Buffer) => (data += chunk.toString()));
        r.on('end', () => cb(null, data));
      });
    const events = String(res.body)
      .split('\n\n')
      .filter((block) => block.startsWith('event:'))
      .map((block) => {
        const [eventLine, dataLine] = block.split('\n');
        return { type: eventLine.slice(7).trim(), data: JSON.parse(dataLine.slice(5)) };
      });
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['ack', 'sentence', 'done']));
    expect(events[0]).toEqual({ type: 'ack', data: { requestId: expect.any(String) } });
    for (const sentence of events.filter((e) => e.type === 'sentence')) {
      expect(sentence.data).toEqual({ index: expect.any(Number), text: expect.any(String), emotion: expect.any(String) });
      expect(sentence.data.text).not.toContain('[[scope');
    }
    expect(events[events.length - 1].data).toEqual(
      expect.objectContaining({ outOfContext: expect.any(Boolean), policyAction: expect.any(String), fallback: expect.any(Boolean) }),
    );
  });

  let identityId: number;
  const vector = Buffer.alloc(128 * 4, 1).toString('base64');

  it('POST /v1/robot/identity/enrollments', async () => {
    const res = await http()
      .post('/api/v1/robot/identity/enrollments')
      .set(auth())
      .set('Idempotency-Key', `contract-enrol-${suffix}`)
      .send({
        consent: { granted: true, source: 'robot-kiosk', policyVersion: 'consent-v1', grantedAt: new Date().toISOString() },
        subjectRef: 'contract-visitor',
        displayName: 'Contract Visitor',
        embedding: { modelId: 'face-std-sface-int8-v1', dimension: 128, vector },
      })
      ;
    expectStatus(res, 201);
    expectMatches('/v1/robot/identity/enrollments', 'post', res.body);
    identityId = res.body.id;
  });

  it('POST /v1/robot/identity/{identityId}/templates', async () => {
    const res = await http()
      .post(`/api/v1/robot/identity/${identityId}/templates`)
      .set(auth())
      .set('Idempotency-Key', `contract-template-${suffix}`)
      .send({ modelId: 'face-std-sface-int8-v1', vector, dimension: 128, qualityScore: 0.95, score: 0.9, margin: 0.3, votes: 5 })
      ;
    expectStatus(res, 201);
    expectMatches('/v1/robot/identity/{identityId}/templates', 'post', res.body);
  });

  it('GET /v1/robot/identity/gallery', async () => {
    const res = await http().get('/api/v1/robot/identity/gallery').set(auth());
    expectStatus(res, 200);
    expectMatches('/v1/robot/identity/gallery', 'get', res.body);
  });

  it('POST /v1/robot/identity/feedback', async () => {
    const res = await http()
      .post('/api/v1/robot/identity/feedback')
      .set(auth())
      .set('Idempotency-Key', `contract-feedback-${suffix}`)
      .send({ identityId, modelId: 'face-std-sface-int8-v1', score: 0.8, margin: 0.2, votes: 3, outcome: 'confirmed' })
      ;
    expectStatus(res, 201);
    expectMatches('/v1/robot/identity/feedback', 'post', res.body);
  });
});
