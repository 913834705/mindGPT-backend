import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OpenAIEmbeddings, ChatOpenAI } from '@langchain/openai';
// 引入 LangChain 的消息类型，用于构建带有记忆的对话
import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages';

@Injectable()
export class ChatService {
  constructor(private prisma: PrismaService) {}

  // ==========================================
  // 会话管理 (ChatSession)
  // ==========================================

  // 1. 创建新会话
  async createSession(userId: number, title?: string) {
    return this.prisma.chatSession.create({
      data: {
        userId,
        title: title || '新对话',
      },
    });
  }

  // 2. 获取用户的所有会话列表 (按最后更新时间倒序)
  async findAllSessions(userId: number) {
    return this.prisma.chatSession.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  // 3. 获取单个会话的历史消息
  async findSessionMessages(sessionId: number, userId: number) {
    // 增加 userId 校验，防止越权访问他人的会话消息
    const session = await this.prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      throw new Error('会话不存在或无权访问');
    }

    return this.prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' }, // 对话记录按时间正序排列
    });
  }

  // 4. 更新会话标题
  async updateSessionTitle(sessionId: number, userId: number, title: string) {
    return this.prisma.chatSession.updateMany({
      where: { id: sessionId, userId },
      data: { title },
    });
  }

  // 5. 删除会话 (及其关联的消息，Prisma Schema 中配置了 Cascade)
  async removeSession(sessionId: number, userId: number) {
    return this.prisma.chatSession.deleteMany({
      where: { id: sessionId, userId },
    });
  }

  // ==========================================
  // 核心聊天逻辑 (流式输出)
  // ==========================================

  async *askQuestionStream(userId: number, question: string, sessionId: number) {
    // 校验会话所属权
    const session = await this.prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
    });
    if (!session) throw new Error('无效的会话 ID');

    // 向量检索：获取知识库上下文 (保持不变)
    const embeddings = new OpenAIEmbeddings({
      configuration: { baseURL: process.env.EMBEDDING_BASE_URL },
      modelName: 'Qwen/Qwen3-Embedding-4B',
      openAIApiKey: process.env.EMBEDDING_API_KEY,
    });

    // 获取向量数组
    const [questionVector] = await embeddings.embedDocuments([question]);
    const vectorString = `[${questionVector.join(',')}]`;

    // 利用 pgvector 的余弦相似度操作符 (<=>) 去数据库中寻找最匹配的 3 个 Chunk
    const relevantChunks = await this.prisma.$queryRawUnsafe<Array<{ content: string; similarity: number }>>(`
      SELECT 
        c."content", 
        1 - (c."embedding" <=> '${vectorString}'::vector) as similarity
      FROM "Chunk" c
      JOIN "Document" d ON c."documentId" = d.id
      WHERE d."userId" = $1
      ORDER BY c."embedding" <=> '${vectorString}'::vector
      LIMIT 3
    `, userId);

    // 3. 将检索到的 Chunk 拼接成“上下文”
    const contextText = relevantChunks.map(chunk => chunk.content).join('\n\n---\n\n');

    // ==========================================
    // 聊天记忆检索：只获取当前会话 (sessionId) 的历史记录
    // ==========================================
    const historyMessages = await this.prisma.message.findMany({
      where: { sessionId: sessionId }, // 重点：改为按会话 ID 过滤
      orderBy: { id: 'desc' }, 
      take: 10,
    });
    historyMessages.reverse();

    // ==========================================
    // 构建超级 Prompt
    // ==========================================
    const systemPrompt = `你是一个名为 MindGPT 的智能知识库助手。
请**优先**根据以下提供的知识库上下文来回答用户的问题。
如果上下文中没有包含能回答问题的答案，你可以结合上下文进行合理推断，或者明确告知“我的知识库中没有关于此内容的记录”。
上下文内容：
${contextText}`;

    const langChainMessages: (SystemMessage | HumanMessage | AIMessage)[] = [
      new SystemMessage(systemPrompt), // 第一条永远是 System，携带知识库内容
    ];

// 把数据库里的历史记录转换成 LangChain 认识的格式并塞进去
    for (const msg of historyMessages) {
      if (msg.role === 'user') langChainMessages.push(new HumanMessage(msg.content));
      if (msg.role === 'ai') langChainMessages.push(new AIMessage(msg.content));
    }

    langChainMessages.push(new HumanMessage(question));

    const chatModel = new ChatOpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY, 
      configuration: {
        baseURL: process.env.DEEPSEEK_BASE_URL, 
      },
      modelName: 'deepseek-chat', // 如果在硅基流动，模型名可能是 deepseek-ai/DeepSeek-V2.5
      temperature: 0.2, // 较低的温度，让模型回答更严谨，基于事实
    });

    // 调用 stream 方法，它会返回一个异步可迭代对象
    const stream = await chatModel.stream(langChainMessages);

    let fullAnswer = ''; // 用于在内存中拼接完整的回答，方便最后存入数据库
    // 遍历大模型像挤牙膏一样吐出来的每一个字 (Chunk)
    for await (const chunk of stream) {
      const text = chunk.content.toString();
      if (text) {
        fullAnswer += text; // 拼接到完整字符串中
        yield text;         // [核心] yield 关键字：立即把这个字丢给前端！
      }
    }

    // 对话结束后，保存消息并关联到 sessionId
    await this.prisma.message.create({ 
      data: { role: 'user', content: question, userId, sessionId } 
    });
    await this.prisma.message.create({ 
      data: { role: 'ai', content: fullAnswer, userId, sessionId } 
    });

    // 更新会话的 updatedAt 时间，使其排在列表最前面
    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() }
    });
  }




  findAll() {
    return `This action returns all chat`;
  }

  findOne(id: number) {
    return `This action returns a #${id} chat`;
  }

  remove(id: number) {
    return `This action removes a #${id} chat`;
  }
}
