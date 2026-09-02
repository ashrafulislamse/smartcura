import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import {
  AuthenticatedOnly, CurrentSession, RequireCsrf, type AuthenticatedSession,
} from '../platform/request-authorization.js';
import { noStore, type ResponseLike } from '../platform/response-cache.js';
import { MetricsService } from './metrics.service.js';
import { Stage11Service } from './stage11.service.js';

@Controller('admin')
@AuthenticatedOnly()
export class Stage11AdministrationController {
  constructor(
    private readonly administration: Stage11Service,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Dashboard aggregates. Read-only, so no CSRF, but each GROUP inside the response is gated on
   * the same permission as the collection it summarises and a group the caller cannot read is
   * OMITTED rather than returned as zero — a zero would leak that the group exists while
   * asserting something false, and would be indistinguishable from an empty organization.
   */
  @Get('metrics')
  metricsDashboard(@CurrentSession() current: AuthenticatedSession) {
    return this.metrics.readDashboard(current);
  }

  @Get('faqs')
  listFaqs(@CurrentSession() current: AuthenticatedSession, @Query() query: unknown) {
    return this.administration.listFaqs(current, query);
  }

  @Get('faqs/:faqEntryId')
  readFaq(@CurrentSession() current: AuthenticatedSession, @Param('faqEntryId') id: string) {
    return this.administration.readFaq(current, id);
  }

  @Post('faqs')
  @RequireCsrf('faq.create')
  createFaq(@CurrentSession() current: AuthenticatedSession, @Body() body: unknown) {
    return this.administration.createFaq(current, body);
  }

  @Put('faqs/:faqEntryId')
  @RequireCsrf('faq.update')
  updateFaq(@CurrentSession() current: AuthenticatedSession, @Param('faqEntryId') id: string, @Body() body: unknown) {
    return this.administration.updateFaq(current, id, body);
  }

  @Put('faqs/:faqEntryId/publish-state')
  @RequireCsrf('faq.publish_state')
  setFaqState(@CurrentSession() current: AuthenticatedSession, @Param('faqEntryId') id: string, @Body() body: unknown) {
    return this.administration.setFaqState(current, id, body);
  }

  /** Deletion is a soft archive so published content history is never erased. */
  @Delete('faqs/:faqEntryId')
  @RequireCsrf('faq.archive')
  archiveFaq(@CurrentSession() current: AuthenticatedSession, @Param('faqEntryId') id: string, @Body() body: unknown) {
    return this.administration.archiveFaq(current, id, body);
  }

  @Get('notification-templates')
  templates(@CurrentSession() current: AuthenticatedSession) {
    return this.administration.listTemplates(current);
  }

  @Post('notification-templates')
  @RequireCsrf('notification_template.create')
  createTemplate(@CurrentSession() current: AuthenticatedSession, @Body() body: unknown) {
    return this.administration.createTemplate(current, body);
  }

  @Get('notification-templates/:templateKey/versions')
  templateVersions(@CurrentSession() current: AuthenticatedSession, @Param('templateKey') key: string) {
    return this.administration.templateVersions(current, key);
  }

  @Post('notification-templates/:templateKey/versions')
  @RequireCsrf('notification_template.version_create')
  addTemplateVersion(@CurrentSession() current: AuthenticatedSession, @Param('templateKey') key: string, @Body() body: unknown) {
    return this.administration.addTemplateVersion(current, key, body);
  }

  @Put('notification-templates/:templateKey/active-version')
  @RequireCsrf('notification_template.activate')
  activateTemplateVersion(@CurrentSession() current: AuthenticatedSession, @Param('templateKey') key: string, @Body() body: unknown) {
    return this.administration.activateTemplateVersion(current, key, body);
  }

  @Get('broadcasts')
  broadcasts(@CurrentSession() current: AuthenticatedSession) {
    return this.administration.listBroadcasts(current);
  }

  @Post('broadcasts')
  @RequireCsrf('broadcast.create')
  createBroadcast(@CurrentSession() current: AuthenticatedSession, @Body() body: unknown) {
    return this.administration.createBroadcast(current, body);
  }

  @Put('broadcasts/:broadcastMessageId/schedule')
  @RequireCsrf('broadcast.schedule')
  scheduleBroadcast(@CurrentSession() current: AuthenticatedSession, @Param('broadcastMessageId') id: string, @Body() body: unknown) {
    return this.administration.scheduleBroadcast(current, id, body);
  }

  /**
   * 200, not Nest's POST default of 201: sending queues an EXISTING broadcast for
   * delivery rather than creating a subordinate resource, and the contract says 200.
   */
  @Post('broadcasts/:broadcastMessageId/send')
  @RequireCsrf('broadcast.send')
  @HttpCode(200)
  sendBroadcast(@CurrentSession() current: AuthenticatedSession, @Param('broadcastMessageId') id: string, @Body() body: unknown) {
    return this.administration.sendBroadcast(current, id, body);
  }

  @Get('custom-roles')
  customRoles(@CurrentSession() current: AuthenticatedSession) {
    return this.administration.listCustomRoles(current);
  }

  /**
   * The assignable-permission catalogue. Powers the custom-role permission
   * editor. Gated on custom_role:manage:organization so only callers who can
   * actually edit custom roles may see the vocabulary. Read-only, no CSRF.
   */
  @Get('permissions')
  permissions(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    noStore(response);
    return this.administration.listPermissions(current);
  }

  @Post('custom-roles')
  @RequireCsrf('custom_role.create')
  createCustomRole(@CurrentSession() current: AuthenticatedSession, @Body() body: unknown) {
    return this.administration.createCustomRole(current, body);
  }

  @Put('custom-roles/:customRoleId')
  @RequireCsrf('custom_role.update')
  updateCustomRole(@CurrentSession() current: AuthenticatedSession, @Param('customRoleId') id: string, @Body() body: unknown) {
    return this.administration.updateCustomRole(current, id, body);
  }

  @Put('custom-roles/:customRoleId/permissions')
  @RequireCsrf('custom_role.permissions_replace')
  replacePermissions(@CurrentSession() current: AuthenticatedSession, @Param('customRoleId') id: string, @Body() body: unknown) {
    return this.administration.replaceCustomRolePermissions(current, id, body);
  }

  @Put('memberships/:membershipId/custom-role')
  @RequireCsrf('membership.custom_role_assign')
  assignCustomRole(@CurrentSession() current: AuthenticatedSession, @Param('membershipId') id: string, @Body() body: unknown) {
    return this.administration.assignCustomRole(current, id, body);
  }

  @Get('settings/:settingKey/versions')
  settingVersions(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
    @Param('settingKey') key: string,
  ) {
    noStore(response);
    return this.administration.settingVersions(current, key);
  }

  @Get('maintenance')
  maintenance(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    noStore(response);
    return this.administration.maintenance(current);
  }

  @Put('maintenance')
  @RequireCsrf('platform.maintenance_update')
  updateMaintenance(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
    @Body() body: unknown,
  ) {
    noStore(response);
    return this.administration.updateMaintenance(current, body);
  }

  /**
   * 200, not Nest's POST default of 201: replay requeues an EXISTING outbox event and
   * creates no resource. The contract says 200 and the two must not disagree.
   */
  @Post('dead-letters/:eventId/replay')
  @RequireCsrf('outbox.dead_letter_replay')
  @HttpCode(200)
  replayDeadLetter(
    @CurrentSession() current: AuthenticatedSession,
    @Param('eventId') eventId: string,
    @Body() body: unknown,
  ) {
    return this.administration.replayDeadLetter(current, eventId, body);
  }
}
