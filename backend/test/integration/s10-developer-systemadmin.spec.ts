import { describe, it, expect } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { SystemAdminController } from '@modules/system-admin/presentation/system-admin.controller';
import {
  can,
  CANONICAL_DOMAIN_IDS,
} from '@shared/architecture/architecture.contract';

function buildController() {
  const service = {
    overview: () => ({
      service: 'medini-crm-backend',
      version: 'test',
      environment: 'test',
      uptimeSeconds: 123,
      timestamp: new Date().toISOString(),
    }),
    readiness: async () => ({
      status: 'ready',
      dependencies: {},
    }),
  };

  return new SystemAdminController(
    service as never,
  );
}

function requestForRole(role: string) {
  return {
    principal: {
      staffId:
        '99999999-9999-9999-9999-999999999920',
      username: `${role}-test`,
      name: `${role} Test`,
      role,
      orgId:
        '00000000-0000-0000-0000-000000000001',
      branchId: null,
      doctorId: null,
    },
  } as never;
}

describe(
  'S10 - Developer system-admin boundary',
  () => {
    it(
      'developer can access system-admin overview',
      () => {
        const controller =
          buildController();

        const result =
          controller.overview(
            requestForRole('developer'),
          );

        expect(result.service).toBe(
          'medini-crm-backend',
        );

        expect(result.version).toBe(
          'test',
        );

        expect(
          typeof result.uptimeSeconds,
        ).toBe('number');

        expect(
          result.timestamp,
        ).toBeTruthy();
      },
    );

    it(
      'developer can access system-admin health and readiness',
      async () => {
        const controller =
          buildController();

        const health =
          controller.health(
            requestForRole('developer'),
          );

        expect(health.service).toBe(
          'medini-crm-backend',
        );

        const readiness =
          await controller.readiness(
            requestForRole('developer'),
          );

        expect(readiness).toBeTruthy();
      },
    );

    it(
      'non-developer roles are blocked from system-admin',
      async () => {
        const controller =
          buildController();

        for (const role of [
          'hq',
          'branch_manager',
          'branch_admin',
          'doctor',
        ]) {
          expect(() =>
            controller.overview(
              requestForRole(role),
            ),
          ).toThrow(
            ForbiddenException,
          );

          await expect(
            Promise.resolve().then(() =>
              controller.readiness(
                requestForRole(role),
              ),
            ),
          ).rejects.toBeInstanceOf(
            ForbiddenException,
          );
        }
      },
    );

    it(
      'developer is denied every canonical business-domain action',
      () => {
        const actions = [
          'view',
          'create',
          'edit',
          'submit',
          'approve',
          'delete',
        ];

        for (
          const domain of
          CANONICAL_DOMAIN_IDS
        ) {
          for (
            const action of actions
          ) {
            expect(
              can(
                'developer',
                domain,
                action,
              ),
              `developer must not ${action} ${domain}`,
            ).toBe(false);
          }
        }
      },
    );

    it(
      'unknown roles also fail closed',
      () => {
        expect(
          can(
            'unknown-role',
            'patients',
            'view',
          ),
        ).toBe(false);

        expect(
          can(
            'unknown-role',
            'appointments',
            'edit',
          ),
        ).toBe(false);

        expect(
          can(
            'unknown-role',
            'admin',
            'create',
          ),
        ).toBe(false);
      },
    );
  },
);
