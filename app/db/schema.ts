import {
  sqliteTable,
  integer,
  text,
  real,
  index,
} from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const id = () => integer("id").primaryKey({ autoIncrement: true });
const fk = (name: string) => integer(name);
const ts = (name: string) => integer(name, { mode: "timestamp_ms" });
const audit = () => ({
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  deletedAt: ts("deleted_at"),
});

// ---------------------------------------------------------------------------
// Organisation
// ---------------------------------------------------------------------------
export const branches = sqliteTable("branches", {
  id: id(),
  code: text("code", { length: 20 }).notNull().unique(),
  name: text("name", { length: 120 }).notNull(),
  city: text("city", { length: 80 }).notNull(),
  phone: text("phone", { length: 30 }),
  address: text("address", { length: 255 }),
  whatsappSession: text("whatsapp_session", { length: 60 }),
  whatsappConnected: integer("whatsapp_connected", { mode: "boolean" }).notNull().default(true),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  ...audit(),
});

export const roles = ["hq", "branch_manager", "branch_admin", "doctor"] as const;
export type Role = (typeof roles)[number];

export const users = sqliteTable(
  "users",
  {
    id: id(),
    branchId: fk("branch_id").references(() => branches.id),
    role: text("role", { enum: roles }).notNull(),
    name: text("name", { length: 120 }).notNull(),
    username: text("username", { length: 60 }).notNull().unique(),
    email: text("email", { length: 160 }),
    phone: text("phone", { length: 30 }),
    passwordHash: text("password_hash", { length: 255 }).notNull(),
    specialization: text("specialization", { length: 120 }),
    title: text("title", { length: 60 }),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    lastLoginAt: ts("last_login_at"),
    ...audit(),
  },
  (t) => [index("idx_users_branch").on(t.branchId), index("idx_users_role").on(t.role)],
);

export const chairs = sqliteTable("chairs", {
  id: id(),
  branchId: fk("branch_id").notNull().references(() => branches.id),
  name: text("name", { length: 60 }).notNull(),
  room: text("room", { length: 60 }),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  ...audit(),
});

// ---------------------------------------------------------------------------
// Master data
// ---------------------------------------------------------------------------
export const treatments = sqliteTable("treatments", {
  id: id(),
  code: text("code", { length: 20 }).notNull().unique(),
  name: text("name", { length: 120 }).notNull(),
  category: text("category", { length: 60 }).notNull(),
  price: real("price").notNull(),
  durationMin: integer("duration_min").notNull().default(30),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  ...audit(),
});

export const insurancePanels = sqliteTable("insurance_panels", {
  id: id(),
  name: text("name", { length: 120 }).notNull(),
  contactEmail: text("contact_email", { length: 160 }),
  contactPhone: text("contact_phone", { length: 30 }),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  ...audit(),
});

// ---------------------------------------------------------------------------
// Patients
// ---------------------------------------------------------------------------
export const patients = sqliteTable(
  "patients",
  {
    id: id(),
    branchId: fk("branch_id").notNull().references(() => branches.id),
    mrn: text("mrn", { length: 20 }).notNull().unique(),
    name: text("name", { length: 120 }).notNull(),
    phone: text("phone", { length: 30 }).notNull(),
    email: text("email", { length: 160 }),
    icNumber: text("ic_number", { length: 20 }),
    dob: text("dob", { length: 10 }),
    gender: text("gender", { enum: ["male", "female"] }),
    address: text("address", { length: 255 }),
    allergies: text("allergies", { length: 255 }),
    medicalNotes: text("medical_notes"),
    insurancePanelId: fk("insurance_panel_id").references(() => insurancePanels.id),
    insurancePolicyNo: text("insurance_policy_no", { length: 60 }),
    source: text("source", { enum: ["walkin", "whatsapp", "referral", "campaign"] }).notNull().default("walkin"),
    loyaltyPoints: integer("loyalty_points").notNull().default(0),
    lastVisitAt: ts("last_visit_at"),
    nextRecallAt: ts("next_recall_at"),
    createdById: fk("created_by_id").references(() => users.id),
    ...audit(),
  },
  (t) => [index("idx_patients_branch").on(t.branchId), index("idx_patients_phone").on(t.phone), index("idx_patients_recall").on(t.nextRecallAt)],
);

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------
export const appointmentStatuses = [
  "booked",
  "confirmed",
  "checked_in",
  "in_progress",
  "completed",
  "cancelled",
  "no_show",
] as const;

