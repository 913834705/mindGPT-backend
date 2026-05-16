import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
// [新增] 引入 Node.js 原生的 fs 和 path 模块，用于删除文件
import * as fs from 'fs';
import * as path from 'path';

import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
// [新增] 引入 DocxLoader
import { DocxLoader } from '@langchain/community/document_loaders/fs/docx';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { Document as LangChainDocument } from '@langchain/core/documents';
import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
// [新增] 引入 LangChain 的 OpenAI Embeddings 模块
import { OpenAIEmbeddings } from '@langchain/openai';

@Injectable()
export class DocumentsService {
  // 注入 Prisma 服务以操作数据库
  constructor(private prisma: PrismaService,private eventEmitter: EventEmitter2 ) { }

  async upload(file: Express.Multer.File, userId: number) {
    // 将文件字节大小转换为更易读的 MB 或 KB
    const sizeInMB = (file.size / (1024 * 1024)).toFixed(2);
    const sizeStr = sizeInMB !== '0.00' ? `${sizeInMB} MB` : `${(file.size / 1024).toFixed(2)} KB`;
    // 处理中文文件名乱码问题
    // Multer 默认按 Latin-1 解析，需要将错误的 Latin-1 转回 UTF-8
    const originalName = Buffer.from(file.originalname, 'latin1' as BufferEncoding).toString('utf8' as BufferEncoding);
    
    // 1. 先在数据库中创建一条 Document 记录，状态设为 processing (处理中)
    const document = await this.prisma.document.create({
      data: {
        title: originalName,
        type: file.mimetype,
        size: sizeStr,
        url: file.path,
        status: 'processing',
        userId: Number(userId),
      }
    });
    // 2. 异步执行文档解析与切片 (不阻塞当前请求，让前端先拿到 processing 状态)
    // 实际项目中，这里通常会丢给消息队列 (如 RabbitMQ/Redis Bull) 去做，这里我们直接使用异步不等待的方式
    this.processDocument(file.path, file.mimetype, document.id, originalName, Number(userId)).catch(err => {
      console.error(`文档 ${document.id} 处理失败:`, err);
    });

    // 3. 立即返回记录，前端显示正在解析
    return document
  }

  // [修改] 增加 originalName 参数作为 fallback 判断依据
  private async processDocument(filePath: string, mimeType: string, documentId: number, fileName: string, userId: number) {
    try {
      let docs: LangChainDocument[] = [];

      // 1. 文档解析 (Parsing) - 支持 PDF, TXT, DOCX
      if (mimeType === 'application/pdf') {
        const loader = new PDFLoader(filePath, { splitPages: false });
        docs = await loader.load();
      }
      else if (mimeType === 'text/plain') {
        // 使用 Node.js 原生方法读取文本文件
        const textContent = fs.readFileSync(filePath, 'utf-8');
        docs = [new LangChainDocument({ pageContent: textContent, metadata: { source: filePath } })];
      }
      // [新增] 判断 DOCX 格式 (结合 MIME 类型和后缀名双重保险)
      else if (
        mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        mimeType === 'application/msword' ||
        fileName.toLowerCase().endsWith('.docx')
      ) {
        const loader = new DocxLoader(filePath);
        docs = await loader.load();
      }
      else {
        throw new BadRequestException(`暂不支持该类型的文件解析: ${mimeType}`);
      }

      // 2. 文本切片 (Chunking)
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 800,
        chunkOverlap: 100,
        separators: ['\n\n', '\n', '。', '！', '？', '，', ' ', ''],
      });

      const chunks = await splitter.splitDocuments(docs);
      console.log(`[成功] 文件 ${documentId} (${fileName}) 已切分为 ${chunks.length} 个 Chunk`);

      // ==========================================
      // 阶段二：调用 Embedding API 并存入数据库
      // ==========================================
      // 实例化 Embedding 模型
      const embeddings = new OpenAIEmbeddings({
        configuration: {
          baseURL: process.env.EMBEDDING_BASE_URL, // 如果用第三方中转或国内平台需要配这个
        },
        modelName: 'Qwen/Qwen3-Embedding-4B', 
        openAIApiKey: process.env.EMBEDDING_API_KEY,
        timeout: 10000, // 加上 10 秒超时限制，防止无限卡住
      });

      // 提取所有切片中的纯文本部分
      const textsToEmbed = chunks.map(chunk => chunk.pageContent);
      
      console.log(`正在请求大模型生成向量，共计 ${textsToEmbed.length} 条...`);
      // 批量发送给大模型，获取对应的多维向量数组
      const vectors = await embeddings.embedDocuments(textsToEmbed);

      console.log('向量生成完毕，正在存入 pgvector 数据库...');
      // 遍历存入数据库
      // Prisma 目前对 Unsupported 类型字段不支持原生的 create，必须使用 $executeRaw 执行原生 SQL
      for (let i = 0; i < chunks.length; i++) {
        // 将浮点数数组转换成 PostgreSQL vector 插件认识的字符串格式：'[0.1, 0.2, ...]'
        const vectorString = `[${vectors[i].join(',')}]`;
        
        await this.prisma.$executeRaw`
          INSERT INTO "Chunk" ("content", "documentId", "embedding", "createdAt")
          VALUES (${textsToEmbed[i]}, ${documentId}, ${vectorString}::vector, NOW())
        `;
      }

      // 数据库状态更新为 ready
      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: 'ready' },
      });
      console.log(`[完成] 文档 ${documentId} 处理完毕并已入库！`);

      // 向量化全部完成后，向系统内部广播一个事件！
      this.eventEmitter.emit('document.status.changed', {
        userId: userId,         // 必须带上用户 ID，防止消息发错人
        documentId: documentId,
        status: 'ready'
      });

    } catch (error) {
      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: 'failed' },
      });

      // 如果失败了，也广播一个失败事件
      this.eventEmitter.emit('document.status.changed', {
        userId: userId,
        documentId: documentId,
        status: 'failed'
      });

      throw error;
    }
  }

  // 2. 获取当前用户的所有文档列表
  async findAll(userId: number) {
    // 查询 Document 表
    return this.prisma.document.findMany({
      where: { userId: userId }, // 过滤条件：只查属于当前用户的文档
      orderBy: { createdAt: 'desc' }, // 排序规则：按创建时间倒序排 (最新的在最上面)
    });
  }

  // 3. 删除文档 (同时删除数据库记录和本地物理文件)
  async remove(id: number, userId: number) {
    // 先去数据库查一下，这篇文档存不存在，并且是不是这个用户的 (防越权)
    const document = await this.prisma.document.findFirst({
      where: { id: id, userId: userId },
    });

    // 如果没找到，抛出 404 错误
    if (!document) {
      throw new NotFoundException('找不到该文档或您无权删除');
    }

    // 获取文件在服务器上的绝对路径
    const filePath = path.resolve(document.url);

    // 检查本地物理文件是否存在
    if (fs.existsSync(filePath)) {
      // 存在则物理删除它
      fs.unlinkSync(filePath);
    }

    // 最后，把数据库里的这条记录删掉
    await this.prisma.document.delete({
      where: { id: id },
    });

    // 返回成功提示
    return { message: '文件删除成功' };
  }
}
