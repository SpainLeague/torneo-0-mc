import unittest
from scripts.import_champions_spreads import parse_moveset_file, build_output
SAMPLE="""+----------------------------------------+
| Rillaboom                              |
+----------------------------------------+
| Raw count: 262229                      |
| Spreads                                |
| Adamant:32/32/0/0/0/2 1.465%           |
| Sassy:32/0/4/0/30/0 3.601%             |
| Other 87.566%                          |
+----------------------------------------+
| Moves                                  |
| Fake Out 99.885%                       |
+----------------------------------------+
+----------------------------------------+
| Sneasler                               |
+----------------------------------------+
| Raw count: 210792                      |
| Spreads                                |
| Adamant:2/32/0/0/0/32 21.641%          |
| Jolly:2/32/0/0/0/32 14.892%            |
| Other 47.260%                          |
+----------------------------------------+
| Moves                                  |
| Close Combat 99.981%                   |
"""
class ImportTests(unittest.TestCase):
 def test_parse_sort(self):
  d=parse_moveset_file(SAMPLE)
  self.assertEqual(d["rillaboom"]["rawCount"],262229)
  self.assertEqual(d["rillaboom"]["spreads"][0]["natureId"],"sassy")
  self.assertEqual(d["sneasler"]["spreads"][0]["usagePercent"],21.641)
 def test_mega_and_base(self):
  pool=[{"name":"Skarmory"},{"name":"Mega Skarmory"}]
  src={"skarmory":{"sourceName":"Skarmory","rawCount":100,"spreads":[{"natureId":"impish","points":[32,0,32,0,2,0],"usagePercent":50,"rank":1}]},"skarmorymega":{"sourceName":"Skarmory-Mega","rawCount":40,"spreads":[{"natureId":"impish","points":[32,0,32,0,2,0],"usagePercent":60,"rank":1}]}}
  self.assertEqual(len(build_output(pool,[(1760,"fixture",src)],"2026-09",10)["pokemon"]),2)
 def test_fallback_uses_lower_cutoff_and_records_it(self):
  pool=[{"name":"Skarmory"}]
  high={"skarmory":{"sourceName":"Skarmory","rawCount":20,"spreads":[]}}
  lower={"skarmory":{"sourceName":"Skarmory","rawCount":80,"spreads":[{"natureId":"impish","points":[32,0,32,0,2,0],"usagePercent":55,"rank":1}]}}
  result=build_output(pool,[(1760,"high",high),(1630,"lower",lower)],"2026-09",10)
  self.assertEqual(result["pokemon"]["Skarmory"]["ratingCutoff"],1630)
if __name__=="__main__": unittest.main()
