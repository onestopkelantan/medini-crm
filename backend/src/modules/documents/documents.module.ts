import { Module } from '@nestjs/common';
import { AuthModule } from '../../core/auth/auth.module';
import { PatientsModule } from '../patients/patients.module';
import { DocumentsController } from './presentation/documents.controller';
import { DocumentsService } from './application/documents.service';
import { DocumentsRepository } from './infrastructure/documents.repository';
import { DocumentStorageService } from './infrastructure/document-storage.service';

/**
 * DocumentsModule — Documents domain (Sprint 8).
 * Imports PatientsModule to reuse PatientsReadPort for doctor own-scope narrowing.
 */
@Module({
  imports: [AuthModule, PatientsModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentsRepository, DocumentStorageService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
