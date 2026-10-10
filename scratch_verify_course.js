const { PrismaClient, CourseAccessType } = require('@prisma/client');
const http = require('http');
const https = require('https');

const prisma = new PrismaClient();

const probeHttpAsset = (url, method) =>
  new Promise((resolve) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(
      parsed,
      {
        method,
        timeout: 5000,
        headers: method === 'GET' ? { Range: 'bytes=0-0' } : undefined,
      },
      (res) => {
        res.resume();
        const status = res.statusCode ?? 0;
        resolve({ ok: status >= 200 && status < 400, status });
      },
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false });
    });
    req.on('error', () => resolve({ ok: false }));
    req.end();
  });

const defaultAssetProbe = async (url) => {
  const head = await probeHttpAsset(url, 'HEAD');
  if (head.status !== 405) return head;
  return probeHttpAsset(url, 'GET');
};

async function testValidation(courseId) {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      levels: {
        select: {
          id: true,
          lessons: {
            select: {
              id: true,
              contentUrl: true,
              contentSizeBytes: true,
              contentChecksum: true,
            },
          },
          chapters: {
            select: {
              id: true,
              lessons: {
                select: {
                  id: true,
                  contentUrl: true,
                  contentSizeBytes: true,
                  contentChecksum: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const lessons = course.levels.flatMap((l) => [
    ...l.lessons,
    ...l.chapters.flatMap((c) => c.lessons),
  ]);

  for (const lesson of lessons) {
    console.log(`Checking lesson ${lesson.id} URL: ${lesson.contentUrl}`);
    const probe = await defaultAssetProbe(lesson.contentUrl);
    console.log(`Probe result:`, probe);
    if (!probe.ok) {
      throw new Error(`Failed on lesson ${lesson.id}`);
    }
  }

  console.log(`All lessons in course ${courseId} passed asset validation successfully!`);
}

async function run() {
  const data301 = await prisma.course.findFirst({ where: { courseCode: 'DATA301' } });
  await testValidation(data301.id);
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
