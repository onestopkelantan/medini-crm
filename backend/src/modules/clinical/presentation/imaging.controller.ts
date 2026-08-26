import {
  Controller, Get, Post, Body, Req, Query,
} from '@nestjs/common';
import { ClinicalExtendedService } from '../application/clinical-extended.service';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';

/**
 * ImagingController — imaging/document METADATA only (Sprint 3 discovery
 * decision). No storage engine, no presigned URLs, no file pipeline — the
 * Documents domain (future sprint) owns bytes. `fileRef` is an opaque
 * storage reference string.
 */
@Controller({ path: 'clinical/imaging', version: '1' })
export class ImagingController {
  constructor(private readonly service: ClinicalExtendedService) {}

  @Post()
  @RequirePermission('clinical', 'create')
  create(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.createImaging(req.principal!, body);
  }

  @Get()
  @RequirePermission('clinical', 'view')
  list(
    @Req() req: AuthedRequest,
    @Query('patientId') patientId?: string,
    @Query('encounterId') encounterId?: string,
    @Query('kind') kind?: string,
  ) {
    return this.service.listImaging(req.principal!, { patientId, encounterId, kind });
  }
}