export const appointments = sqliteTable(
  "appointments",
  {
    id: id(),
    branchId: fk("branch_id").notNull().references(() => branches.id),
    patientId: fk("patient_id").notNull().references(() => patients.id),
    doctorId: fk("doctor_id").notNull().references(() => users.id),
    chairId: fk("chair_id").references(() => chairs.id),
    treatmentId: fk("treatment_id").references(() => treatments.id),
    startAt: ts("start_at").notNull(),
    endAt: ts("end_at").notNull(),
    status: text("status", { enum: appointmentStatuses }).notNull().default("booked"),
    source: text("source", { enum: ["manual", "ai", "walkin"] }).notNull().default("manual"),
    notes: text("notes", { length: 500 }),
    createdById: fk("created_by_id").references(() => users.id),
    ...audit(),
  },
  (t) => [
    index("idx_appt_branch_start").on(t.branchId, t.startAt),
    index("idx_appt_doctor_start").on(t.doctorId, t.startAt),
    index("idx_appt_patient").on(t.patientId),
  ],
);

// ---------------------------------------------------------------------------
// Clinical
// ---------------------------------------------------------------------------
export const clinicalNotes = sqliteTable(
  "clinical_notes",
  {
    id: id(),
    branchId: fk("branch_id").notNull().references(() => branches.id),
    patientId: fk("patient_id").notNull().references(() => patients.id),
    appointmentId: fk("appointment_id").references(() => appointments.id),
    doctorId: fk("doctor_id").notNull().references(() => users.id),
    diagnosis: text("diagnosis", { length: 255 }),
    notes: text("notes"),
    procedures: text("procedures"),
    ...audit(),
  },
  (t) => [index("idx_notes_patient").on(t.patientId)],
);

export const treatmentPlans = sqliteTable("treatment_plans", {
  id: id(),
  branchId: fk("branch_id").notNull().references(() => branches.id),
  patientId: fk("patient_id").notNull().references(() => patients.id),
  doctorId: fk("doctor_id").notNull().references(() => users.id),
  title: text("title", { length: 160 }).notNull(),
  status: text("status", { enum: ["proposed", "accepted", "in_progress", "completed"] }).notNull().default("proposed"),
  ...audit(),
});

export const treatmentPlanItems = sqliteTable("treatment_plan_items", {
  id: id(),
  planId: fk("plan_id").notNull().references(() => treatmentPlans.id),
  treatmentId: fk("treatment_id").references(() => treatments.id),
  description: text("description", { length: 200 }).notNull(),
  toothNo: text("tooth_no", { length: 10 }),
  qty: integer("qty").notNull().default(1),
  price: real("price").notNull(),
  status: text("status", { enum: ["pending", "done"] }).notNull().default("pending"),
  ...audit(),
});

export const prescriptions = sqliteTable("prescriptions", {
  id: id(),
  branchId: fk("branch_id").notNull().references(() => branches.id),
  patientId: fk("patient_id").notNull().references(() => patients.id),
  doctorId: fk("doctor_id").notNull().references(() => users.id),
  appointmentId: fk("appointment_id").references(() => appointments.id),
  medication: text("medication", { length: 160 }).notNull(),
  dosage: text("dosage", { length: 80 }),
  frequency: text("frequency", { length: 80 }),
  durationDays: integer("duration_days"),
  notes: text("notes", { length: 255 }),
  ...audit(),
});

