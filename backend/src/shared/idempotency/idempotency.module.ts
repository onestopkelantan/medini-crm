import { Global, Module } from '@nestjs/common';
import { IdempotencyService, InMemoryIdempotencyAdapter, IDEMPOTENCY_PORT } from './idempotency.service';

@Global()
@Module({
  providers: [InMemoryIdempotencyAdapter, { provide: IDEMPOTENCY_PORT, useExisting: InMemoryIdempotencyAdapter }, IdempotencyService],
  exports: [IdempotencyService, IDEMPOTENCY_PORT],
})
export class IdempotencyModule {}
