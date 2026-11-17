// Supabase > Edge Functions > Deploy a new function > Via Editor
// Function name: fee-reminder   ("Verify JWT" OFF karein)
// Secrets: WA_TOKEN, WA_PHONE_ID, CRON_SECRET
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (o: unknown) => new Response(JSON.stringify(o), { headers: { ...cors, "Content-Type": "application/json" } });
const E = (k: string) => Deno.env.get(k) || "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const db = createClient(E("SUPABASE_URL"), E("SUPABASE_SERVICE_ROLE_KEY"));
    const cron = !!E("CRON_SECRET") && req.headers.get("x-cron-secret") === E("CRON_SECRET");
    if (!cron) {
      const t = (req.headers.get("Authorization") || "").replace("Bearer ", "");
      const { data: { user } } = await db.auth.getUser(t);
      if (!user) return J({ error: "Pehle login karein" });
      const { data: me } = await db.from("staff").select("access").eq("user_id", user.id).maybeSingle();
      if (!me || !["owner", "admin"].includes(me.access)) return J({ error: "Sirf Admin ye kar sakta hai" });
    }
    if (!E("WA_TOKEN") || !E("WA_PHONE_ID")) return J({ error: "WhatsApp setup baaki hai (WA_TOKEN, WA_PHONE_ID)" });
    const { data: cfg } = await db.from("reminder_cfg").select("*").eq("id", 1).single();
    const ist = new Date(Date.now() + 5.5 * 3600e3).toISOString();
    const day = +ist.slice(8, 10), month = ist.slice(0, 7) + "-01";
    if (cron && (!cfg.enabled || day !== cfg.day)) return J({ skipped: "aaj ka din nahi ya band hai" });
    try { await db.rpc("run_accrual"); } catch (_) { /* ignore */ }

    const { data: led } = await db.from("ledger").select("person_id,kind,amount").eq("person_type", "student");
    const due: Record<string, number> = {};
    (led || []).forEach((l) => { due[l.person_id] = (due[l.person_id] || 0) + (l.kind === "charge" ? 1 : -1) * +l.amount; });
    const { data: st } = await db.from("students").select("id,name,phone,family_id");
    const { data: fams } = await db.from("families").select("id,phone");
    const fp: Record<string, string> = {};
    (fams || []).forEach((x) => { fp[x.id] = x.phone || ""; });
    const { data: done } = await db.from("reminder_log").select("student_id").eq("month", month).eq("kind", "text").eq("status", "sent");
    const sent = new Set((done || []).map((x) => x.student_id));
    const ml = new Date(month + "T00:00:00Z").toLocaleDateString("hi-IN", { month: "long", year: "numeric", timeZone: "UTC" });

    // Bhai-behan ek parivar me: ek hi message, kul baki ke saath
    const groups = new Map<string, { ids: string[]; names: string[]; due: number; phone: string }>();
    for (const s of st || []) {
      const d = due[s.id] || 0;
      if (d <= 0) continue;
      const k = s.family_id || s.id;
      const g = groups.get(k) || { ids: [], names: [], due: 0, phone: "" };
      g.ids.push(s.id); g.names.push(s.name); g.due += d;
      const ph = (s.family_id && fp[s.family_id]) || s.phone || "";
      if (!g.phone && String(ph).replace(/\D/g, "").length >= 10) g.phone = ph;
      groups.set(k, g);
    }

    let ok = 0, skip = 0, bad = 0;
    for (const g of groups.values()) {
      const ph = String(g.phone).replace(/\D/g, "");
      if (ph.length < 10 || g.ids.some((i) => sent.has(i))) { skip++; continue; }
      const comps: unknown[] = [{ type: "body", parameters: [g.names.join(", "), String(Math.round(g.due)), ml].map((text) => ({ type: "text", text })) }];
      if (cfg.voice) comps.push({ type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: "VOICE|" + g.ids[0] }] });
      const r = await fetch(`https://graph.facebook.com/v21.0/${E("WA_PHONE_ID")}/messages`, {
        method: "POST",
        headers: { Authorization: "Bearer " + E("WA_TOKEN"), "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp", to: ph.length === 10 ? "91" + ph : ph, type: "template",
          template: { name: cfg.template_name, language: { code: cfg.lang }, components: comps },
        }),
      });
      const j = await r.json().catch(() => ({}));
      for (const sid of g.ids) {
        await db.from("reminder_log").insert({
          student_id: sid, month, kind: "text", status: r.ok ? "sent" : "failed",
          detail: r.ok ? null : JSON.stringify(j.error || j).slice(0, 300),
        });
      }
      r.ok ? ok++ : bad++;
      await new Promise((res) => setTimeout(res, 200));
    }
    return J({ sent: ok, skipped: skip, failed: bad });
  } catch (e) {
    return J({ error: String(e) });
  }
});
