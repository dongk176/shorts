// Local only: real RankingStudio + browser media, synthetic API and range server.
// Usage: PLAYWRIGHT_MODULE_PATH=/path/to/playwright-core/index.mjs node scripts/benchmark-ranking-preview-transfer.mjs
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {mkdtemp, mkdir, writeFile, stat} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const web=path.join(root,'web');
const require=createRequire(path.join(web,'package.json'));
const {createServer}=await import(pathToFileURL(require.resolve('vite')));
assert(process.env.PLAYWRIGHT_MODULE_PATH, 'Set PLAYWRIGHT_MODULE_PATH to an installed playwright-core index.mjs');
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH));
const baseline=process.env.BENCHMARK_BASELINE || '534eb0b56249a638a8ad4172747d59ffbd49854d';
const output=process.env.BENCHMARK_OUTPUT || await mkdtemp(path.join(tmpdir(),'ranking-preview-transfer-'));
await mkdir(output,{recursive:true});
const before=path.join(output,'baseline');await mkdir(before,{recursive:true});
const files=execFileSync('git',['ls-tree','-r','--name-only',baseline,'web/app/ranking-shorts'],{cwd:root,encoding:'utf8'}).trim().split('\n');
for(const file of files){if(/\.(tsx?|css)$/.test(file))await writeFile(path.join(before,path.basename(file)),execFileSync('git',['show',`${baseline}:${file}`],{cwd:root}));}
const media=path.join(output,'fixture.mp4');
try{await stat(media);}catch{execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=720x1280:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','30','-c:v','libx264','-preset','veryfast','-crf','24','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart','-y',media],{timeout:120_000});}
const size=(await stat(media)).size;
const fixture=path.join(root,'scripts/fixtures/ranking-preview-transfer');
const framework=path.join(fixture,'framework.tsx');
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[];
const mobile=process.env.BENCHMARK_MOBILE==='1';
try{
for(const mode of (process.env.BENCHMARK_MODES || 'before,after').split(',')){
  let metrics={requests:0,bytes:0}, source=0;
  const mediaRequests=[];
  const server=await createServer({
    configFile:false, root:web, logLevel:'error', cacheDir:path.join(output,`vite-${mode}`),
    css:{postcss:{plugins:[require('tailwindcss')({content:[path.join(web,'app/**/*.{ts,tsx}'),path.join(web,'components/**/*.{ts,tsx}')]}),require('autoprefixer')()]}},
    oxc:{jsx:{runtime:'automatic'}},
    resolve:{dedupe:['react','react-dom'],alias:[
      {find:'ranking-studio',replacement:path.join(mode==='before'?before:path.join(web,'app/ranking-shorts'),'ranking-studio.tsx')},
      {find:'@/components/usage-provider',replacement:framework},
      {find:/^\.\/use-ranking-draft$/,replacement:framework},
      {find:'next/navigation',replacement:framework},
      {find:'next/link',replacement:'benchmark-link'},
      {find:'next/dynamic',replacement:'benchmark-dynamic'},
      {find:'@',replacement:web},
    ]},
    plugins:[{name:'local-benchmark',resolveId(id){if(id==='benchmark-link'||id==='benchmark-dynamic')return '\0'+id;},load(id){if(id==='\0benchmark-link')return `export {Link as default} from ${JSON.stringify(framework)}`;if(id==='\0benchmark-dynamic')return `export {dynamic as default} from ${JSON.stringify(framework)}`;},configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
      const url=new URL(req.url,'http://localhost');
      const json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
      if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml('/',`<html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#111;color:white;font-family:sans-serif}</style></head><body><div id="root"></div><script type="module" src="/@fs/${fixture}/main.tsx"></script></body></html>`));return;}
      if(url.pathname.includes('/media/')){
        let start=0,end=size-1;
        const range=/bytes=(\d+)-(\d*)/.exec(req.headers.range||'');
        if(range){start=Number(range[1]);if(range[2])end=Math.min(end,Number(range[2]));}
        metrics.requests++;mediaRequests.push({path:url.pathname,range:req.headers.range||null,start,end});
        res.writeHead(range?206:200,{'Content-Type':'video/mp4','Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':'private, no-store',...(range?{'Content-Range':`bytes ${start}-${end}/${size}`}:{})});
        const stream=createReadStream(media,{start,end,highWaterMark:64*1024});
        // Count response body writes flushed to the socket, not file reads or Content-Length.
        // Cancelled requests may have read ahead; those unsent bytes must not count.
        const write=res.write.bind(res);
        res.write=(chunk,encoding,callback)=>write(chunk,typeof encoding==='string'?encoding:undefined,error=>{
          if(!error)metrics.bytes+=Buffer.byteLength(chunk);
          const done=typeof encoding==='function'?encoding:callback;done?.(error);
        });
        stream.pipe(res);
        res.on('close',()=>stream.destroy());return;
      }
      if(url.pathname==='/api/ranking-shorts'){json(req.method==='POST'?{id:'benchmark-project'}:{projects:[]});return;}
      if(url.pathname.endsWith('/sources')){source++;json({pollUrl:`/api/benchmark-operation/${source}`});return;}
      if(url.pathname.startsWith('/api/benchmark-operation/')){const id=url.pathname.split('/').at(-1);json({status:'succeeded',result:{source:{id:`source-${id}`,duration:30,width:720,height:1280,hasAudio:true,previewReady:true,durationKnown:true}}});return;}
      if(url.pathname.startsWith('/api/')){json({});return;}
      next();
    });}}],
    server:{host:'127.0.0.1',port:0,hmr:false,fs:{allow:[root,output]}},
  });
  await server.listen();
  const address=server.httpServer.address();const origin=`http://127.0.0.1:${address.port}`;
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1100},isMobile:mobile,hasTouch:mobile});
  // Fail closed if a UI dependency attempts to contact production or another host.
  await context.route('**/*',route=>{const u=new URL(route.request().url());return u.origin===origin?route.continue():route.abort();});
  const page=await context.newPage();const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(origin);
    await page.locator('.ranking-rank-tabs button').first().waitFor();
    for(let i=0;i<3;i++){
      await page.locator('.ranking-rank-tabs button').nth(i).click();
      if(process.env.BENCHMARK_INPUT==='upload') await page.locator('input[type="file"][accept="video/*,.mkv"]').setInputFiles(media);
      else {
        await page.getByPlaceholder('쇼츠 · 릴스 · 틱톡 링크 붙여넣기').fill('https://www.instagram.com/reel/benchmark/');
        await page.locator('.ranking-source-fields button').filter({hasText:'구간 선택하기'}).click();
      }
      await page.waitForFunction(rank=>[...document.querySelectorAll('.ranking-source-player video')].some(v=>v.getAttribute('aria-label')===`${rank}위 원본 영상` && v.readyState>=2),i+1);
      if(mobile)await page.getByRole('button',{name:'장면 선택 닫기',exact:true}).click();
    }
    await page.locator('.ranking-rank-tabs button').first().click();
    await page.waitForTimeout(1500);
    await page.screenshot({path:path.join(output,`${mode}-initial.png`),fullPage:true});
    const initial={...metrics};
    const ids=await page.locator('.ranking-source-player video').evaluateAll(videos=>videos.map(v=>{v.dataset.reuseId=crypto.randomUUID();return v.dataset.reuseId;}));
    await page.evaluate(()=>{window.benchmarkVideos=[...document.querySelectorAll('.ranking-sequence-preview video')];});
    const handle=page.getByRole('slider',{name:'끝점',exact:true});
    await handle.scrollIntoViewIfNeeded();
    const box=await handle.boundingBox();assert(box);
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
    for(let i=1;i<=40;i++){await page.mouse.move(box.x+box.width/2+i*2,box.y+box.height/2);await page.waitForTimeout(35);}
    await page.mouse.up();await page.waitForTimeout(1200);
    const edited={...metrics};
    const scenarios=[{name:'end_drag_40',requests:edited.requests-initial.requests,bytes:edited.bytes-initial.bytes}];
    const startHandle=page.getByRole('slider',{name:'시작점',exact:true});
    await startHandle.scrollIntoViewIfNeeded();
    const startBox=await startHandle.boundingBox();assert(startBox);
    let mark={...metrics};
    await page.mouse.move(startBox.x+startBox.width/2,startBox.y+startBox.height/2);await page.mouse.down();
    for(let i=1;i<=40;i++){await page.mouse.move(startBox.x+startBox.width/2+i*2,startBox.y+startBox.height/2);await page.waitForTimeout(35);}
    await page.mouse.up();await page.waitForTimeout(1200);
    scenarios.push({name:'start_drag_40',requests:metrics.requests-mark.requests,bytes:metrics.bytes-mark.bytes});
    mark={...metrics};
    for(let i=0;i<18;i++){if(mobile)await page.getByRole('button',{name:'장면 선택 닫기',exact:true}).click();await page.locator('.ranking-rank-tabs button').nth(i%3).click();await page.waitForTimeout(250);}
    await page.waitForTimeout(1200);
    scenarios.push({name:'rank_switch_18',requests:metrics.requests-mark.requests,bytes:metrics.bytes-mark.bytes});
    const retained=await page.locator('.ranking-source-player video').evaluateAll(videos=>videos.map(v=>v.dataset.reuseId));
    if(mode==='after') assert.deepEqual(retained,ids,'rank switches retain original video elements');
    if(mobile)await page.getByRole('button',{name:'장면 선택 닫기',exact:true}).click();
    {
      await page.getByRole('button',{name:'전체 미리보기 재생',exact:true}).click();
      await page.waitForTimeout(5000);
      const playback=await page.locator('.ranking-sequence-preview video.is-current').evaluate(v=>({time:v.currentTime,paused:v.paused,width:v.videoWidth,height:v.videoHeight}));
      assert(playback.time>0 && !playback.paused);assert.equal(playback.width,720);assert.equal(playback.height,1280);
      await page.getByRole('button',{name:'전체 미리보기 일시 정지',exact:true}).click();
    }
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({mode,scenarios,fixtureBytes:size}));

    results.push({mode,initial,scenarios,mediaRequests});
  }catch(error){await page.screenshot({path:path.join(output,`${mode}-failure.png`),fullPage:true});console.error({mode,errors,body:(await page.locator('body').innerText()).slice(0,3000)});throw error;}
  finally{await context.close();server.httpServer.closeAllConnections();await server.close();}
}
}finally{await browser.close();}
await writeFile(path.join(output,'results.json'),JSON.stringify({fixtureBytes:size,results},null,2));
console.log(JSON.stringify({output}));
