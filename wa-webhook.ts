// Supabase > Edge Functions > Deploy a new function > Via Editor
// Function name: wa-webhook   ("Verify JWT" OFF karein)
// Secrets: WA_TOKEN, WA_PHONE_ID, WA_VERIFY_TOKEN, ANTHROPIC_API_KEY, OPENAI_API_KEY
// Kaam: parent "Voice sunein" button dabaye to AI se Hindi script + awaaz bana kar WhatsApp par voice note bhejta hai.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const E = (k: string) => Deno.env.get(k) || "";
const G = `https://graph.facebook.com/v21.0/${E("WA_PHONE_ID")}`;

Deno.serve(async (req) => {
  if (req.method === "GET") {
    const u = new URL(req.url);
    return u.searchParams.get("hub.verify_token") === E("WA_VERIFY_TOKEN") && E("WA_VERIFY_TOKEN")
      ? new Response(u.searchParams.get("hub.challenge")) : new Response("no", { status: 403 });
  }
  const b = await req.json().catch(() => ({}));
  // @ts-ignore: Supabase runtime
  EdgeRuntime.waitUntil(handle(b).catch((e) => console.error(e)));
  return new Response("ok");
});

async function handle(b: any) {
  const db = createClient(E("SUPABASE_URL"), E("SUPABASE_SERVICE_ROLE_KEY"));
  for (const en of b.entry || []) for (const ch of en.changes || []) for (const m of ch.value?.messages || []) {
    const p: string = m.button?.payload || m.interactive?.button_reply?.id || "";
    if (!p.startsWith("VOICE|")) continue;
    const sid = p.split("|")[1];
    const { data: s } = await db.from("students").select("id,name").eq("id", sid).maybeSingle();
    if (!s) continue;
    const { data: led } = await db.from("ledger").select("kind,amount").eq("person_type", "student").eq("person_id", sid);
    const due = Math.round((led || []).reduce((a, l) => a + (l.kind === "charge" ? 1 : -1) * +l.amount, 0));
    const month = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7) + "-01";
    let status = "sent", detail: string | null = null;
    try {
      let text = due > 0
        ? `नमस्ते! ${s.name} की ${due} रुपये फीस बाकी है। कृपया जल्द से जल्द जमा करें। धन्यवाद, नेक्स्टजेन लर्निंग।`
        : `नमस्ते! ${s.name} की कोई फीस बाकी नहीं है। धन्यवाद, नेक्स्टजेन लर्निंग।`;
      if (due > 0 && E("ANTHROPIC_API_KEY")) {
        const a = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": E("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({
            model: "claude-haiku-5-5", max_tokens: 250,
            system: "Tum NextGen Learning coaching (Koilabazar, Rajmahal) ki taraf se parents ko fee reminder ka voice message likhte ho. Saral, vinamra Hindi (Devanagari) me, sirf 3 chhote vakya. Sirf bolne wala text do, aur kuch nahi.",
            messages: [{ role: "user", content: `Bachhe ka naam: ${s.name}. Baaki fees: ${due} rupaye.` }],
          }),
        });
        const aj = await a.json();
        const t = aj?.content?.[0]?.text;
        if (t) text = t.trim();
      }
      const tts = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: { Authorization: "Bearer " + E("OPENAI_API_KEY"), "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "alloy", input: text, response_format: "opus", instructions: "Speak in warm, clear, simple Hindi." }),
      });
      if (!tts.ok) throw new Error("TTS: " + (await tts.text()).slice(0, 200));
      const audio = await tts.arrayBuffer();
      const fd = new FormData();
      fd.append("messaging_product", "whatsapp");
      fd.append("type", "audio/ogg");
      fd.append("file", new Blob([audio], { type: "audio/ogg" }), "voice.ogg");
      const up = await fetch(`${G}/media`, { method: "POST", headers: { Authorization: "Bearer " + E("WA_TOKEN") }, body: fd });
      const uj = await up.json();
      if (!uj.id) throw new Error("Upload: " + JSON.stringify(uj).slice(0, 200));
      const sd = await fetch(`${G}/messages`, {
        method: "POST",
        headers: { Authorization: "Bearer " + E("WA_TOKEN"), "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to: m.from, type: "audio", audio: { id: uj.id } }),
      });
      if (!sd.ok) throw new Error("Send: " + (await sd.text()).slice(0, 200));
    } catch (e) {
      status = "failed"; detail = String(e).slice(0, 300);
    }
    await db.from("reminder_log").insert({ student_id: sid, month, kind: "voice", status, detail });
  }
}
