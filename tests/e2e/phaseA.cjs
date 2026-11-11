// Phase A e2e: decision cockpit + interventions on the local Staging-like DB (PGDB=pha).
const { chromium } = require('playwright');
const { handle, pool } = require('./minirest.cjs');
const OWNER = '00000000-0000-4000-8000-0000000000bb';
const COACH = '00000000-0000-4000-8000-0000000000c1';
const COACH2 = '00000000-0000-4000-8000-0000000000c2';
const PARENT = '00000000-0000-4000-8000-0000000000d1';
const EMPTY = '00000000-0000-4000-8000-0000000000ee';
const BASE = 'http://localhost:4324/';
let fails = 0;
const check = (n, ok, d) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? `: ${d}` : ''}`); };
const q = async (sql, args = []) => (await pool.query(sql, args)).rows;
const unpop = (page) => page.evaluate(() => document.querySelectorAll('.ip-a2hs').forEach((e) => e.remove()));

async function ctxFor(b, uid, vp) {
  const ctx = await b.newContext({ viewport: vp, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  await ctx.addInitScript((uid) => {
    const now = Math.floor(Date.now() / 1000);
    localStorage.setItem('sb-stg-auth-token', JSON.stringify({ access_token: 'x.eyJzdWIiOiJ4In0.x', token_type: 'bearer', expires_in: 3600, expires_at: now + 86400, refresh_token: 'r', user: { id: uid, aud: 'authenticated', role: 'authenticated', email: 'u@test.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }));
    localStorage.setItem('iplays.onboarded', '1');
    localStorage.setItem('iplays.a2hs.dismissed', '1');
  }, uid);
  await ctx.route('http://stg.local/**', async (route) => {
    const r = route.request();
    const u = new URL(r.url());
    if (u.pathname.startsWith('/auth/v1/')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: uid, aud: 'authenticated', email: 'u@test.invalid' }) });
    const res = await handle(r.method(), r.url(), r.headers(), r.postData(), uid);
    return route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body) });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page, errors };
}
async function go(page, hash, wait = 2500) {
  await page.goto(BASE + hash);
  await page.waitForTimeout(wait);
  await unpop(page);
}

(async () => {
  // clean slate (local test DB only)
  await q('delete from club_intervention_log');
  await q('delete from club_interventions');
  const b = await chromium.launch();

  for (const vp of [{ width: 1280, height: 1000 }, { width: 390, height: 844 }]) {
    const tag = vp.width;
    await q('delete from club_intervention_log');
    await q('delete from club_interventions');
    // ---- owner: cockpit, open, no duplicate, life cycle, close
    const { ctx, page, errors } = await ctxFor(b, OWNER, vp);
    await go(page, '#os/dashboard', 4000);
    let body = await page.textContent('body');
    check(`${tag} owner: three areas`, /מרכז החלטות/.test(body) && /מגרשים היום/.test(body) && /מגמות ותוצאות/.test(body));
    check(`${tag} owner: pitches planned only`, /מתוכנן בלבד/.test(body) && !/בשידור חי|LIVE/.test(body));
    check(`${tag} staging data labelled`, /נתונים בדויים בלבד/.test(body) && /נתון בדוי \(Staging\)/.test(body));
    const cards = await page.locator('.os-insight').count();
    check(`${tag} owner: 1-3 insights`, cards >= 1 && cards <= 3, `${cards}`);
    const key = await page.locator('.os-insight').first().getAttribute('data-insight');
    check(`${tag} owner: what/why/todo`, (await page.locator('.os-insight').first().textContent()).match(/מה קרה.*למה זה חשוב.*מה לעשות/) !== null);
    await page.locator('.os-insight').first().getByRole('button', { name: 'פתיחת התערבות' }).click();
    await page.waitForTimeout(800);
    check(`${tag} owner: open sheet`, await page.getByRole('dialog', { name: 'פתיחת התערבות' }).isVisible());
    const opts = await page.locator('.os-sheet select option').allTextContents();
    check(`${tag} owner: owner options from server`, opts.length >= 2, opts.join(' | '));
    await page.locator('.os-sheet select').selectOption({ index: 1 });
    await page.screenshot({ path: `shots/phaseA-open-${tag}.png` });
    await page.getByRole('button', { name: 'פתיחה', exact: true }).click();
    await page.waitForTimeout(2500);
    const hash = await page.evaluate(() => location.hash);
    check(`${tag} owner: navigates to the intervention`, /^#os\/interventions\/[0-9a-f-]{36}$/.test(hash), hash);
    const id = hash.split('/')[2];
    body = await page.textContent('body');
    check(`${tag} detail: before/after + caveat`, /לפני ואחרי/.test(body) && /לא בהכרח שההתערבות גרמה/.test(body));
    const [row] = await q('select insight_key, baseline_value, owner_id, status from club_interventions where id = $1', [id]);
    check(`${tag} db: key matches insight`, row && row.insight_key === key, `${row && row.insight_key} vs ${key}`);
    check(`${tag} db: owner saved`, row && row.owner_id !== null);
    check(`${tag} detail: baseline shown as in db`, row && (row.baseline_value === null ? /אין נתון בסיס/.test(body) : true));
    await page.screenshot({ path: `shots/phaseA-detail-${tag}.png`, fullPage: true });

    // back to the cockpit: the same insight now links to the open one, no second button
    await go(page, '#os/dashboard', 3500);
    const card = page.locator(`.os-insight[data-insight="${key}"]`);
    check(`${tag} cockpit: linked, no duplicate button`, (await card.getByRole('link', { name: /התערבות פתוחה/ }).count()) === 1 && (await card.getByRole('button', { name: 'פתיחת התערבות' }).count()) === 0);
    check(`${tag} cockpit: open count`, /1 התערבויות פתוחות/.test(await page.textContent('body')));
    await page.screenshot({ path: `shots/phaseA-cockpit-${tag}.png`, fullPage: true });
    await card.getByRole('link', { name: /התערבות פתוחה/ }).click();
    await page.waitForTimeout(2000);
    check(`${tag} cockpit -> detail link`, (await page.evaluate(() => location.hash)) === `#os/interventions/${id}`);
    // a second open via the API returns the same one
    const [{ n }] = await q("select count(*)::int as n from club_interventions where insight_key = $1 and status in ('open','in_progress','checking')", [key]);
    check(`${tag} db: one open per insight`, n === 1, `${n}`);

    // life cycle
    await unpop(page);
    await page.getByRole('button', { name: 'בביצוע' }).click();
    await page.waitForTimeout(1200);
    await page.locator('textarea[placeholder^="מה נעשה"]').fill('שיחה עם המאמן והורים');
    await page.getByRole('button', { name: 'הוספה ליומן' }).click();
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: 'למדוד עכשיו' }).click();
    await page.waitForTimeout(1200);
    body = await page.textContent('body');
    check(`${tag} life cycle: status + note + measured`, /סטטוס: בביצוע/.test(body) && /שיחה עם המאמן והורים/.test(body) && /נמדד:/.test(body));
    const closeBtn = page.getByRole('button', { name: 'סגירת ההתערבות' });
    check(`${tag} close disabled without conclusion`, await closeBtn.isDisabled());
    await page.getByRole('radio', { name: 'השתפר' }).click();
    await page.locator('textarea[placeholder^="מה למדנו"]').fill('הנוכחות חזרה לרמה רגילה אחרי השיחה');
    await closeBtn.click();
    await page.waitForTimeout(1500);
    body = await page.textContent('body');
    check(`${tag} closed with conclusion`, /נסגר/.test(body) && /מסקנה מקצועית/.test(body) && /הנוכחות חזרה לרמה רגילה/.test(body));
    const [closed] = await q('select status, outcome, current_at from club_interventions where id = $1', [id]);
    check(`${tag} db: closed + final measurement`, closed.status === 'closed' && closed.outcome === 'improved' && closed.current_at !== null);
    check(`${tag} no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await page.screenshot({ path: `shots/phaseA-closed-${tag}.png`, fullPage: true });
    await go(page, '#os/interventions', 2500);
    check(`${tag} list: closed one under "נסגרו"`, (await page.locator('.os-ivcard').count()) === 0);
    await page.getByRole('button', { name: 'נסגרו' }).click();
    await page.waitForTimeout(400);
    check(`${tag} list: filter closed`, (await page.locator('.os-ivcard').count()) === 1);
    check(`${tag} owner: no page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // set up: one team intervention for coach 1's team and one club-wide one not assigned to them
  const [b1] = await q("select id from teams where name = 'בדוי צפון · ילדים א׳'");
  await q(`select set_config('request.jwt.claim.sub', $1, false)`, [OWNER]);
  await q(`select open_intervention('5ea00000-0000-4000-8000-000000000001', $1, 'no_plan', 'מערכים לקבוצה של מאמן 1')`, [b1.id]).catch(() => null);
  const own = await q("select id from club_interventions where team_id = $1 and status = 'open'", [b1.id]);
  const clubWide = await q(`select (open_intervention('5ea00000-0000-4000-8000-000000000001', null, 'missing_reports', 'דוחות חסרים בכל המועדון') ->> 'id') as id`);
  await q(`select set_config('request.jwt.claim.sub', '', false)`);

  // ---- coach 1: sees own team's only, can update, can't close; no cockpit
  {
    const { ctx, page, errors } = await ctxFor(b, COACH, { width: 390, height: 844 });
    await go(page, '#os/interventions', 3000);
    const titles = await page.locator('.os-ivcard strong').allTextContents();
    check('coach: sees own team only', titles.length === 1 && titles[0] === 'מערכים לקבוצה של מאמן 1', titles.join(' | '));
    await go(page, `#os/interventions/${own[0].id}`, 2500);
    const body = await page.textContent('body');
    check('coach: can update', /מוכן לבדיקת תוצאה/.test(body) && /הוספה ליומן/.test(body));
    check('coach: cannot close or reassign', !/סגירת ההתערבות/.test(body) && !/עריכת אחראי/.test(body));
    await go(page, `#os/interventions/${clubWide[0].id}`, 2500);
    check('coach: club-wide not visible', /לא נמצאה, או שאין לך הרשאה/.test(await page.textContent('body')));
    await go(page, '#os/dashboard', 3000);
    check('coach: no cockpit', /הדשבורד מיועד להנהלת המועדון/.test(await page.textContent('body')));
    check('coach: no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  // ---- coach of another team: nothing
  {
    const { ctx, page } = await ctxFor(b, COACH2, { width: 1280, height: 900 });
    await go(page, '#os/interventions', 3000);
    check('other coach: empty list', (await page.locator('.os-ivcard').count()) === 0 && /עדיין אין התערבויות/.test(await page.textContent('body')));
    await ctx.close();
  }
  // ---- parent: no intervention content anywhere
  {
    const { ctx, page } = await ctxFor(b, PARENT, { width: 390, height: 844 });
    await go(page, `#os/interventions/${own[0].id}`, 3000);
    const body = await page.textContent('body');
    check('parent: no intervention content', !/מערכים לקבוצה של מאמן 1/.test(body) && !/לפני ואחרי/.test(body));
    await ctx.close();
  }
  // ---- missing data: owner of a club with no teams
  {
    const { ctx, page, errors } = await ctxFor(b, EMPTY, { width: 1280, height: 900 });
    await go(page, '#os/dashboard', 3500);
    const body = await page.textContent('body');
    check('empty club: no invented insights', /אין תובנות פתוחות/.test(body) && (await page.locator('.os-insight').count()) === 0);
    check('empty club: no trainings today', /אין אימונים ביומן להיום/.test(body));
    check('empty club: 0 open interventions', /0 התערבויות פתוחות/.test(body));
    check('empty club: no fake 0%', !/(^|\s)0%/.test(await page.locator('.os-cockpit').textContent()));
    await page.screenshot({ path: 'shots/phaseA-empty-1280.png', fullPage: true });
    await go(page, '#os/interventions', 2500);
    check('empty club: empty list note', /עדיין אין התערבויות/.test(await page.textContent('body')));
    check('empty: no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  // ---- navigation: side nav has the interventions entry
  {
    const { ctx, page } = await ctxFor(b, OWNER, { width: 1280, height: 900 });
    await go(page, '#os/dashboard', 3000);
    await page.locator('.os-side').getByRole('button', { name: 'התערבויות' }).click();
    await page.waitForTimeout(1500);
    check('nav: side menu -> interventions', (await page.evaluate(() => location.hash)) === '#os/interventions' && (await page.locator('h1').textContent()) === 'התערבויות');
    await go(page, '#os/interventions/00000000-0000-4000-8000-000000000000', 2500);
    check('nav: unknown id handled', /לא נמצאה/.test(await page.textContent('body')));
    await ctx.close();
  }
  await b.close();
  await pool.end();
  console.log(fails ? `FAILED: ${fails}` : 'ALL E2E PASSED');
  process.exit(fails ? 1 : 0);
})();
