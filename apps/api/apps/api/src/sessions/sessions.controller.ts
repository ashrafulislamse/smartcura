import {
  Body, Controller, Delete, Get, Headers, HttpCode, Post, Put, Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  AuthenticatedOnly,
  CurrentSession,
  type AuthenticatedSession,
  PublicRoute,
  RequireCsrf,
} from '../platform/request-authorization.js';
import { noStore, type ResponseLike } from '../platform/response-cache.js';
import { clearedSessionCookie } from './session-security.js';
import { SessionsService } from './sessions.service.js';

@AuthenticatedOnly()
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Post()
  @PublicRoute()
  @HttpCode(201)
  // Sign-in is public and IP-keyed, so a strict budget caps credential-stuffing
  // attempts from one source. 5 attempts per 60 seconds is the same ceiling the
  // contract implies for a human recovering a mistyped password.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async create(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    const result = await this.sessions.create(authorization, body);
    if (result.setCookie !== undefined) response.setHeader('Set-Cookie', result.setCookie);
    return result.body;
  }

  @Get('current')
  async current(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return (await this.sessions.current(current)).body;
  }

  // 200, not Nest's POST default of 201: refresh rotates the token of an existing
  // session and creates no resource. The contract declares 200.
  @Post('refresh')
  @HttpCode(200)
  @RequireCsrf('session.refresh')
  // Token rotation is profile-keyed but still sensitive: a leaked CSRF token
  // could be replayed to mint fresh sessions. 10 per 60 seconds is well above any
  // legitimate client's refresh cadence.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async refresh(
    @Headers('authorization') authorization: string | undefined,
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    const result = await this.sessions.refresh(authorization, current);
    if (result.setCookie !== undefined) response.setHeader('Set-Cookie', result.setCookie);
    return result.body;
  }

  // 200 for the same reason as refresh: the existing session is elevated in place.
  @Post('step-up')
  @HttpCode(200)
  @RequireCsrf('session.step_up')
  // Step-up elevates privileges, so it is the most abuse-sensitive mutation on a
  // session. 5 per 60 seconds caps privilege-escalation probing.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async stepUp(
    @Headers('authorization') authorization: string | undefined,
    @CurrentSession() current: AuthenticatedSession,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    const result = await this.sessions.stepUp(authorization, current, body);
    if (result.setCookie !== undefined) response.setHeader('Set-Cookie', result.setCookie);
    return result.body;
  }

  @Put('current/active-role')
  @RequireCsrf('session.active_role.select')
  async selectActiveRole(
    @CurrentSession() current: AuthenticatedSession,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    const result = await this.sessions.selectActiveRole(current, body);
    if (result.setCookie !== undefined) response.setHeader('Set-Cookie', result.setCookie);
    return result.body;
  }

  @Delete('current')
  @RequireCsrf('session.revoke')
  @HttpCode(204)
  async revoke(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<void> {
    noStore(response);
    await this.sessions.revoke(current);
    response.setHeader('Set-Cookie', clearedSessionCookie());
  }
}
