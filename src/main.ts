import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);

  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`✅ API running on http://localhost:${port}/api`);
  // eslint-disable-next-line no-console
  console.log(`API docs running on http://localhost:${port}/api/docs`);
}

bootstrap();
