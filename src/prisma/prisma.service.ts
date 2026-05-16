import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    // 1. 获取环境变量（加上兜底地址防止万一）
    const connectionString = process.env.DATABASE_URL 
    
    // 2. 创建一个 pg 连接池
    const pool = new Pool({ connectionString });
    
    // 3. 将连接池包装成 Prisma 要求的 adapter
    const adapter = new PrismaPg(pool);

    // 4. 将 adapter 传给父类，完美契合 Prisma 7 的要求！
    super({ adapter }); 
  }

  async onModuleInit() {
    try {
      await this.$connect();
      console.log('✅ 数据库连接成功！');
    } catch (error) {
      console.error('❌ 数据库连接失败:', error);
    }
  }
}