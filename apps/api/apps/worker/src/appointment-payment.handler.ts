import {
  AppointmentRepository,
  type AppointmentPaymentWorkItem,
} from '@smartcura/database/appointments';
import { createUuidV7 } from '@smartcura/observability';

export interface AppointmentPaymentProvider {
  settle(payment: AppointmentPaymentWorkItem): Promise<'captured' | 'failed'>;
}

/** Local deterministic adapter: positive simulated intents always capture. */
export class DeterministicAppointmentPaymentProvider implements AppointmentPaymentProvider {
  async settle(payment: AppointmentPaymentWorkItem): Promise<'captured' | 'failed'> {
    return payment.amountSen > 0 && payment.currency === 'MYR' ? 'captured' : 'failed';
  }
}

export class AppointmentPaymentHandler {
  constructor(
    private readonly appointments: AppointmentRepository,
    private readonly provider: AppointmentPaymentProvider,
  ) {}

  /** False asks the outbox runtime to retry/dead-letter the event. */
  async handle(paymentId: string): Promise<boolean> {
    const payment = await this.appointments.loadPaymentWorkItem(paymentId);
    if (payment === undefined) return false;
    if (payment.state !== 'pending') return true;
    const outcome = await this.provider.settle(payment);
    const result = await this.appointments.settlePayment({
      paymentId,
      outcome,
      now: new Date(),
      correlationId: createUuidV7(),
    });
    return result === 'settled' || result === 'already_settled';
  }
}
