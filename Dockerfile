# 1. 基础镜像
FROM node:20-alpine

# 2. 设置工作目录
WORKDIR /app

# 3. 复制依赖描述文件
COPY package*.json ./

# 4. 安装依赖（包括 Prisma CLI）
RUN npm install

# 5. 复制所有源代码
COPY . .

# 6. 【关键：Prisma 专属】在打包前生成 Prisma Client
# 如果需要执行迁移，可以在这里或启动脚本里处理
RUN npx prisma generate

# 7. 编译 NestJS 项目（将 TS 转为 JS）
RUN npm run build

# 8. 暴露后端端口（NestJS 默认通常是 3000，我们在容器内保持 3000）
EXPOSE 3000

# 9. 启动生产环境
CMD ["npm", "run", "start:prod"]