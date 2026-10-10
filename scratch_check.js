const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const courses = await prisma.course.findMany({
    where: { source: 'PLATFORM' },
    include: {
      levels: {
        include: {
          lessons: true,
          chapters: { include: { lessons: true } },
        },
      },
    },
  });

  for (const c of courses) {
    console.log(`Course: ${c.courseCode} - ${c.courseName} (ID: ${c.id})`);
    for (const lvl of c.levels) {
      for (const les of lvl.lessons) {
        console.log(`  Lesson: ${les.id} - ${les.name}: ${les.contentUrl}`);
      }
      for (const ch of lvl.chapters) {
        for (const les of ch.lessons) {
          console.log(`  Chapter Lesson: ${les.id} - ${les.name}: ${les.contentUrl}`);
        }
      }
    }
  }
}

main().finally(() => prisma.$disconnect());
