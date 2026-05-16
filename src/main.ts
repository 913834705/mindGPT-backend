import 'dotenv/config'; // [新增] 必须放在所有其他 import 之前
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  console.log('Database URL from Env:', process.env.DATABASE_URL);
  const app = await NestFactory.create(AppModule);

  // 启用 CORS，允许前端跨域访问
  app.enableCors({
    origin: [
      'http://localhost:5173',           // 开发环境
      'http://18.216.195.130:8082',      // 生产环境（Nginx 端口）
      'http://18.216.195.130:80',        // 生产环境（Nginx 默认端口）
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true, // 允许携带 Cookie 和认证信息
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
