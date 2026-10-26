const fs=require('fs'),path=require('path'),readline=require('readline');
const {createRequire}=require('module');const req=createRequire(path.join(process.cwd(),'package.json'));
const {chromium}=req('playwright'),ffmpeg=req('ffmpeg-static'),{spawnSync}=require('child_process');const human=require('./human.cjs');
(async()=>{
 const url=process.argv[2];if(!url||!/^https?:\/\//.test(url))throw Error('Usage: node record.cjs URL [--login]');
 const root=process.cwd(),out=path.join(root,'output','demo-'+Date.now());fs.mkdirSync(out,{recursive:true});
 const context=await chromium.launchPersistentContext(path.join(root,'.demo-browser'),{channel:'chrome',headless:false,viewport:{width:1920,height:1080},deviceScaleFactor:1,args:['--window-size=1920,1080']});
 try{
 const page=context.pages()[0]||await context.newPage();await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
 if(process.argv.includes('--login')){console.log('Log in in Chrome. Do not enter credentials in this terminal. After login, return here and press Enter.');const rl=readline.createInterface({input:process.stdin,output:process.stdout});await new Promise(resolve=>rl.question('Press Enter AFTER login: ',()=>{rl.close();resolve();}));}
 await page.waitForTimeout(2000);
 const info=await page.evaluate(()=>({url:location.href,title:document.title,text:document.body.innerText,controls:Array.from(document.querySelectorAll('button,a,input,[role=button]')).map(e=>({tag:e.tagName,text:(e.innerText||e.getAttribute('aria-label')||'').slice(0,90),id:e.id,role:e.getAttribute('role'),placeholder:e.getAttribute('placeholder'),type:e.getAttribute('type'),href:e.getAttribute('href')})).slice(0,180)}));
 fs.writeFileSync(path.join(out,'inspection.json'),JSON.stringify(info,null,2));await page.screenshot({path:path.join(out,'inspection.png')});
 console.log('INSPECTION READY: '+out);console.log('Keep this terminal and Chrome open. Waiting for capture-plan.json prepared by the assistant.');
 const planPath=path.join(out,'capture-plan.json');while(!fs.existsSync(planPath)){if(!context.pages().length)throw Error('Browser closed');await human.delay(1000);}
 const plan=JSON.parse(fs.readFileSync(planPath,'utf8').replace(/^\uFEFF/,''));if(!Array.isArray(plan.actions))throw Error('Plan requires actions array');
 if(plan.actions.some(a=>!['move','click','type','scroll','zoom','wait'].includes(a.kind)))throw Error('Unsupported action');
 console.log('Recording 20 seconds. Leave this demo window alone.');await human.install(page);
 const start=performance.now(),frames=[];let running=true,actionError;
 const actionTask=(async()=>{for(const a of plan.actions){const wait=a.at*1000-(performance.now()-start);if(wait>0)await human.delay(wait);if(performance.now()-start>=20000)break;
 if(a.kind==='move')await human.move(page,a.x,a.y,a.duration||850);
 if(a.kind==='click')await human.click(page,a.selector);
 if(a.kind==='type')await human.type(page,a.selector,a.text);
 if(a.kind==='scroll')await human.scroll(page,a.y,a.duration||1400);
 if(a.kind==='zoom')await human.zoom(page,a.selector,a.scale||1.18,a.duration||1600);
 if(a.kind==='wait')await human.delay(a.duration||500);
 }})().catch(e=>{actionError=e;});
 while(performance.now()-start<20000){const time=(performance.now()-start)/1000,name='frame-'+String(frames.length).padStart(5,'0')+'.jpg';await page.screenshot({path:path.join(out,name),type:'jpeg',quality:92});frames.push({time,name});await human.delay(20);}
 await actionTask;if(actionError)throw actionError;
 let list='';frames.forEach((f,i)=>{list+="file '"+f.name+"'\nduration "+Math.max(.001,(frames[i+1]?.time??20)-f.time).toFixed(6)+'\n';});list+="file '"+frames.at(-1).name+"'\n";fs.writeFileSync(path.join(out,'frames.txt'),list);
 const r=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i','frames.txt','-vf','tpad=stop_mode=clone:stop_duration=1,fps=30,scale=1920:1080','-t','20','-an','-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart','cloudike-silent-1080p.mp4'],{cwd:out,stdio:'inherit'});if(r.status!==0)throw Error('Encoding failed');
 fs.writeFileSync(path.join(out,'capture-metrics.json'),JSON.stringify({duration:20,frames:frames.length,averageCaptureFps:frames.length/20,maximumFrameGap:Math.max(...frames.slice(1).map((f,i)=>f.time-frames[i].time))},null,2));
 console.log('DONE: '+path.join(out,'cloudike-silent-1080p.mp4'));
 }finally{await context.close();}
})().catch(e=>{console.error('Demo capture failed: '+e.message);process.exitCode=1;});
