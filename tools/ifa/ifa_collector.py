#!/usr/bin/env python3
"""iPlays IFA discovery collector. Public pages only; no bypassing access controls."""
import argparse, json, re, time
from pathlib import Path
from urllib.parse import urljoin, urlparse, parse_qs, urlencode
import requests
from bs4 import BeautifulSoup

BASE='https://www.football.org.il'
ROSTER_ITEM='{2AE09DED-5019-4C49-BFD5-4458C66F9D24}'
HEADERS={'User-Agent':'iPlaysResearchCollector/0.1 (public-pages; respectful-rate-limit)', 'Accept-Language':'he-IL,he;q=0.9,en;q=0.7'}

def clean(s): return re.sub(r'\s+',' ',s or '').strip()
def make_url(path,params): return BASE+path+'?'+urlencode(params)
def fetch(session,url,out,stem):
    r=session.get(url,headers=HEADERS,timeout=30)
    if r.status_code in (403,429): raise RuntimeError(f'Access restricted ({r.status_code}) at {url}; stop and obtain permission.')
    r.raise_for_status()
    (out/f'{stem}.html').write_text(r.text,encoding='utf-8')
    return BeautifulSoup(r.text,'html.parser')

def load_saved(path):
    # A page the owner saved from their own browser (Ctrl+S). No network access.
    return BeautifulSoup(Path(path).read_text(encoding='utf-8',errors='replace'),'html.parser')

def roster_players(soup):
    # Players only: links inside #teamPlayers (staff are in #teamStaff and are skipped).
    box=soup.select_one('#teamPlayers')
    if box is None:return None
    out=[];seen=set()
    for a in box.select('a[href*="/players/player/"]'):
        url=urljoin(BASE,a.get('href',''))
        pid=parse_qs(urlparse(url).query).get('player_id',[None])[0]
        if not pid or pid in seen:continue
        seen.add(pid)
        t=a.select_one('.text')
        out.append({'ifa_player_id':pid,'name':clean(t.get_text(' ',strip=True)) if t else clean(a.get_text(' ',strip=True)),'profile_url':url})
    return out

def discover(soup,source):
    found=[]; seen=set()
    for a in soup.select('a[href]'):
        url=urljoin(source,a.get('href',''))
        if urlparse(url).netloc not in ('www.football.org.il','football.org.il'):continue
        q=parse_qs(urlparse(url).query)
        if not any(k in q for k in ('team_id','league_id','season_id','tournament_id')):continue
        key=(url,clean(a.get_text(' ',strip=True)))
        if key in seen:continue
        seen.add(key)
        found.append({'label':key[1], 'url':url, 'team_id':q.get('team_id',[None])[0], 'season_id':q.get('season_id',[None])[0], 'league_id':q.get('league_id',[None])[0], 'tournament_id':q.get('tournament_id',[None])[0]})
    return found

def section(soup,pattern):
    # Conservative extraction: do not treat staff or navigation as players.
    node=soup.find(string=re.compile(pattern))
    if not node:return []
    heading=node.parent
    results=[]
    for sib in heading.next_elements:
        if getattr(sib,'name',None) in ('h1','h2','h3','h4') and sib is not heading:
            if re.search('בעלי תפקידים|צוות מקצועי|משחקים',clean(sib.get_text(' ',strip=True))):break
        if getattr(sib,'name',None) in ('a','li'):
            label=clean(sib.get_text(' ',strip=True))
            if 3<=len(label)<=65 and re.search(r'[א-ת]',label) and not re.search('בעלי תפקידים|סגל שחקנים|מאמן|מנהל|עמוד הבית',label):
                results.append({'name':label,'href':urljoin(BASE,sib.get('href','')) if sib.name=='a' and sib.get('href') else None})
        if len(results)>150:break
    unique={p['name']:p for p in results}
    return list(unique.values())

def tables(soup):
    result=[]
    for table in soup.select('table'):
        rows=[]
        for tr in table.select('tr'):
            cells=[clean(c.get_text(' ',strip=True)) for c in tr.find_all(['th','td'],recursive=False)]
            if cells:rows.append(cells)
        if rows:result.append(rows)
    return result

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--team',type=int,default=7491)
    ap.add_argument('--season',type=int,default=28)
    ap.add_argument('--out',default='ifa_output')
    ap.add_argument('--saved',help='folder with team.html / roster.html / games.html saved from a browser; no network access')
    args=ap.parse_args();out=Path(args.out);out.mkdir(parents=True,exist_ok=True)
    sources={
      'team':make_url('/team-details/',{'team_id':args.team,'season_id':args.season}),
      'roster':make_url('/team-details/',{'itemid':ROSTER_ITEM,'team_id':args.team,'season_id':args.season}),
      'games':make_url('/team-details/team-games/',{'team_id':args.team,'season_id':args.season}),
    }
    session=requests.Session(); pages={}; errors={}
    if args.saved:
        for name in sources:
            f=Path(args.saved)/f'{name}.html'
            if f.exists():pages[name]=load_saved(f)
            else:errors[name]=f'missing saved file {f}'
    else:
        for i,(name,url) in enumerate(sources.items()):
            if i:time.sleep(2)
            try:pages[name]=fetch(session,url,out,name)
            except (requests.RequestException,RuntimeError) as exc:errors[name]=str(exc)
    links=[]
    for name,soup in pages.items():links.extend(discover(soup,sources[name]))
    uniq={x['url']:x for x in links}
    roster=section(pages['roster'],r'סגל שחקנים') if 'roster' in pages else []
    players=None
    for name in ('roster','team'):
        if name in pages and players is None:players=roster_players(pages[name])
    if players is None and pages:errors['players']='#teamPlayers not found in the saved pages; inspect roster.html'
    # Only treat extracted names as candidates until verified against saved HTML.
    result={
      'team_id':args.team,'season_id':args.season,'source_urls':sources,
      'discovered_links':list(uniq.values()),
      'players':players or [],
      'roster_candidates_unverified':roster,
      'roster_table_rows':tables(pages['roster']) if 'roster' in pages else [],
      'games_table_rows':tables(pages['games']) if 'games' in pages else [],
      'page_titles':{k:clean(v.title.get_text(' ',strip=True)) if v.title else None for k,v in pages.items()},
      'errors':errors,
      'notes':['Roster candidates are heuristic; verify against roster.html before import.',
               'Game tables are raw rows, not normalized fixtures.',
               'Discovery covers links on the fetched pages, not every team or league in Israel.']
    }
    (out/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(out/'result.json'),'links':len(uniq),'roster_candidates':len(roster),'game_tables':len(result['games_table_rows']),'errors':errors},ensure_ascii=False,indent=2))

if __name__=='__main__':main()
