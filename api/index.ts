import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

const server = express();
let bootstrapPromise: Promise<express.Express> | null = null;

async function bootstrap() {
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), {
    logger: ['error', 'warn', 'log'],
  });

  configureApp(app);
  await app.init();

  return server;
}

export default async function handler(req: express.Request, res: express.Response) {
  const app = await (bootstrapPromise ??= bootstrap());
  return app(req, res);
}
