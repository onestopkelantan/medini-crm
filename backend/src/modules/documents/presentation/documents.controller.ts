import {
  Controller, Get, Post, Patch, Body, Req, Query, Param, ParseUUIDPipe,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentsService } from '../application/documents.service';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; /* keep in sync with DocumentsService.MAX_BYTES */

/** Minimal shape of a Multer file — local to avoid an @types/multer dependency. */
interface MulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Controller({ path: 'documents', version: '1' })
export class DocumentsController {
  constructor(private readonly service: DocumentsService) {}

  /** POST /api/v1/documents/upload — multipart: field `file` + text meta. */
  @Post('upload')
  @RequirePermission('documents', 'create')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  upload(
    @Req() req: AuthedRequest,
    @UploadedFile() file: MulterFile | undefined,
    @Body() body: unknown,
  ) {
    return this.service.upload(
      req.principal!,
      file
        ? { originalName: file.originalname, mimeType: file.mimetype, size: file.size, buffer: file.buffer }
        : undefined,
      body,
    );
  }

  /** GET /api/v1/documents — list, filter by patientId / status. */
  @Get()
  @RequirePermission('documents', 'view')
  list(
    @Req() req: AuthedRequest,
    @Query('patientId') patientId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.list(req.principal!, {
      patientId,
      status,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  /** GET /api/v1/documents/:id — metadata + short-lived signed URL (preview/download). */
  @Get(':id')
  @RequirePermission('documents', 'view')
  getById(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('download') download?: string,
  ) {
    return this.service.getById(req.principal!, id, download === '1' || download === 'true');
  }

  /** PATCH /api/v1/documents/:id/status — archive / delete (soft) / reactivate. */
  @Patch(':id/status')
  @RequirePermission('documents', 'edit')
  changeStatus(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.changeStatus(req.principal!, id, body);
  }
}
