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
  const path = req.url?.split('?')[0] ?? '/';
  if (req.method === 'GET' && (path === '/' || path === '/api/health')) {
    res.status(200).json({ status: 'ok' });
    return;
  }

  try {
    const app = await (bootstrapPromise ??= bootstrap());
    return app(req, res);
  } catch (error) {
    bootstrapPromise = null;
    // eslint-disable-next-line no-console
    console.error('API bootstrap failed', error);
    res.status(500).json({ error: { code: 'API_BOOTSTRAP_FAILED', message: 'API failed to start' } });
  }
}
