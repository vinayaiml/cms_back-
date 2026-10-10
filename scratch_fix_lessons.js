const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const validUrl = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
  const validChecksum = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const validSize = 1630774;

  const result = await prisma.lesson.updateMany({
    data: {
      contentUrl: validUrl,
      contentChecksum: validChecksum,
      contentSizeBytes: validSize,
    },
  });

  console.log(`Updated ${result.count} lessons in the database with valid content assets.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
