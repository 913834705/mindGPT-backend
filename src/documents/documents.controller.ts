import { Controller, Get, Post, Delete, Param, UseInterceptors, UploadedFile, UseGuards,Res,Req } from '@nestjs/common';
import type {Response, Request } from 'express';
import { DocumentsService } from './documents.service';
// [新增] 引入文件拦截器
import { FileInterceptor } from '@nestjs/platform-express';
// [新增] 引入 JWT 身份验证守卫
import { AuthGuard } from '@nestjs/passport';
import { EventEmitter2 } from '@nestjs/event-emitter';

interface AuthenticatedRequest extends Request {
  user: {
    userId: number;
    email?: string; // 如果你的 jwt payload 里还有其他字段，可以写在这里
  };
}

// [新增] 为事件 Payload 定义严谨的数据结构
interface DocumentStatusPayload {
  userId: number;
  documentId: number;
  status: string;
}

@Controller('documents')
// 重点：使用 JWT 守卫保护整个 documents 路由模块，未登录无法访问
@UseGuards(AuthGuard('jwt'))
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService,
    private eventEmitter: EventEmitter2
  ) { }

  // POST /documents/upload 接口
  @Post('upload')
  // 使用 FileInterceptor 拦截前端发来的 FormData 中 key 为 'file' 的文件流
  @UseInterceptors(FileInterceptor('file'))
  uploadFile(
    @UploadedFile() file: Express.Multer.File, // 提取解析好的文件对象
    @Req() req: AuthenticatedRequest              // 获取请求对象 (内部包含了守卫解析出来的 user)
  ) {
    // 调用 service 的上传方法，并传入解析好的 userId
    return this.documentsService.upload(file, req.user.userId);
  }

  
  @Get('status-stream')
  streamStatus(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    // 1. 设置 SSE 头，告诉前端保持连接不要断
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // 2. 定义一个监听器：当 Service 喊出 'document.status.changed' 时触发
    const statusListener = (payload: DocumentStatusPayload) => {
      // 安全校验：只把消息推给当前登录的这个用户，别人的文件处理好了不关他的事
      if (payload.userId === req.user.userId) {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      }
    };

    // 3. 把耳朵凑过去监听
    this.eventEmitter.on('document.status.changed', statusListener);

    // 4. 当用户关闭网页或离开 KnowledgeBase 页面时，断开连接并销毁监听器，防止内存泄漏
    req.on('close', () => {
      this.eventEmitter.removeListener('document.status.changed', statusListener);
      res.end();
    });
  }


  // GET /documents/list 接口
  @Get('list')
  findAll(@Req() req: AuthenticatedRequest) {
    // 调用 service 方法查询列表，同样传入当前用户的 ID
    return this.documentsService.findAll(req.user.userId);
  }

  // DELETE /documents/delete/:id 接口
  @Delete('delete/:id')
  remove(
    @Param('id') id: string, // 从 URL 路径中提取要删除的文档 ID
    @Req() req: AuthenticatedRequest
  ) {
    // 传入文档 id (+ 强制转为数字) 和用户 ID
    return this.documentsService.remove(+id, req.user.userId);
  }
}
