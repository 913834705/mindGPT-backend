// [新增] 整个文件为新增
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),//fromAuthHeaderAsBearerToken(): 告诉保安：“去 HTTP 请求的 Header 里找，字段名叫 Authorization，格式是 Bearer <token>”。
      ignoreExpiration: false,//false: 不放行！如果 Token 里的时间戳显示已过期，底层框架会自动拦截，并给前端返回 401 Unauthorized 错误
      // 注意：实际项目中应从配置/环境变量中读取 Secret
      secretOrKey: process.env.JWT_SECRET || 'fallback_secret_key', 
    });
  }

  // Token 验证成功后，解析出的 payload 会进入此方法
  async validate(payload: any) {
    return { userId: payload.sub, email: payload.email };
  }
}