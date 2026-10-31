#!/usr/bin/env python3
"""Import Champions VGC M-C BO3 Stat Point spreads from Smogon monthly stats."""
from __future__ import annotations
import argparse, json, re, urllib.request
from datetime import datetime, timezone, date, timedelta
from pathlib import Path
FORMAT="gen9championsvgc2026regmcbo3"; RATING=1760
BASE="https://www.smogon.com/stats"
SPREAD=re.compile(r"^\|\s*([A-Za-z]+):(\d+)/(\d+)/(\d+)/(\d+)/(\d+)/(\d+)\s+([0-9.]+)%\s*\|$")
ALIASES={
"samurott hisui":"Samurott-Hisui","raichu alola":"Raichu-Alola","rotom frost":"Rotom-Frost","rotom mow":"Rotom-Mow","rotom fan":"Rotom-Fan","rotom heat":"Rotom-Heat","avalugg hisui":"Avalugg-Hisui","tauros de paldea (raza combate)":"Tauros-Paldea-Combat","tauros de paldea (raza ardiente)":"Tauros-Paldea-Blaze","tauros de paldea (raza acuática)":"Tauros-Paldea-Aqua","zoroark hisui":"Zoroark-Hisui","meowstic-f":"Meowstic-F","meowstic-m":"Meowstic","mega meowstic (f)":"Meowstic-F-Mega","goodra hisui":"Goodra-Hisui","persian alola":"Persian-Alola","decidueye hisui":"Decidueye-Hisui","slowking galar":"Slowking-Galar","slowbro galar":"Slowbro-Galar","stunfisk galar":"Stunfisk-Galar","mega raichu y":"Raichu-Mega-Y","mega charizard y":"Charizard-Mega-Y","mega garchomp z":"Garchomp-Mega-Z","mega absol":"Absol-Mega-Z"}
NATURES=set("adamant bashful bold brave calm careful docile gentle hardy hasty impish jolly lax lonely mild modest naive naughty quiet quirky rash relaxed sassy serious timid".split())
def norm(s): return re.sub(r"[^a-z0-9]","",s.casefold())
def source_name(name):
 if name.casefold() in ALIASES: return ALIASES[name.casefold()]
 if name.casefold().startswith("mega "): return name[5:]+"-Mega"
 return name
def default_month():
 return (date.today().replace(day=1)-timedelta(days=1)).strftime("%Y-%m")
def fetch_source(month,local):
 if local: return Path(local).read_text(encoding="utf-8"),str(local)
 url=f"{BASE}/{month}/moveset/{FORMAT}-{RATING}.txt"
 req=urllib.request.Request(url,headers={"User-Agent":"Torneo0MC-PCSpreadImporter/1.0"})
 with urllib.request.urlopen(req,timeout=90) as response: raw=response.read().decode("utf-8")
 return raw,url
def parse_moveset_file(raw,top_n=10):
 records={}; current=None; in_spreads=False; lines=raw.splitlines()
 for i,line in enumerate(lines):
  if i>0 and i+1<len(lines) and lines[i-1].startswith("+") and line.startswith("|") and lines[i+1].startswith("+"):
   title=line.strip().strip("|").strip()
   if title and not title.lower().startswith(("raw count:","avg. weight:","viability")):
    current={"sourceName":title,"rawCount":None,"spreads":[]}; records[norm(title)]=current; in_spreads=False; continue
  if current is None or not line.startswith("|"): continue
  content=line.strip().strip("|").strip()
  if content.startswith("Raw count:"):
   try: current["rawCount"]=int(content.split(":",1)[1].strip())
   except ValueError: pass
  elif content=="Spreads": in_spreads=True
  elif content in {"Abilities","Items","Moves","Teammates"}: in_spreads=False
  elif in_spreads:
   m=SPREAD.match(line)
   if not m: continue
   nature=m.group(1).lower(); points=[int(m.group(j)) for j in range(2,8)]; usage=float(m.group(8))
   if nature not in NATURES or any(v<0 or v>32 for v in points) or sum(points)!=66: continue
   current["spreads"].append({"natureId":nature,"points":points,"usagePercent":usage})
 for rec in records.values():
  rec["spreads"].sort(key=lambda x:x["usagePercent"],reverse=True); rec["spreads"]=rec["spreads"][:top_n]
  for rank,item in enumerate(rec["spreads"],1): item["rank"]=rank
 return records
def build_output(pool,source_records,month,source_url,top_n):
 pokemon={}; missing=[]; used={}
 for entry in pool:
  name=entry["name"]; key=norm(source_name(name)); rec=source_records.get(key)
  if not rec or not rec["spreads"]: missing.append(name); continue
  if key in used: raise ValueError(f"Colisión: {used[key]!r} y {name!r} apuntan a {rec['sourceName']!r}")
  used[key]=name; pokemon[name]={"sourceName":rec["sourceName"],"rawCount":rec["rawCount"],"spreads":rec["spreads"]}
 count=sum(len(x["spreads"]) for x in pokemon.values())
 return {"schemaVersion":1,"meta":{"status":"ready" if pokemon else "empty","source":"Smogon University usage stats","sourceUrl":source_url,"format":FORMAT,"formatLabel":"Pokémon Champions VGC Regulation M-C BO3","ratingCutoff":RATING,"month":month,"generatedAt":datetime.now(timezone.utc).isoformat(),"statOrder":["hp","atk","def","spa","spd","spe"],"statPointCap":32,"statPointTotal":66,"requestedTopN":top_n,"sourceExplicitSpreadLimit":6,"matchedPoolEntries":len(pokemon),"poolEntries":len(pool),"missingPoolEntries":missing,"storedSpreadCount":count,"note":"Smogon publica hasta seis repartos explícitos por especie; el resto se agrupa como Other. No se inventan repartos para completar diez."},"pokemon":pokemon}
def main():
 p=argparse.ArgumentParser(); p.add_argument("--month",default=""); p.add_argument("--pool",default="pool-data.json"); p.add_argument("--output",default="ev-spreads.json"); p.add_argument("--source-file",default=""); p.add_argument("--top",type=int,default=10); a=p.parse_args()
 month=a.month or default_month()
 if not re.fullmatch(r"\d{4}-\d{2}",month): p.error("--month debe tener formato YYYY-MM")
 if not 1<=a.top<=10: p.error("--top debe be between 1 and 10")
 pool=json.loads(Path(a.pool).read_text(encoding="utf-8")); raw,url=fetch_source(month,a.source_file); parsed=parse_moveset_file(raw,a.top); result=build_output(pool,parsed,month,url,a.top)
 Path(a.output).write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
 meta=result["meta"]; print(f"Importados {meta['storedSpreadCount']} repartos para {meta['matchedPoolEntries']}/{meta['poolEntries']} entradas.")
 if meta["missingPoolEntries"]: print("Sin datos:",", ".join(meta["missingPoolEntries"]))
 if not meta["matchedPoolEntries"]: raise SystemExit("La importación no encontró ningún Pokémon de la pool.")
if __name__=="__main__": main()
