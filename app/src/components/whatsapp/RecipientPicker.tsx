import { usePrefs } from "@/hooks/usePrefs";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Baby,
  CalendarClock,
  Filter,
  Info,
  Stethoscope,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";

/**
 * Recipient picker for a recall / promotional blast.
 *
 * Follows the founder's mockup, adapted for a clinic:
 *
 *   - Campaign templates that pre-fill the message (recall is repetitive work).
 *   - A time window as a RANGE ("6 to 9 months"), not a single threshold,
 *     because that is how recall is actually decided.
 *   - A treatment filter driven by the catalogue, so it cannot drift from what
 *     the clinic offers.
 *   - The resulting LIST, showing when each patient was last seen and what they
 *     were treated for. The operator sees treatment detail — the PATIENT does
 *     not, which is why the message body is composed separately.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * Selecting recipients does not send anything. It hands a phone list to the
 * caller, which then goes through the blast endpoint (and its STOP-list gate).
 * Keeping the two apart means the picker can never bypass an outbound check.
 */

interface Candidate {
  patientId: string;
  mrn: string;
  name: string;
  contactPhone: string;
  lastVisitDate: string;
  daysSinceLastVisit: number;
  monthsSinceLastVisit: number;
  lastTreatment: string;
  lastTreatmentCategory: string | null;
  lastTreatmentCode: string | null;
  /** FASA 5C-E — addressing. A paediatric patient does not read their own
   *  WhatsApp, so the operator must SEE which rows are children before sending. */
  dob: string | null;
  patientType: string | null;
  guardianName: string | null;
  suggestedReason: string;
}

interface TreatmentOption {
  code: string;
  name: string;
  category: string;
}

/**
 * Whole years old, or null when the DOB is unrecorded.
 *
 * Computed in the browser because the operator is deciding who to message and
 * needs to see "this is a 7-year-old" while looking at the list — the age is a
 * decision input, not a stored attribute.
 */
function ageFrom(dob: string | null): number | null {
  if (!dob) return null;
  const born = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  const m = now.getUTCMonth() - born.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < born.getUTCDate())) age--;
  return age;
}

/** Malaysia's age of majority — matches the backend guard. */
const MINOR_AGE = 18;

/**
 * Is this patient a child?
 *
 * Mirrors the backend rule: a recorded DOB decides, and patient_type is the
 * fallback only when the DOB is missing. Keep the two in step — a list that
 * shows a row as an adult while the sender treats it as a minor would make the
 * operator's review meaningless.
 */
function isMinor(c: Candidate): boolean {
  const age = ageFrom(c.dob);
  if (age !== null) return age < MINOR_AGE;
  return /child|infant|baby|kanak/i.test(c.patientType ?? "");
}

/** Recall windows the clinic works in. */
const WINDOWS: Array<{ value: string; label?: string; labelKey?: string; min: number; max: number; hint?: string; hintKey?: string }> = [
  { value: "3-6", label: "3 – 6 bulan", min: 3, max: 6, hint: "Peringatan awal" },
  { value: "6-9", label: "6 – 9 bulan", min: 6, max: 9, hint: "Scaling berkala" },
  { value: "9-12", label: "9 – 12 bulan", min: 9, max: 12, hint: "Pembersihan tertunggak" },
  { value: "12-120", labelKey: "rp.months12", min: 12, max: 120, hintKey: "rp.lostPatient" },
];

/**
 * Campaign templates.
 *
 * IMPORTANT — NONE of these name a diagnosis or a specific treatment. WhatsApp
 * is not a secure channel: a phone can be read by someone else, and a number can
 * change hands. A message saying "your root canal is unfinished" leaks medical
 * information; a message saying "there's a follow-up we can help with" does not.
 * The treatment detail stays on this screen, where only staff see it.
 */