// ---------------------------------------------------------------------------
// Documents & imaging
// ---------------------------------------------------------------------------
export const documents = sqliteTable(
  "documents",
  {
    id: id(),
    branchId: fk("branch_id").notNull().references(() => branches.id),
    patientId: fk("patient_id").notNull().references(() => patients.id),
    kind: text("kind", { enum: ["xray", "cbct", "opg", "photo", "before_after", "consent", "document"] }).notNull(),
    title: text("title", { length: 160 }).notNull(),
    fileUrl: text("file_url", { length: 500 }),
    uploadedById: fk("uploaded_by_id").references(() => users.id),
    ...audit(),
  },
  (t) => [index("idx_docs_patient").on(t.patientId)],
);

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------
export const invoices = sqliteTable(
  "invoices",
  {
    id: id(),
    branchId: fk("branch_id").notNull().references(() => branches.id),
    patientId: fk("patient_id").notNull().references(() => patients.id),
    number: text("number", { length: 30 }).notNull().unique(),
    status: text("status", { enum: ["issued", "partial", "paid", "refunded", "cancelled"] }).notNull().default("issued"),
    subtotal: real("subtotal").notNull(),
    tax: real("tax").notNull().default(0),
    total: real("total").notNull(),
    insuranceAmount: real("insurance_amount").notNull().default(0),
    notes: text("notes", { length: 255 }),
    issuedAt: ts("issued_at").notNull().defaultNow(),
    dueAt: ts("due_at"),
    createdById: fk("created_by_id").references(() => users.id),
    ...audit(),
  },
  (t) => [index("idx_inv_branch").on(t.branchId, t.issuedAt), index("idx_inv_patient").on(t.patientId)],
);

export const invoiceItems = sqliteTable("invoice_items", {
  id: id(),
  invoiceId: fk("invoice_id").notNull().references(() => invoices.id),
  treatmentId: fk("treatment_id").references(() => treatments.id),
  description: text("description", { length: 200 }).notNull(),
  qty: integer("qty").notNull().default(1),
  unitPrice: real("unit_price").notNull(),
  total: real("total").notNull(),
  ...audit(),
});

export const payments = sqliteTable(
  "payments",
  {
    id: id(),
    branchId: fk("branch_id").notNull().references(() => branches.id),
    invoiceId: fk("invoice_id").notNull().references(() => invoices.id),
    patientId: fk("patient_id").notNull().references(() => patients.id),
    amount: real("amount").notNull(),
    method: text("method", { enum: ["cash", "card", "ewallet", "bank_transfer", "insurance", "deposit"] }).notNull(),
    kind: text("kind", { enum: ["full", "partial", "installment", "deposit", "insurance", "refund"] }).notNull().default("full"),
    reference: text("reference", { length: 80 }),
    receivedById: fk("received_by_id").references(() => users.id),
    paidAt: ts("paid_at").notNull().defaultNow(),
    ...audit(),
  },
  (t) => [index("idx_pay_branch").on(t.branchId, t.paidAt), index("idx_pay_invoice").on(t.invoiceId)],
);

export const insuranceClaims = sqliteTable("insurance_claims", {
  id: id(),
  branchId: fk("branch_id").notNull().references(() => branches.id),
  invoiceId: fk("invoice_id").notNull().references(() => invoices.id),
  patientId: fk("patient_id").notNull().references(() => patients.id),
  panelId: fk("panel_id").references(() => insurancePanels.id),
  claimNo: text("claim_no", { length: 40 }),
  amount: real("amount").notNull(),
  status: text("status", { enum: ["submitted", "approved", "rejected", "paid"] }).notNull().default("submitted"),
  submittedAt: ts("submitted_at").notNull().defaultNow(),
  ...audit(),
});

// ---------------------------------------------------------------------------
// WhatsApp Hub
// ---------------------------------------------------------------------------
export const waConversations = sqliteTable(
  "wa_conversations",
  {
    id: id(),
    branchId: fk("branch_id").notNull().references(() => branches.id),
    patientId: fk("patient_id").references(() => patients.id),
    phone: text("phone", { length: 30 }).notNull(),
    contactName: text("contact_name", { length: 120 }).notNull(),
    status: text("status", { enum: ["ai_handled", "human_takeover", "closed"] }).notNull().default("ai_handled"),
    aiAgent: text("ai_agent", { length: 40 }).notNull().default("receptionist"),
    unreadCount: integer("unread_count").notNull().default(0),
    lastMessageAt: ts("last_message_at").notNull().defaultNow(),
    ...audit(),
  },
  (t) => [index("idx_wa_branch").on(t.branchId, t.lastMessageAt)],
);

