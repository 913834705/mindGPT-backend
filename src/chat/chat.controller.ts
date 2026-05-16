import { Controller, Get, Post, Body, Patch, Param, Delete,UseGuards,Request,Res } from '@nestjs/common';
import { ChatService } from './chat.service';
import type { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';

@Controller('chat')
@UseGuards(AuthGuard('jwt'))
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // ==========================================
  // 会话管理接口
  // ==========================================

  // 1. 获取所有会话列表
  @Get('sessions')
  async getSessions(@Request() req: any) {
    return this.chatService.findAllSessions(req.user.userId);
  }

  // 2. 创建新会话
  @Post('session')
  async createSession(@Request() req: any, @Body('title') title?: string) {
    return this.chatService.createSession(req.user.userId, title);
  }

  // 3. 获取特定会话的历史消息
  @Get('session/:id/messages')
  async getSessionMessages(@Param('id') id: string, @Request() req: any) {
    return this.chatService.findSessionMessages(+id, req.user.userId);
  }

  // 4. 更新会话标题
  @Patch('session/:id')
  async updateSession(@Param('id') id: string, @Body('title') title: string, @Request() req: any) {
    return this.chatService.updateSessionTitle(+id, req.user.userId, title);
  }

  // 5. 删除会话
  @Delete('session/:id')
  async removeSession(@Param('id') id: string, @Request() req: any) {
    return this.chatService.removeSession(+id, req.user.userId);
  }

  // ==========================================
  // 核心聊天接口 (SSE 流式)
  // ==========================================

  @Post()
  async askQuestion(
    @Body('message') message: string,
    @Body('sessionId') sessionId: number, // [新增] 必须传入会话 ID
    @Request() req: any,
    @Res() res: Response, // [新增] 注入底层 Response 对象，准备接管 HTTP 返回流
  ) {
    if (!message || !sessionId) {
      return res.status(400).send('Message and sessionId are required');
    }

    // 1. 设置标准的 Server-Sent Events (SSE) 响应头
    // 告诉前端：“别急着关连接，我会一点一点给你发数据”
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      // 传入 sessionId 进行对话
      const stream = this.chatService.askQuestionStream(req.user.userId, message, +sessionId);

      // 3. 开始监听流，每拿到一个字，就顺着网线推给前端
      for await (const chunk of stream) {
        // SSE 的标准数据格式是: data: 你的数据\n\n
        const dataPayload = JSON.stringify({ text: chunk });
        res.write(`data: ${dataPayload}\n\n`); 
      }

      // 4. 全部发完之后，发一个结束信号给前端，然后断开 HTTP 连接
      res.write(`data: [DONE]\n\n`);
      res.end();

    } catch (error) {
      console.error('流式对话生成失败:', error);
      res.write(`data: {"error": "${error.message || '对话服务异常'}"}\n\n`);
      res.end();
    }
  }

  // 下面是旧的自动生成的接口，可以按需保留或删除
  @Get()
  findAll() {
    return this.chatService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.chatService.findOne(+id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.chatService.remove(+id);
  }
}
