import { Body, Controller, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import {
  AuthenticatedOnly,
  CurrentSession,
  RequireCsrf, RequirePermission, type AuthenticatedSession,
} from '../platform/request-authorization.js';
import { noStore, type ResponseLike } from '../platform/response-cache.js';
import { FinanceService } from './finance.service.js';
import { LogisticsService } from '../logistics/logistics.service.js';

/**
 * WP-13 finance routes.
 *
 * `PermissionGuard` cannot evaluate `org` scope, holding no object context, so these
 * controllers declare `@AuthenticatedOnly()` and the service proves both the permission
 * and the organization relationship. Ledger and payout responses are `no-store`: a
 * balance sheet must not sit in a shared cache.
 */
@Controller('finance')
@AuthenticatedOnly()
export class FinanceController {
  constructor(
    private readonly finance: FinanceService,
    private readonly logistics: LogisticsService,
  ) {}

  @Get('ledger/accounts')
  async ledger(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    noStore(response);
    return this.finance.ledger(current);
  }

  /** Corrections are new opposing entries. The ledger itself is append-only. */
  @Post('ledger/entries/:ledgerEntryId/reversal')
  @RequireCsrf('finance.ledger_entry_reverse')
  async reverse(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
    @Param('ledgerEntryId') ledgerEntryId: string,
    @Body() body: unknown,
  ) {
    noStore(response);
    return this.finance.reverseEntry(current, ledgerEntryId, body);
  }

  /**
   * Reviewing a driver withdrawal is a FINANCE action, not a self-service one. It first mounted
   * under `/drivers/me/...`, which would have had an administrator calling a self-scoped path to
   * act on somebody else's payout Ã¢â‚¬â€ a path should say who is acting.
   */
  @Put('withdrawals/:withdrawalId/status')
  @RequireCsrf('finance.withdrawal_status')
  async advanceWithdrawal(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
    @Param('withdrawalId') withdrawalId: string,
    @Body() body: unknown,
  ) {
    noStore(response);
    return this.logistics.advanceWithdrawal(current, withdrawalId, body);
  }

  /** Payout runs, newest period first. Payroll access, not general ledger access. */
  @Get('payout-runs')
  async payoutRuns(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
    @Query() query: unknown,
  ) {
    noStore(response);
    return this.finance.listPayoutRuns(current, query);
  }

  /** Posted ledger entries, newest first. */
  @Get('ledger/entries')
  async ledgerEntries(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
    @Query() query: unknown,
  ) {
    noStore(response);
    return this.finance.listLedgerEntries(current, query);
  }

  @Post('payout-runs')
  @RequireCsrf('finance.payout_run_create')
  async createRun(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
    @Body() body: unknown,
  ) {
    noStore(response);
    return this.finance.createPayoutRun(current, body);
  }

  @Post('payout-runs/:payoutRunId/items')
  @RequireCsrf('finance.payout_item_add')
  async addItem(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
    @Param('payoutRunId') payoutRunId: string,
    @Body() body: unknown,
  ) {
    noStore(response);
    return this.finance.addPayoutItem(current, payoutRunId, body);
  }

  @Put('payout-runs/:payoutRunId/status')
  @RequireCsrf('finance.payout_run_status')
  async advanceRun(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
    @Param('payoutRunId') payoutRunId: string,
    @Body() body: unknown,
  ) {
    noStore(response);
    return this.finance.advancePayoutRun(current, payoutRunId, body);
  }

  @Post('payout-items/:payoutItemId/settlement')
  @RequireCsrf('finance.payout_item_settle')
  async settle(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
    @Param('payoutItemId') payoutItemId: string,
    @Body() body: unknown,
  ) {
    noStore(response);
    return this.finance.settlePayoutItem(current, payoutItemId, body);
  }
}

/** Support. A requester reaches their own ticket; staff reach the organization queue. */
@Controller('support/tickets')
@AuthenticatedOnly()
export class SupportController {
  constructor(private readonly finance: FinanceService) {}

  @Post()
  @RequireCsrf('support.ticket_create')
  @RequirePermission('support.ticket:manage:own', 'support.ticket.create')
  async create(@CurrentSession() current: AuthenticatedSession, @Body() body: unknown) {
    return this.finance.createTicket(current, body);
  }

  /** The organization queue for staff; a requester sees only their own tickets. */
  @Get()
  async list(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
    @Query() query: unknown,
  ) {
    // A queue row carries no message body, but it does carry who raised what, so it is
    // never cacheable.
    noStore(response);
    return this.finance.listTickets(current, query);
  }

  @Get(':supportTicketId')
  async read(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
    @Param('supportTicketId') supportTicketId: string,
  ) {
    // A ticket body is whatever a user typed and may contain anything, so the thread is
    // never cacheable.
    noStore(response);
    return this.finance.readTicket(current, supportTicketId);
  }

  @Post(':supportTicketId/messages')
  @RequireCsrf('support.ticket_message_create')
  async message(
    @CurrentSession() current: AuthenticatedSession,
    @Param('supportTicketId') supportTicketId: string,
    @Body() body: unknown,
  ) {
    return this.finance.addTicketMessage(current, supportTicketId, body);
  }

  @Put(':supportTicketId/assignment')
  @RequireCsrf('support.ticket_assign')
  async assign(
    @CurrentSession() current: AuthenticatedSession,
    @Param('supportTicketId') supportTicketId: string,
    @Body() body: unknown,
  ) {
    return this.finance.assignTicket(current, supportTicketId, body);
  }

  @Put(':supportTicketId/status')
  @RequireCsrf('support.ticket_status')
  async advance(
    @CurrentSession() current: AuthenticatedSession,
    @Param('supportTicketId') supportTicketId: string,
    @Body() body: unknown,
  ) {
    return this.finance.advanceTicket(current, supportTicketId, body);
  }
}

/** Administration: bulk exports and organization settings. */
@Controller('admin')
@AuthenticatedOnly()
export class AdministrationController {
  constructor(private readonly finance: FinanceService) {}

  @Post('exports')
  @RequireCsrf('admin.export_request')
  async requestExport(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
    @Body() body: unknown,
  ) {
    noStore(response);
    return this.finance.requestExport(current, body);
  }

  @Get('exports/:exportJobId')
  async readExport(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
    @Param('exportJobId') exportJobId: string,
  ) {
    noStore(response);
    return this.finance.readExport(current, exportJobId);
  }

  @Get('settings')
  async settings(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    noStore(response);
    return this.finance.settings(current);
  }

  @Put('settings/:settingKey')
  @RequireCsrf('admin.setting_update')
  async updateSetting(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
    @Param('settingKey') settingKey: string,
    @Body() body: unknown,
  ) {
    noStore(response);
    return this.finance.updateSetting(current, settingKey, body);
  }
}
