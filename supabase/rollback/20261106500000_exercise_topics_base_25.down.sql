-- Rollback of 20261106500000_exercise_topics_base_25.sql.
-- Removes only what that migration added: the 15 base exercises it inserted
-- (by title, base library only, and only if no session plan uses them), the
-- topics column, trigger, RPC and topics table. The first 10 base exercises stay.
-- Run only with a separate approval.
delete from public.exercises x
where x.scope = 'iplays' and x.title in (
  'סריקה לפני קבלה: צבע הקונוס', 'קואורדינציה בסולם וקונוסים ויציאה למסירה', 'משחק תופסת עם כדור ביד',
  'רונדו 5 נגד 2 עם מסירה מפצלת', 'רונדו 4 נגד 2 עם מעבר לריבוע השני', 'שמירת כדור 3 אזורים: לעבור דרך האמצע',
  'מסירת עומק לריצה מאחורי קו', 'משולש מסירות: קבלה בגוף פתוח ומסירה לצד השני', '5 נגד 5 עם אזור עומק',
  '4 נגד 4 + 2: הגנה קבוצתית ומרווחים', 'מעבר להגנה: 3 נגד 3 עם חזרה מהירה', 'חטיפה ועומק: לנצל את הרגע שאחרי',
  'הגנה 2 נגד 2: לחץ וכיסוי', 'שוער: יציאה לכדור עומק ומשחק רגל', 'קרן קצרה: שלושה מסלולי ריצה')
  and not exists (select 1 from public.session_plan_blocks b where b.exercise_id = x.id)
  and not exists (select 1 from public.session_plan_stations s where s.exercise_id = x.id);
drop function if exists public.set_exercise_topics(uuid, text[]);
drop trigger if exists exercises_topics_guard on public.exercises;
drop function if exists public.exercises_topics_guard();
drop index if exists public.exercises_topics_idx;
alter table public.exercises drop column if exists topics;
drop table if exists public.exercise_topics;
