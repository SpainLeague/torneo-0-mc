import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,statSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8'};
let server,browser,baseUrl;

test('optimizer works in desktop and mobile browsers',async t=>{
  server=createServer((req,res)=>{
    const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
    const file=resolve(root,'.'+pathname);
    if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403).end();return}
    try{
      if(!statSync(file).isFile()){res.writeHead(404).end();return}
      res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream'});
      res.end(readFileSync(file));
    }catch{res.writeHead(404).end('Not found')}
  });
  await new Promise(resolveListen=>server.listen(0,'127.0.0.1',resolveListen));
  baseUrl='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{if(browser)await browser.close();if(server)await new Promise(resolveClose=>server.close(resolveClose))});
  browser=await chromium.launch({headless:true});

  const page=await browser.newPage({viewport:{width:1365,height:900}});
  const pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  const packageRoot=resolve(root,'node_modules/@smogon/calc/dist');
  await page.route('https://unpkg.com/@smogon/calc@0.12.0/dist/**',async route=>{
    const url=new URL(route.request().url());
    const relative=url.pathname.split('/dist/')[1];
    const file=resolve(packageRoot,relative);
    try{await route.fulfill({status:200,contentType:'application/javascript',body:readFileSync(file)})}
    catch{await route.fulfill({status:404,body:'missing pinned calculator bundle'})}
  });
  await page.goto(baseUrl+'/optimizador.html');
  await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('Datos cargados'),null,{timeout:30000});
  await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('especies compatibles 223/223'),null,{timeout:30000});
  assert.deepEqual(pageErrors,[],'The optimizer page should load without browser exceptions');

  await page.locator('#own').selectOption({label:'Inteleon'});
  const itemOptions=await page.locator('#item option').allTextContents();
  assert.ok(itemOptions.includes('Life Orb'),'A supported legal item should remain selectable');
  assert.ok(!itemOptions.includes('Choice Band'),'Items absent from the Champions engine must not be offered');
  assert.ok(!itemOptions.includes('Assault Vest'),'Items absent from the Champions engine must not be offered');

  assert.match(await page.locator('#status').textContent(),/megapiedras requeridas sin soporte: 0/,
    'Every required Mega Stone should be supported by the Champions calculator');
  await page.locator('#own').selectOption({label:'Mega Aggron'});
  assert.equal(await page.locator('#item').isDisabled(),true,'Mega forms must lock their required stone');
  assert.equal(await page.locator('#item').inputValue(),'aggronite','Mega Aggron must receive Aggronite');
  await page.locator('#own').selectOption({label:'Inteleon'});

  const kind=page.locator('#targets .target .kind').first();
  await kind.selectOption('speed-fast');
  assert.equal(await page.locator('#targets .target .speedMarginField').isVisible(),true);
  assert.equal(await page.locator('#targets .target .move').isVisible(),false);
  await page.locator('#ownTailwind').check();
  await page.locator('#prepare').click();
  await page.waitForFunction(()=>/CUMPLIDO|NO CUMPLIDO/.test(document.querySelector('#status').textContent),null,{timeout:10000});
  assert.match(await page.locator('#status').textContent(),/CUMPLIDO|NO CUMPLIDO/);

  await page.locator('#searchBest').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Búsqueda completada')||document.querySelector('#status').textContent.includes('No se pudo completar'),null,{timeout:15000});
  assert.match(await page.locator('#status').textContent(),/Búsqueda completada/);
  assert.ok(await page.locator('#searchResults .result-card').count()>0,'Speed-only heuristic search should return candidate spreads');

  await kind.selectOption('off');
  await page.locator('#own').selectOption({label:'Inteleon'});
  await page.locator('#foe').selectOption({label:'Skarmory'});
  await page.locator('#targets .target .move').selectOption({label:'Hydro Pump'});
  await page.locator('#weather').selectOption('Rain');
  await page.locator('#prepare').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Probabilidad de cumplirlo')||document.querySelector('#status').textContent.includes('No se ha podido calcular'),null);
  const offensiveBaseline=await page.locator('#status').textContent();
  assert.match(offensiveBaseline,/Probabilidad de cumplirlo/,'A real Champions damage scenario should calculate in the browser');
  const foePcInputs=page.locator('#foePC input');
  await foePcInputs.nth(4).fill('32'); // Special Defense investment on the defending rival.
  await page.locator('#prepare').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Probabilidad de cumplirlo'),null);
  const offensiveVsSpDef=await page.locator('#status').textContent();
  const damageRange=text=>text.match(/con Hydro Pump: (\d+)–(\d+) PS/);
  assert.ok(damageRange(offensiveBaseline)&&damageRange(offensiveVsSpDef),'Offensive output should expose the calculated damage range');
  assert.ok(Number(damageRange(offensiveVsSpDef)[2])<Number(damageRange(offensiveBaseline)[2]),
    'The rival manually invested in Special Defense must take less special damage');
  assert.equal(await foePcInputs.nth(4).inputValue(),'32','The manually entered rival spread must remain unchanged');

  // Add a defensive target: the same rival is now the attacker, with manually invested Attack.
  await page.locator('#addTarget').click();
  const defensiveMove=page.locator('#targets .target').nth(1).locator('.move');
  await defensiveMove.selectOption({label:'Brave Bird'});
  await foePcInputs.nth(1).fill('32');
  await page.locator('#prepare').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Objetivo 2')||document.querySelector('#status').textContent.includes('No se ha podido calcular'),null);
  const mixedOutput=await page.locator('#status').textContent();
  const defensiveRange=mixedOutput.match(/Objetivo 2 \(sobrevivir[^\n]*con Brave Bird: (\d+)–(\d+) PS/);
  assert.ok(defensiveRange,'Defensive objective should calculate damage from the rival attacker');
  assert.equal(await foePcInputs.nth(1).inputValue(),'32','The rival Attack investment must be retained for defensive evaluation');

  await page.locator('#searchBest').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Búsqueda completada')||document.querySelector('#status').textContent.includes('No se pudo completar'),null,{timeout:30000});
  assert.match(await page.locator('#status').textContent(),/Búsqueda completada/,'Mixed offensive and defensive objectives should complete the PC search');
  assert.ok(await page.locator('#searchResults .result-card').count()>0,'Damage-based search should return candidate spreads');
  assert.match(await page.locator('#searchResults').textContent(),/Pasos de transferencia: 8\/8\/8\/8\/4\/4\/2\/1 PC/,'Search results should disclose the coarse-to-fine transfer schedule');
  assert.match(await page.locator('#searchResults').textContent(),/Rival fijo: Skarmory · PC 0\/32\/0\/0\/32\/0/,
    'Search results must disclose the exact manually entered rival PC spread');
  assert.deepEqual(await foePcInputs.evaluateAll(inputs=>inputs.map(input=>input.value)),['0','32','0','0','32','0'],
    'The optimizer must not modify any of the rival PC values');
  assert.deepEqual(pageErrors,[],'Speed search, damage evaluation and mixed-objective search should not create browser exceptions');

  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(150);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
  assert.equal(overflow,false,'The optimizer should not create horizontal overflow on a 390px viewport');
});
