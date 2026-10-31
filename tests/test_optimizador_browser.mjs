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

  const kind=page.locator('#targets .target .kind').first();
  await kind.selectOption('speed-fast');
  assert.equal(await page.locator('#targets .target .speedMarginField').isVisible(),true);
  assert.equal(await page.locator('#targets .target .move').isVisible(),false);
  await page.locator('#ownTailwind').check();
  await page.locator('#prepare').click();
  await page.waitForFunction(()=>/CUMPLIDO|NO CUMPLIDO/.test(document.querySelector('#status').textContent),null,{timeout:10000});
  assert.match(await page.locator('#status').textContent,/CUMPLIDO|NO CUMPLIDO/);

  await page.locator('#searchBest').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Búsqueda completada')||document.querySelector('#status').textContent.includes('No se pudo completar'),null,{timeout:15000});
  assert.match(await page.locator('#status').textContent,/Búsqueda completada/);
  assert.ok(await page.locator('#searchResults .result-card').count()>0,'Speed-only heuristic search should return candidate spreads');

  await kind.selectOption('off');
  await page.locator('#own').selectOption({label:'Inteleon'});
  await page.locator('#foe').selectOption({label:'Skarmory'});
  await page.locator('#targets .target .move').selectOption({label:'Hydro Pump'});
  await page.locator('#weather').selectOption('Rain');
  await page.locator('#prepare').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Probabilidad de cumplirlo')||document.querySelector('#status').textContent.includes('No se ha podido calcular'),null);
  assert.match(await page.locator('#status').textContent,/Probabilidad de cumplirlo/,'A real Champions damage scenario should calculate in the browser');
  assert.deepEqual(pageErrors,[],'Speed search and damage calculation should not create browser exceptions');

  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(150);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
  assert.equal(overflow,false,'The optimizer should not create horizontal overflow on a 390px viewport');
});
