import { Global, Module } from '@nestjs/common';
import { QueueRegistry } from './queue.registry';

@Global()
@Module({ providers: [QueueRegistry], exports: [QueueRegistry] })
export class QueueModule {}
