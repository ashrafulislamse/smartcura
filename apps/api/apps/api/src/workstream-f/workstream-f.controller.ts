import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import {
  AuthenticatedOnly,
  CurrentSession,
  type AuthenticatedSession,
} from '../platform/request-authorization.js';
import { noStore, type ResponseLike } from '../platform/response-cache.js';
import { WorkstreamFService } from './workstream-f.service.js';

@Controller()
@AuthenticatedOnly()
export class WorkstreamFController {
  constructor(private readonly service: WorkstreamFService) {}

  @Get('doctor/patients')
  assignedPatients(
    @CurrentSession() current: AuthenticatedSession, @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ) { noStore(response); return this.service.assignedPatients(current, query); }

  @Get('doctor/patients/:patient_profile_id')
  assignedPatient(
    @CurrentSession() current: AuthenticatedSession, @Param('patient_profile_id') patientProfileId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ) { noStore(response); return this.service.assignedPatient(current, patientProfileId); }

  @Get('organizations/:organization_id/patients')
  patients(
    @CurrentSession() current: AuthenticatedSession,
    @Param('organization_id') organizationId: string,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    noStore(response);
    return this.service.patients(current, organizationId, query);
  }

  @Get('organizations/:organization_id/patients/:patient_profile_id')
  patient(
    @CurrentSession() current: AuthenticatedSession,
    @Param('organization_id') organizationId: string,
    @Param('patient_profile_id') patientProfileId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    noStore(response);
    return this.service.patient(current, organizationId, patientProfileId);
  }

  @Get('organizations/:organization_id/verification-queue')
  verification(
    @CurrentSession() current: AuthenticatedSession,
    @Param('organization_id') organizationId: string,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    noStore(response);
    return this.service.verification(current, organizationId, query);
  }

  @Get('organizations/:organization_id/audit-logs')
  audit(
    @CurrentSession() current: AuthenticatedSession,
    @Param('organization_id') organizationId: string,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    noStore(response);
    return this.service.audit(current, organizationId, query);
  }
}
