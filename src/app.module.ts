import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { DocumentsModule } from './documents/documents.module';
import { ChatModule } from './chat/chat.module';
import { EventEmitterModule } from '@nestjs/event-emitter';//事件发射器
@Module({
  imports: [PrismaModule, AuthModule, DocumentsModule, ChatModule,EventEmitterModule.forRoot()],
  controllers: [AppController],
  providers: [AppService],
  
})
export class AppModule {}
