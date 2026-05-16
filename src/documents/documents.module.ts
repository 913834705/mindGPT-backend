import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
// [新增] 引入 Multer 和路径处理模块
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
// [新增] 引入 PrismaModule，因为我们要操作数据库
import { PrismaModule } from '../prisma/prisma.module';
@Module({
  imports:[
    PrismaModule,// 导入 Prisma 模块以供 Service 使用
    // 注册 Multer 模块，配置本地文件上传逻辑
    MulterModule.register({
      // 使用磁盘存储引擎 (保存在服务器本地文件夹)
      storage: diskStorage({
        // 指定存放目录，会自动在项目根目录创建 uploads 文件夹
        destination: './uploads',
        // 配置文件名生成规则 (防止重名文件被覆盖)
        filename: (req, file, cb) => {
         // 生成一个随机的唯一前缀 (当前时间戳 + 随机数)
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
          // 获取文件的原始扩展名 (如 .pdf)
          const ext = extname(file.originalname);
          // 拼接最终的文件名 (例如: 16788888-12345.pdf)
          cb(null, `${uniqueSuffix}${ext}`);
        },
      }),
    })
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService],
})
export class DocumentsModule {}
