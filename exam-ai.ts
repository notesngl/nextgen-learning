// Supabase > Edge Functions > Deploy a new function > Via Editor
// Function name: exam-ai   ("Verify JWT" OFF karein)
// Secret: ANTHROPIC_API_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (o: unknown) => new Response(JSON.stringify(o), { headers: { ...cors, "Content-Type": "application/json" } });
const LANG: Record<string, string> = {
  hi: "simple Hindi in Devanagari script",
  en: "simple English",
  hg: "Hinglish (Hindi written in Roman/English letters)",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const t = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: { user } } = await db.auth.getUser(t);
    if (!user) return J({ error: "Pehle login karein" });
    const { data: me } = await db.from("staff").select("access").eq("user_id", user.id).maybeSingle();
    if (!me || !["owner", "admin", "teacher"].includes(me.access)) return J({ error: "Is kaam ki permission nahi hai" });
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return J({ error: "ANTHROPIC_API_KEY secret set nahi hai" });

    const b = await req.json();
    const qs = String(b.questions || "").slice(0, 8000);
    if (!qs.trim()) return J({ error: "Questions khali hain" });
    const count = Math.min(Math.max(+b.count || 0, 0), 50);

    const system =
      `You are an exam-paper assistant for a small coaching centre in India. Convert the teacher's questions into multiple-choice questions (MCQ) for ${b.class}, subject ${b.subject}. ` +
      `Write everything in ${LANG[b.language] || LANG.hg}. Each MCQ has exactly 4 options and exactly one correct option. ` +
      `If the teacher already gave an answer or options, keep them. Keep the difficulty suitable for the class. ` +
      (count ? `Produce exactly ${count} MCQs; if the teacher gave fewer, add new ones on the same topics. ` : `Produce one MCQ for each question given. `) +
      `Reply with ONLY a JSON array, no other text. Format: [{"q":"question","o":["opt A","opt B","opt C","opt D"],"a":0}] where a is the index (0-3) of the correct option.`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 6000, system, messages: [{ role: "user", content: qs }] }),
    });
    const j = await r.json();
    if (!r.ok) return J({ error: "AI error: " + JSON.stringify(j.error || j).slice(0, 200) });
    const txt: string = j?.content?.[0]?.text || "";
    const arr = JSON.parse(txt.slice(txt.indexOf("["), txt.lastIndexOf("]") + 1));
    const items = (Array.isArray(arr) ? arr : []).filter((x) =>
      x && typeof x.q === "string" && Array.isArray(x.o) && x.o.length === 4 && Number.isInteger(x.a) && x.a >= 0 && x.a <= 3
    ).map((x) => ({ q: x.q, o: x.o.map(String), a: x.a }));
    if (!items.length) return J({ error: "AI se sahi MCQ nahi bane, dobara try karein" });
    return J({ items });
  } catch (e) {
    return J({ error: "Dobara try karein: " + String(e).slice(0, 120) });
  }
});
