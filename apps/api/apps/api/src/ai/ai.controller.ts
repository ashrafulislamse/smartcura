import {
  Body, Controller, Get, Headers, HttpCode, Param, Post, Put, Res,
} from '@nestjs/common';
import {
  AuthenticatedOnly,
  CurrentSession, RequireCsrf, RequirePermission, type AuthenticatedSession,
} from '../platform/request-authorization.js';
import { problem } from '../platform/problems.js';
import { noStore, type ResponseLike } from '../platform/response-cache.js';
import { AiService } from './ai.service.js';

@AuthenticatedOnly()
@Controller('ai/conversations')
export class AiConversationsController {
  constructor(private readonly ai: AiService) {}

  @Post()
  @RequirePermission('ai.conversation:manage:own', 'ai.conversation.create')
  @RequireCsrf('ai.conversation.create')
  async start(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.ai.startConversation(current);
  }

  @Post(':conversationId/turns')
  @HttpCode(202)
  @RequirePermission('ai.generation:create:own', 'ai.generation.create')
  @RequireCsrf('ai.generation.create')
  async submitTurn(
    @CurrentSession() current: AuthenticatedSession,
    @Param('conversationId') conversationId: string,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.ai.submitTurn(current, conversationId, body);
  }
}

@AuthenticatedOnly()
@Controller('ai/artifacts')
export class AiArtifactsController {
  constructor(private readonly ai: AiService) {}

  @Get(':artifactId')
  async get(
    @CurrentSession() current: AuthenticatedSession,
    @Param('artifactId') artifactId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.ai.getArtifact(current, artifactId);
  }

  @Put(':artifactId/review')
  @RequireCsrf('ai.artifact.review')
  async review(
    @CurrentSession() current: AuthenticatedSession,
    @Param('artifactId') artifactId: string,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.ai.review(current, artifactId, body);
  }
}

@AuthenticatedOnly()
@Controller('ai/generations')
export class AiGenerationsController {
  constructor(private readonly ai: AiService) {}

  /**
   * Resolves a generation_id to its completed artifact. Returns 404 while the
   * generation is still queued/running, so a client polls until the artifact
   * is ready.
   */
  @Get(':generationId/artifact')
  async getArtifactByGeneration(
    @CurrentSession() current: AuthenticatedSession,
    @Param('generationId') generationId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.ai.getArtifactByGeneration(current, generationId);
  }
}

function requireJson(contentType: string | undefined): void {
  if (contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    throw problem(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
  }
}
