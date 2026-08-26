import { Body, Controller, Get, Param, Patch, Post, Query, Req, ParseUUIDPipe } from '@nestjs/common';
import { RequirePermission } from '../../../core/auth/decorators';
import { AuthedRequest } from '../../../core/auth/auth.guard';
import { OperationsService } from '../application/operations.service';

@Controller({ path: 'operations', version: '1' })
export class OperationsController {
  constructor(private readonly service: OperationsService) {}
  @Post('doctor-status') @RequirePermission('operations', 'create') setDoctorStatus(@Req() req: AuthedRequest, @Body() body: unknown) { return this.service.setDoctorStatus(req.principal!, body); }
  @Get('doctor-status') @RequirePermission('operations', 'view') listDoctorStatuses(@Req() req: AuthedRequest, @Query('branchId') branchId?: string) { return this.service.listDoctorStatuses(req.principal!, branchId); }
  @Post('checklists') @RequirePermission('operations', 'create') createChecklist(@Req() req: AuthedRequest, @Body() body: unknown) { return this.service.createChecklist(req.principal!, body); }
  @Get('checklists') @RequirePermission('operations', 'view') listChecklists(@Req() req: AuthedRequest, @Query('branchId') branchId?: string) { return this.service.listChecklists(req.principal!, branchId); }
  @Patch('checklists/:id/status') @RequirePermission('operations', 'edit') checklistStatus(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.service.transitionChecklist(req.principal!, id, body); }
  @Post('tasks') @RequirePermission('operations', 'create') createTask(@Req() req: AuthedRequest, @Body() body: unknown) { return this.service.createTask(req.principal!, body); }
  @Get('tasks') @RequirePermission('operations', 'view') listTasks(@Req() req: AuthedRequest, @Query('branchId') branchId?: string) { return this.service.listTasks(req.principal!, branchId); }
  @Patch('tasks/:id/status') @RequirePermission('operations', 'edit') taskStatus(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.service.transitionTask(req.principal!, id, body); }
  @Post('lab-cases') @RequirePermission('operations', 'create') createLabCase(@Req() req: AuthedRequest, @Body() body: unknown) { return this.service.createLabCase(req.principal!, body); }
  @Get('lab-cases') @RequirePermission('operations', 'view') listLabCases(@Req() req: AuthedRequest, @Query('branchId') branchId?: string) { return this.service.listLabCases(req.principal!, branchId); }
  @Patch('lab-cases/:id/status') @RequirePermission('operations', 'edit') labCaseStatus(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.service.transitionLabCase(req.principal!, id, body); }
  @Post('incidents') @RequirePermission('operations', 'create') createIncident(@Req() req: AuthedRequest, @Body() body: unknown) { return this.service.createIncident(req.principal!, body); }
  @Get('incidents') @RequirePermission('operations', 'view') listIncidents(@Req() req: AuthedRequest, @Query('branchId') branchId?: string) { return this.service.listIncidents(req.principal!, branchId); }
  @Patch('incidents/:id/status') @RequirePermission('operations', 'edit') incidentStatus(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.service.transitionIncident(req.principal!, id, body); }
}
