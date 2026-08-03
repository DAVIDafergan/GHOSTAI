import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  // The extension's content scripts run in the page's origin (e.g.
  // chat.openai.com), not the extension's own privileged origin, so their
  // fetch() calls to this backend are subject to normal browser CORS.
  // Auth here is via explicit x-api-key/x-extension-key headers (not
  // cookies), so reflecting the request origin carries no CSRF risk.
  app.enableCors({
    origin: true,
    allowedHeaders: ['content-type', 'x-api-key', 'x-extension-key', 'x-admin-secret'],
  });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
