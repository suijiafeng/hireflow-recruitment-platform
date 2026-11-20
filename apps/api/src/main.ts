import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { requestContext } from './common/request-context';
import { assertProductionSecrets } from './common/startup-checks';
import { createValidationPipe } from './common/validation';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // ConfigModule 在创建应用时已把 .env 载入 process.env，这里校验才拿得到值
  assertProductionSecrets(process.env);

  // 反向代理链（平台边缘 → nginx → API）后面，只有声明了可信跳数 req.ip 才是真实客户端。
  // 登录限流的按 IP 计数依赖它；不设置时只做按账号限流。取值同 Express trust proxy（如 1、2、loopback）
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy) {
    app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  }

  // 安全响应头：API 只回 JSON，CSP 收到最严（default-src 'none'）；Swagger 页面在生产默认关闭，
  // 开发时放开它需要的内联脚本/样式。HSTS 交给 TLS 终止的边缘（Render / 负载均衡）统一下发。
  const swaggerEnabled = process.env.NODE_ENV !== 'production' || process.env.SWAGGER_ENABLED === 'true';
  app.use(
    helmet({
      contentSecurityPolicy: swaggerEnabled
        ? false
        : { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'no-referrer' },
      strictTransportSecurity: false,
    }),
  );
  app.use(requestContext);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  // SIGTERM 时走 onModuleDestroy：断开数据库连接池、停掉定时任务，平台滚动发布不丢请求
  app.enableShutdownHooks();
  // 前端始终同源访问 /api（开发走 Vite 代理，生产走 nginx 反代），默认不需要开跨域。
  // 原先 origin: true + credentials 会对任意来源回显放行；确有跨域需求时用 CORS_ORIGINS 显式列白名单。
  const corsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (corsOrigins.length) {
    app.enableCors({ origin: corsOrigins, credentials: true });
  }

  // 接口文档匿名可读，会把全部路由与 DTO 结构暴露出去：生产默认关闭，需要时显式 SWAGGER_ENABLED=true
  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('HireFlow API')
      .setDescription('AI-Powered Recruitment Platform Backend API')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(
    `HireFlow API started: http://localhost:${port}/api` +
      (swaggerEnabled ? ` | Docs: http://localhost:${port}/api/docs` : ''),
  );
}

void bootstrap();
