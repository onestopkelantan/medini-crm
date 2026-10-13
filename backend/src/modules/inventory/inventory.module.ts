import { Module } from '@nestjs/common';
import { InventoryController } from './presentation/inventory.controller';
import { InventoryService } from './application/inventory.service';

@Module({
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
