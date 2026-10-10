import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

const server = express();
let bootstrapPromise: Promise<express.Express> | null = null;
let bootstrapError: string | null = null;

async function bootstrap() {
  try {
    const app = await NestFactory.create(AppModule, new ExpressAdapter(server), {
      logger: ['error', 'warn', 'log'],
    });

    configureApp(app);
    await app.init();

    bootstrapError = null;
    // eslint-disable-next-line no-console
    console.log('[vercel] NestJS bootstrap complete');
    return server;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    bootstrapError = message;
    // eslint-disable-next-line no-console
    console.error('[vercel] Bootstrap failed:', message);
    if (error instanceof Error && error.stack) {
      // eslint-disable-next-line no-console
      console.error('[vercel] Stack:', error.stack);
    }
    throw error;
  }
}

export default async function handler(req: express.Request, res: express.Response) {
  const path = req.url?.split('?')[0] ?? '/';

  // Health/readiness probe — respond immediately without bootstrapping NestJS
  if (req.method === 'GET' && (path === '/' || path === '/api/health')) {
    res.status(200).json({
      status: bootstrapError ? 'error' : 'ok',
      timestamp: new Date().toISOString(),
      bootstrapError: bootstrapError || undefined,
    });
    return;
  }

  // Handle CORS preflight before bootstrap to avoid cold-start delays on OPTIONS
  if (req.method === 'OPTIONS') {
    const origin = req.headers.origin;
    const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);

    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,X-Robot-App-Version,X-Robot-Device-Model');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.status(204).end();
    return;
  }

  try {
    const app = await (bootstrapPromise ??= bootstrap());
    return app(req, res);
  } catch (error) {
    bootstrapPromise = null;
    const message = error instanceof Error ? error.message : String(error);
    // eslint-disable-next-line no-console
    console.error('[vercel] API handler error:', message);
    res.status(500).json({
      error: {
        code: 'API_BOOTSTRAP_FAILED',
        message: 'The API failed to start.',
        detail: process.env.NODE_ENV !== 'production' ? message : undefined,
      },
    });
  }
}
