import { Injectable,UnauthorizedException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service'; 
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { CreateAuthDto } from './dto/create-auth.dto';

@Injectable()
export class AuthService {

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  // [修改] 实现 register 方法
  async register(createAuthDto: CreateAuthDto) {
    const { email, password } = createAuthDto;

    // [新增] 检查用户是否已存在 (可选但推荐)
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new ConflictException('User already exists');
    }

    // [新增] 使用 bcrypt 加密密码 (10 是 saltRounds)
    const hashedPassword = await bcrypt.hash(password, 10);

    // [新增] 存入数据库
    const user = await this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
      },
    });

    // 返回时剔除密码
    return { id: user.id, email: user.email };
  }

  // [修改] 实现 login 方法
  async login(loginDto: any) { // 此处应替换为你实际的 LoginDto
    const { email, password } = loginDto;

    // [新增] 查找用户
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // [新增] 验证密码
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // [新增] 签发并返回 JWT Token
    const payload = { sub: user.id, email: user.email };
    return {
      access_token: this.jwtService.sign(payload),
    };
  }
}
