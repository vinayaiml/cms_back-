import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { isOriginAllowed, parseAllowedOrigins } from './config/cors';

const legacyRoutes = new Set([
  'POST /api/auth/login',
  'POST /api/robot/auth/login',
  'GET /api/robot/sync',
  'POST /api/robot/logs/batch',
]);

function getOpenApiPath() {
  const paths = [
    join(process.cwd(), '..', 'docs', 'api', 'openapi.yaml'),
    join(process.cwd(), 'docs', 'api', 'openapi.yaml'),
  ];

  return paths.find((path) => existsSync(path));
}

function docsPage() {
  return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>WhizRobot CMS API Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      body { margin: 0; background: #fff; }
      .topbar { display: none; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.onload = function () {
        window.ui = SwaggerUIBundle({
          url: '/api/docs/openapi.yaml',
          dom_id: '#swagger-ui',
          deepLinking: true,
          presets: [SwaggerUIBundle.presets.apis],
          layout: 'BaseLayout'
        });
      };
    </script>
  </body>
</html>`;
}

export function configureApp(app: INestApplication) {
  const allowedOrigins = parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);

  app.setGlobalPrefix('api');
  app.use('/api/docs/openapi.yaml', (_req: Request, res: Response) => {
    const openApiPath = getOpenApiPath();
    if (!openApiPath) {
      res.status(404).json({ message: 'OpenAPI contract not found' });
      return;
    }

    res.type('application/yaml').send(readFileSync(openApiPath, 'utf8'));
  });
  app.use('/api/docs', (_req: Request, res: Response) => {
    res.type('html').send(docsPage());
  });

  app.use((req: Request, _res: Response, next: NextFunction) => {
    const routeKey = `${req.method} ${req.path}`;
    if (legacyRoutes.has(routeKey)) {
      // eslint-disable-next-line no-console
      console.warn(`[legacy-api] ${routeKey} is deprecated; use /api/v1. Planned removal: v2.`);
    }

    next();
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (typeof origin === 'string' && !isOriginAllowed(origin, allowedOrigins)) {
      res.status(403).json({
        error: {
          code: 'CORS_ORIGIN_DENIED',
          message: 'Origin not allowed by CORS',
        },
      });
      return;
    }

    next();
  });

  app.enableCors({
    origin(origin, callback) {
      callback(null, isOriginAllowed(origin, allowedOrigins));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}
