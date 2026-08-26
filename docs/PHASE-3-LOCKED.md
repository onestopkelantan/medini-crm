# PHASE 3 — COMPLETE

**Role-Based Dashboard & Workspace Architecture**

## Scope
4 role workspaces:
- **HQ** — all branches, financial truth, semua modul
- **Branch Manager** — own branch, financial truth (scoped), branch doctors
- **Receptionist** (`branch_admin`) — front-desk: Patients, Appointments, WhatsApp, Operations. NO financial truth
- **Doctor** — own doctor + own branch: schedule, clinical, production sendiri

## 4 Layers
1. **Identity** — header/avatar/role/greeting/sidebar
2. **Navigation** — `navByRole` (AppLayout) + `roleGuard` (App.tsx)
3. **Workspace** — `BusinessDashboard` / `ReceptionistDashboard` / `DoctorDashboard`
4. **Data** — server-side scoping (scopeBranch, doctorId=self, permissionMatrix)

## Status
```text
COMPLETE (dikunci bersama Phase 3.1)
```

## Evidence
- UI smoke 47/47 PASS merentas 4 role (login, dashboard, nav, route protection, session isolation)
- TypeScript 0 errors; production build PASS