export const waMessages = sqliteTable(
  "wa_messages",
  {
    id: id(),
    conversationId: fk("conversation_id").notNull().references(() => waConversations.id),
    direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
    sender: text("sender", { enum: ["patient", "ai", "staff"] }).notNull(),
    body: text("body").notNull(),
    status: text("status", { enum: ["sent", "delivered", "read", "failed"] }).notNull().default("delivered"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_msg_conv").on(t.conversationId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// AI Manager
// ---------------------------------------------------------------------------
export const aiAgents = [
  "receptionist",
  "booking",
  "followup",
  "recall",
  "payment_reminder",
  "campaign",
  "review",
  "analyst",
] as const;

export const aiLogs = sqliteTable(
  "ai_logs",
  {
    id: id(),
    branchId: fk("branch_id").references(() => branches.id),
    agent: text("agent", { enum: aiAgents }).notNull(),
    action: text("action", { length: 120 }).notNull(),
    conversationId: fk("conversation_id").references(() => waConversations.id),
    detail: text("detail"),
    confidence: real("confidence"),
    escalated: integer("escalated", { mode: "boolean" }).notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_ai_branch").on(t.branchId, t.createdAt)],
);

export const aiPrompts = sqliteTable("ai_prompts", {
  id: id(),
  agent: text("agent", { enum: aiAgents }).notNull(),
  name: text("name", { length: 120 }).notNull(),
  prompt: text("prompt").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const knowledgeBase = sqliteTable("knowledge_base", {
  id: id(),
  category: text("category", { length: 60 }).notNull(),
  question: text("question", { length: 255 }).notNull(),
  answer: text("answer").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  ...audit(),
});

// ---------------------------------------------------------------------------
// Marketing
// ---------------------------------------------------------------------------
export const campaigns = sqliteTable("campaigns", {
  id: id(),
  branchId: fk("branch_id").references(() => branches.id),
  name: text("name", { length: 160 }).notNull(),
  type: text("type", { enum: ["broadcast", "recall", "birthday", "promotion", "review"] }).notNull(),
  segment: text("segment", { length: 120 }),
  message: text("message"),
  status: text("status", { enum: ["draft", "scheduled", "running", "completed"] }).notNull().default("draft"),
  sentCount: integer("sent_count").notNull().default(0),
  deliveredCount: integer("delivered_count").notNull().default(0),
  respondedCount: integer("responded_count").notNull().default(0),
  scheduledAt: ts("scheduled_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------
export const tasks = sqliteTable("tasks", {
  id: id(),
  branchId: fk("branch_id").notNull().references(() => branches.id),
  title: text("title", { length: 200 }).notNull(),
  assigneeId: fk("assignee_id").references(() => users.id),
  status: text("status", { enum: ["open", "in_progress", "done"] }).notNull().default("open"),
  dueAt: ts("due_at"),
  ...audit(),
});

export const incidentLogs = sqliteTable("incident_logs", {
  id: id(),
  branchId: fk("branch_id").notNull().references(() => branches.id),
  title: text("title", { length: 200 }).notNull(),
  severity: text("severity", { enum: ["low", "medium", "high"] }).notNull().default("low"),
  status: text("status", { enum: ["open", "resolved"] }).notNull().default("open"),
  detail: text("detail"),
  reportedById: fk("reported_by_id").references(() => users.id),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------
export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: id(),
    userId: fk("user_id").references(() => users.id),
    branchId: fk("branch_id").references(() => branches.id),
    module: text("module", { length: 60 }).notNull(),
    action: text("action", { length: 60 }).notNull(),
    entity: text("entity", { length: 60 }),
    entityId: text("entity_id", { length: 40 }),
    detail: text("detail", { length: 500 }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_audit_branch").on(t.branchId, t.createdAt)],
);

export const settings = sqliteTable("settings", {
  id: id(),
  key: text("key", { length: 80 }).notNull().unique(),
  value: text("value"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type Branch = typeof branches.$inferSelect;
export type User = typeof users.$inferSelect;
export type Patient = typeof patients.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
export type Treatment = typeof treatments.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type WaConversation = typeof waConversations.$inferSelect;
export type WaMessage = typeof waMessages.$inferSelect;
export type AiLog = typeof aiLogs.$inferSelect;
