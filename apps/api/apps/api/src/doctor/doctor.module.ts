import { Module } from '@nestjs/common';
import { PostgresConnection } from '@smartcura/database';
import { DoctorController } from './doctor.controller.js';
import { DoctorService } from './doctor.service.js';
import { DoctorDashboardRepository } from './doctor-dashboard.repository.js';

/**
 * Doctor dashboard and analytics module.
 *
 * This module is self-contained so the coordinator can wire it into `AppModule` with a
 * single import. It declares the controller, provides the service, and provides the
 * `DoctorDashboardRepository` through the same `PostgresConnection` factory pattern
 * `AppModule` uses for every other repository.
 *
 * The repository is EXPORTED so that `packages/database/src/index.ts` does not need to
 * change: the repository lives in the API module directory and is provided here, not
 * re-exported from the database package. The coordinator should either import this
 * module into `AppModule.forRoot` or register the controller and providers directly in
 * `AppModule`'s `controllers` and `providers` arrays, following the pattern used for
 * `WorkstreamFController` / `WorkstreamFService` / `WorkstreamFRepository`.
 */
@Module({
  controllers: [DoctorController],
  providers: [
    {
      provide: DoctorDashboardRepository,
      useFactory: (connection: PostgresConnection) =>
        new DoctorDashboardRepository(connection),
      inject: [PostgresConnection],
    },
    {
      provide: DoctorService,
      useFactory: (repository: DoctorDashboardRepository) =>
        new DoctorService(repository),
      inject: [DoctorDashboardRepository],
    },
  ],
  exports: [DoctorDashboardRepository, DoctorService],
})
export class DoctorModule {}