const TEMPLATES: Array<{
  id: string;
  label?: string;
  labelKey?: string;
  window: string;
  body: string;
}> = [
  {
    id: "scaling",
    label: "Peringatan Scaling",
    window: "6-9",
    body:
      "Salam {nama}! 👋\n\n" +
      "Kami dari Klinik Pergigian Medini {cawangan}.\n\n" +
      "Sudah lebih 6 bulan sejak lawatan terakhir anda. Pembersihan gigi berkala " +
      "disyorkan setiap 6 bulan untuk menjaga kesihatan gusi.\n\n" +
      "Boleh kami bantu aturkan temujanji?\n👉 {link}\n\n" +
      "Terima kasih!",
  },
  {
    id: "tertunggak",
    labelKey: "rp.pendingTreatment",
    window: "3-6",
    body:
      "Salam {nama}! 👋\n\n" +
      "Kami dari Klinik Pergigian Medini {cawangan}.\n\n" +
      "Kami perasan ada temujanji yang boleh kami bantu sambung. " +
      "Boleh kami aturkan masa yang sesuai untuk anda?\n\n" +
      "👉 {link}\n\n" +
      "Terima kasih!",
  },
  {
    id: "hilang",
    label: "Kami Rindukan Anda",
    window: "12-120",
    body:
      "Salam {nama}! 👋\n\n" +
      "Kami dari Klinik Pergigian Medini {cawangan}. Sudah lama kita tidak bertemu.\n\n" +
      "Kesihatan gigi anda masih penting, jom buat pemeriksaan berkala. " +
      "Kami sediakan slot untuk anda.\n\n" +
      "👉 {link}\n\n" +
      "Jumpa lagi!",
  },
  {
    id: "kanak",
    label: "Pemeriksaan Kanak-kanak",
    window: "6-9",
    body:
      "Salam! 👋\n\n" +
      "Kami dari Klinik Pergigian Medini {cawangan}.\n\n" +
      "Sudah tiba masa pemeriksaan gigi berkala untuk anak anda. " +
      "Pemeriksaan awal membantu mengelak masalah gigi kemudian hari.\n\n" +
      "👉 {link}\n\n" +
      "Terima kasih!",
  },
  {
    id: "promosi",
    label: "Promosi Musiman",
    window: "3-6",
    body:
      "Salam {nama}! 🎉\n\n" +
      "Promosi istimewa di Klinik Pergigian Medini {cawangan}!\n\n" +
      "Slot terhad. Boleh kami bantu aturkan temujanji anda?\n👉 {link}\n\n" +
      "Terima kasih!",
  },
];

export interface RecipientSelection {
  /** Normalised phone numbers, ready for the blast endpoint. */
  phones: string[];
  /** The composed message, with tags left for the sender to substitute.
   *  Tag substitution happens at SEND time, per recipient: {nama} resolves to
   *  the guardian for a child, which the picker cannot know for a whole list. */
  body: string;
  /** Destination for the {link} tag; empty when the template has no link. */
  bookingUrl: string;
  /** Human-readable summary of the filter, for the audit trail. */
  description: string;
}

