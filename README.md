# NextGen Learning website

Koilabazar, Rajmahal, Jharkhand

Files: index.html (public site + staff panel, Hindi/English), admin.html, config.js, defaults.js, setup.sql, staff-admin.ts

Features: website edit, gallery (photo upload), teachers, notices, students, student and teacher attendance, fees (auto monthly), salary, fee slip (PNG / PDF / WhatsApp share), staff logins with access levels.

## Setup (ek baar)
1. supabase.com par NAYA project banayein (Bright School wala project use na karein, warna data mix ho jayega).
2. SQL Editor mein setup.sql poora paste karke Run karein.
3. Authentication > Users > Add user: apna email aur password banayein. Authentication > Sign In / Providers mein "Allow new users to sign up" band karein.
4. SQL Editor mein chalayein (apna email daalkar):
   insert into staff(user_id,email,name,post,access) select id,email,'Owner','Owner','owner' from auth.users where email='AAPKA@gmail.com';
5. Edge Functions > Deploy a new function > Via Editor: naam staff-admin, staff-admin.ts ka code paste karein, Verify JWT OFF karke Deploy karein. (Isse Staff / Login tab se naye teacher ka login banta hai.)
6. Project Settings > API se Project URL aur publishable key copy karke config.js mein daalein.
7. Website ka text, phone number, fees: login karke Website edit mein badlein.
8. GitHub par naya repo banayein, ye saari files upload karein.
9. vercel.com par GitHub se login karein > Add New Project > repo chunein > Deploy.

## Optional
Roz raat apne aap fees judne ke liye: Database > Extensions mein pg_cron ON karein, phir:
select cron.schedule('daily-accrual','30 18 * * *','select public.run_accrual()');
