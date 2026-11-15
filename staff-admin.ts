// Supabase > Edge Functions > Deploy a new function > Via Editor
// Function name: staff-admin   (Settings mein "Verify JWT" OFF karein)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown) =>
  new Response(JSON.stringify(o), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
const lc = (s: unknown) => String(s || "").trim().toLowerCase();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "Pehle login karein" });
    const { data: me } = await admin.from("staff").select("access").eq("user_id", user.id).maybeSingle();
    if (!me || !["owner", "admin"].includes(me.access)) return json({ error: "Sirf Admin ye kar sakta hai" });
    const isOwner = me.access === "owner";
    const b = await req.json();

    if (b.action === "create") {
      const email = lc(b.email), pw = String(b.password || "");
      if (!email.includes("@") || pw.length < 8) return json({ error: "Sahi Gmail aur 8+ akshar ka password daalein" });
      if (!["admin", "teacher", "staff"].includes(b.access)) return json({ error: "Access galat hai" });
      if (b.access === "admin" && !isOwner) return json({ error: "Admin sirf Owner bana sakta hai" });
      const { data: cu, error: ce } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
      if (ce) return json({ error: ce.message });
      const { error: ie } = await admin.from("staff").insert({
        user_id: cu.user.id, email, name: b.name || "", post: b.post || "", access: b.access,
      });
      if (ie) { await admin.auth.admin.deleteUser(cu.user.id); return json({ error: ie.message }); }
      return json({ ok: true });
    }

    const { data: t } = await admin.from("staff").select("*").eq("user_id", b.user_id).maybeSingle();
    if (!t) return json({ error: "Staff nahi mila" });

    if (b.action === "make_owner") {
      if (!isOwner) return json({ error: "Sirf Owner ye kar sakta hai" });
      if (t.user_id === user.id) return json({ error: "Aap pehle se Owner hain" });
      const r1 = await admin.from("staff").update({ access: "owner" }).eq("user_id", t.user_id);
      if (r1.error) return json({ error: r1.error.message });
      await admin.from("staff").update({ access: "admin" }).eq("user_id", user.id);
      return json({ ok: true });
    }

    if (t.access === "owner" || t.user_id === user.id) return json({ error: "Owner ya khud ko nahi badal sakte" });
    if (t.access === "admin" && !isOwner) return json({ error: "Admin ko sirf Owner badal sakta hai" });

    if (b.action === "update") {
      const patch: Record<string, string> = {};
      if (b.access) {
        if (!["admin", "teacher", "staff"].includes(b.access)) return json({ error: "Access galat hai" });
        if (b.access === "admin" && !isOwner) return json({ error: "Admin sirf Owner bana sakta hai" });
        patch.access = b.access;
      }
      if (b.name !== undefined) patch.name = b.name;
      if (b.post !== undefined) patch.post = b.post;
      if (Object.keys(patch).length) {
        const r = await admin.from("staff").update(patch).eq("user_id", t.user_id);
        if (r.error) return json({ error: r.error.message });
      }
      if (b.password) {
        if (String(b.password).length < 8) return json({ error: "Password 8+ akshar ka rakhein" });
        const r = await admin.auth.admin.updateUserById(t.user_id, { password: String(b.password) });
        if (r.error) return json({ error: r.error.message });
      }
      return json({ ok: true });
    }

    if (b.action === "remove") {
      const r = await admin.auth.admin.deleteUser(t.user_id);
      if (r.error) return json({ error: r.error.message });
      return json({ ok: true });
    }
    return json({ error: "Unknown action" });
  } catch (e) {
    return json({ error: String((e as Error).message || e) });
  }
});