export default function RecipientPicker({
  branchId,
  branchName,
  onUse,
}: {
  branchId: string;
  branchName: string;
  onUse: (selection: RecipientSelection) => void;
}) {
  const { t } = usePrefs();
  const [windowValue, setWindowValue] = useState("6-9");
  const [category, setCategory] = useState("all");
  const [treatmentCode, setTreatmentCode] = useState("all");
  const [templateId, setTemplateId] = useState<string>("scaling");
  const [body, setBody] = useState(TEMPLATES[0]!.body);
  const [showList, setShowList] = useState(false);
  /* The {link} destination. Kept in the picker rather than the parent so the
   * preview below can show the real address the patient will receive. */
  const [bookingUrl, setBookingUrl] = useState("");

  const win = WINDOWS.find((w) => w.value === windowValue) ?? WINDOWS[1]!;

  const treatments = useQuery({
    queryKey: ["treatments"],
    queryFn: () => api.get<TreatmentOption[]>("/marketing/treatments"),
  });

  const candidates = useQuery({
    queryKey: ["picker-candidates", branchId, windowValue, category, treatmentCode],
    queryFn: () => {
      const p = new URLSearchParams({
        branchId,
        minMonths: String(win.min),
        maxMonths: String(win.max),
        limit: "200",
      });
      if (category !== "all") p.set("treatmentCategory", category);
      if (treatmentCode !== "all") p.set("treatmentCode", treatmentCode);
      return api.get<Candidate[]>(`/marketing/scrubbing-candidates?${p.toString()}`);
    },
    enabled: Boolean(branchId),
  });

  const rows = candidates.data ?? [];

  /** Categories present in the catalogue, for the first level of filtering. */
  const categories = useMemo(() => {
    const set = new Set((treatments.data ?? []).map((t) => t.category));
    return [...set].sort();
  }, [treatments.data]);

  const treatmentsInCategory = useMemo(() => {
    const all = treatments.data ?? [];
    return category === "all" ? all : all.filter((t) => t.category === category);
  }, [treatments.data, category]);

  function applyTemplate(id: string) {
    const tpl = TEMPLATES.find((x) => x.id === id);
    if (!tpl) return;
    setTemplateId(id);
    setWindowValue(tpl.window);
    setBody(tpl.body);
  }

  /** Compose the final message with the branch name substituted. */
  const composed = useMemo(
    () => body.replace(/\{cawangan\}/g, branchName),
    [body, branchName],
  );

  /* What the patient's screen will show.
   *
   * Substitution itself happens at SEND time on the server, per recipient —
   * {nama} resolves to the guardian for a child, which cannot be decided for a
   * whole list in the browser. This is the same substitution applied to a sample
   * patient so the operator can judge the real text, and it uses the same tag
   * set the server accepts so the two cannot disagree. */
  const previewText = useMemo(
    () =>
      composed
        .replace(/\{nama\}/gi, "Puan Siti Aminah")
        .replace(/\{anak\}/gi, "Nur Aisyah")
        .replace(/\{link\}/gi, bookingUrl.trim() || "{link}"),
    [composed, bookingUrl],
  );

  const canUse = rows.length > 0 && composed.trim().length > 0;

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------------- templates */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h3 className="font-bold text-foreground">{t("rp.campaignTemplate")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Klik untuk isi sasaran dan mesej secara automatik.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {TEMPLATES.map((tpl) => (
            <Button
              key={tpl.id}
              type="button"
              size="sm"
              variant={templateId === tpl.id ? "default" : "outline"}
              onClick={() => applyTemplate(tpl.id)}
            >
              {tpl.labelKey ? t(tpl.labelKey) : tpl.label}
            </Button>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------------- targeting */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <header className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-foreground" />
          <h3 className="font-bold text-foreground">{t("rp.audience")}</h3>
        </header>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="win">{t("wa.rp.lastVisit")}</Label>
            <Select value={windowValue} onValueChange={setWindowValue}>
              <SelectTrigger id="win" className="mt-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WINDOWS.map((w) => (
                  <SelectItem key={w.value} value={w.value}>
                    {w.labelKey ? t(w.labelKey) : w.label}
                    <span className="ml-2 text-xs text-muted-foreground">{w.hintKey ? t(w.hintKey) : w.hint}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="cat">{t("rp.lastTreatmentCat")}</Label>
            <Select
              value={category}
              onValueChange={(v) => {
                setCategory(v);
                setTreatmentCode("all");
              }}
            >
              <SelectTrigger id="cat" className="mt-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("rp.allCat")}</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="sm:col-span-2">
            <Label htmlFor="trt">{t("rp.specificTreatment")}</Label>
            <Select value={treatmentCode} onValueChange={setTreatmentCode}>
              <SelectTrigger id="trt" className="mt-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("rp.allTreatment")}</SelectItem>
                {treatmentsInCategory.map((t) => (
                  <SelectItem key={t.code} value={t.code}>
                    {t.name}
                    <span className="ml-2 text-xs text-muted-foreground">{t.category}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {treatmentCode !== "all" && (
              <p className="mt-1 text-xs text-muted-foreground">
                Hanya pesakit yang rawatan terakhirnya direkod sebagai rawatan ini
                akan disenaraikan.
              </p>
            )}
          </div>
        </div>

        {/* ------------------------------------------------------- count */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-accent p-4">
          <div className="flex items-center gap-3">
            <Users className="h-5 w-5 text-foreground" />
            <div>
              <p className="text-lg font-bold text-teal-900">
                {candidates.isLoading ? "…" : rows.length} pesakit dipilih
              </p>
              <p className="text-xs text-foreground">
                Lawatan {win.label} · kecuali yang ada temujanji · kecuali yang
                diblast 30 hari
              </p>
            </div>
          </div>
          {rows.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setShowList((v) => !v)}
            >
              {showList ? "Sembunyikan senarai" : "Lihat senarai"}
            </Button>
          )}
        </div>

        {rows.length === 0 && !candidates.isLoading && (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-muted p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              {t("rp.noMatch")}
            </p>
          </div>
        )}

        {/* -------------------------------------------------------- list */}
        {showList && rows.length > 0 && (
          <div className="mt-3 overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">{t("pt.title")}</th>
                  <th className="px-3 py-2.5 font-semibold">{t("wa.rp.lastVisit")}</th>
                  <th className="px-3 py-2.5 font-semibold">{t("br.treatment")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 50).map((c) => (
                  <tr key={c.patientId} className="border-t border-border">
                    <td className="px-3 py-2.5">
                      <p className="font-semibold text-foreground">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.mrn}</p>
                      {isMinor(c) && (
                        /* The operator must see this BEFORE sending: the message
                         * goes to the guardian, and the wording differs. */
                        <p className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-700">
                          <Baby className="h-3.5 w-3.5" />
                          {ageFrom(c.dob)} tahun
                          {c.guardianName
                            ? `, mesej kepada ${c.guardianName}`
                            : ", penjaga belum direkod"}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant="secondary">
                        {c.monthsSinceLastVisit} bulan lalu
                      </Badge>
                      <p className="mt-0.5 text-xs text-muted-foreground">{c.lastVisitDate}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="flex items-center gap-1.5 text-foreground">
                        <Stethoscope className="h-3.5 w-3.5 text-muted-foreground" />
                        {c.lastTreatment}
                      </p>
                      {c.lastTreatmentCategory && (
                        <p className="text-xs text-muted-foreground">
                          {c.lastTreatmentCategory}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 50 && (
              <p className="border-t border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
                Menunjukkan 50 daripada {rows.length}. Semua {rows.length} akan
                dihantar.
              </p>
            )}
          </div>
        )}

        <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t("wa.rp.staffOnlyNote")}
          </span>
        </p>
      </section>

      {/* ----------------------------------------------------------- message */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h3 className="font-bold text-foreground">{t("rp.messages")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Tag: <code className="rounded bg-muted px-1">{"{nama}"}</code> ·{" "}
          <code className="rounded bg-muted px-1">{"{cawangan}"}</code> ·{" "}
          <code className="rounded bg-muted px-1">{"{link}"}</code>
        </p>

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={12}
          className="mt-3 w-full rounded-xl border border-border p-3 font-mono text-sm"
        />

        {/* ------------------------------------------------------ link ---- */}
        <div className="mt-3">
          <Label htmlFor="link">Pautan tempahan (untuk tag {"{link}"})</Label>
          <input
            id="link"
            type="url"
            value={bookingUrl}
            onChange={(e) => setBookingUrl(e.target.value)}
            placeholder="https://medini.my/b/temujanji"
            className="mt-2 w-full rounded-xl border border-border px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {"{link}"} tidak boleh dibiarkan kosong, hantar akan ditolak. Kalau templat
            ini tidak guna {"{link}"}, biarkan kosong.
          </p>
        </div>

        {/* -------------------------------------------------- preview --- */}
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Pratonton WhatsApp
          </p>
          {/* A phone frame, because the operator is judging how it looks in a
              chat, not how it looks on a form. */}
          <div className="mx-auto max-w-sm overflow-hidden rounded-lg border border-border bg-[#ECE5DD] shadow-inner">
            <div className="flex items-center gap-2 bg-[#075E54] px-3 py-2 text-white">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-card text-xs font-bold">
                {branchName.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">Klinik Medini {branchName}</p>
                <p className="text-[10px] text-white/70">{t("common.online")}</p>
              </div>
            </div>
            <div className="space-y-2 p-3">
              <div className="ml-auto max-w-[85%] rounded-lg rounded-tr-none bg-[#DCF8C6] px-3 py-2 shadow-sm">
                <p className="whitespace-pre-wrap break-words text-[13px] leading-snug text-foreground">
                  {previewText}
                </p>
                <p className="mt-1 text-right text-[10px] text-muted-foreground">
                  {new Date().toLocaleTimeString("ms-MY", { hour: "2-digit", minute: "2-digit" })} ✓✓
                </p>
              </div>
            </div>
          </div>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Nama contoh. Setiap pesakit menerima nama sendiri, kanak-kanak disapa
            melalui ibubapa.
          </p>
        </div>
      </section>

      {/* ----------------------------------------------------------- action */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 shadow-lg">
        <p className="text-xs text-muted-foreground">
          {canUse
            ? `${rows.length} nombor akan dihantar ke medan Nombor Penerima`
            : "Pilih penapis yang menghasilkan sekurang-kurangnya satu pesakit"}
        </p>
        <Button
          type="button"
          disabled={!canUse}
          onClick={() =>
            onUse({
              phones: rows.map((r) => r.contactPhone),
              body: composed,
              bookingUrl: bookingUrl.trim(),
              description: `Lawatan ${win.label}${
                category !== "all" ? `, kategori ${category}` : ""
              }${treatmentCode !== "all" ? `, rawatan ${treatmentCode}` : ""}, ${rows.length} pesakit`,
            })
          }
        >
          Guna {rows.length} pesakit ini
        </Button>
      </div>
    </div>
  );
}
