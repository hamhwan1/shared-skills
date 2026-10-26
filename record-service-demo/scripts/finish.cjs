// Run with: node finalize-video.cjs. Secrets are read only from the project .env.
const fs=require('fs'),path=require('path');
const {spawnSync}=require('child_process');
const req=require('module').createRequire(require('path').join(process.cwd(),'package.json'));
const ffmpeg=req('ffmpeg-static');
const root=process.cwd(),dir=path.resolve(process.argv[2]||'output');
const scenes=JSON.parse(fs.readFileSync(path.join(dir,'narration-script.json'),'utf8').replace(/^\uFEFF/,'')).scenes;
if(!Array.isArray(scenes)||!scenes.length||scenes[0].start!==0.5||scenes.at(-1).end!==19.5||scenes.some((s,i)=>!s.text||s.end<=s.start||(i>0&&s.start!==scenes[i-1].end)))throw Error('Scenes must be contiguous from 0.5 to 19.5 seconds');
function run(args){const r=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-y',...args],{cwd:dir,encoding:'utf8'});if(r.status!==0)throw Error('Video/audio processing failed. Check local FFmpeg installation.');}
function duration(file){const r=spawnSync(ffmpeg,['-hide_banner','-i',file],{cwd:dir,encoding:'utf8'});const m=(r.stderr||'').match(/Duration: (\d+):(\d+):([\d.]+)/);if(!m)throw Error('Could not measure audio duration');return +m[1]*3600 + +m[2]*60 + +m[3];}
function assTime(s){const cs=Math.round(s*100);return Math.floor(cs/360000)+':'+String(Math.floor(cs/6000)%60).padStart(2,'0')+':'+String(Math.floor(cs/100)%60).padStart(2,'0')+'.'+String(cs%100).padStart(2,'0');}
(async()=>{
 const config={};const env=fs.readFileSync(path.join(root,'.env'),'utf8');for(const line of env.split(/\r?\n/)){const m=line.replace(/^\uFEFF/,'').match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);if(m)config[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}
 if(!config.ELEVENLABS_API_KEY)throw Error('ELEVENLABS_API_KEY is empty in project .env. Save the key there, then run again.');
 if(!/^[A-Za-z0-9]+$/.test(config.ELEVENLABS_VOICE_ID||''))throw Error('Missing or invalid ELEVENLABS_VOICE_ID in .env');
 const source=path.join(dir,'cloudike-silent-1080p.mp4');if(!fs.existsSync(source))throw Error('Silent source video missing');
 run(['-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','0.5','lead.wav']);
 let ass='[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Malgun Gothic,42,&H00FFFFFF,&H00FFFFFF,&H00151515,&H80000000,0,0,0,0,100,100,0,0,3,10,0,2,100,100,65,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';
 for(let i=0;i<scenes.length;i++){
 const s=scenes[i],raw=path.join(dir,'voice-'+i+'.mp3');
 const signature=require('crypto').createHash('sha256').update(JSON.stringify({text:s.text,voice:config.ELEVENLABS_VOICE_ID,model:'eleven_multilingual_v2'})).digest('hex');
 const signatureFile=raw+'.sha256';
 if(!fs.existsSync(raw)||!fs.existsSync(signatureFile)||fs.readFileSync(signatureFile,'utf8')!==signature){
 console.log('Generating Korean narration '+(i+1)+'/'+scenes.length+'...');
 let response;try{response=await fetch('https://api.elevenlabs.io/v1/text-to-speech/'+config.ELEVENLABS_VOICE_ID+'?output_format=mp3_44100_128',{method:'POST',headers:{'xi-api-key':config.ELEVENLABS_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({text:s.text,model_id:'eleven_multilingual_v2',language_code:'ko',voice_settings:{stability:.5,similarity_boost:.75}}),signal:AbortSignal.timeout(90000)});}catch{throw Error('ElevenLabs connection failed; run this script in your normal PowerShell.');}
 if(!response.ok)throw Error('ElevenLabs HTTP '+response.status+' (response body omitted to protect secrets)');
 fs.writeFileSync(raw,Buffer.from(await response.arrayBuffer()));fs.writeFileSync(signatureFile,signature);
 }
 const d=duration(raw),slot=s.end-s.start,rate=Math.max(.85,d/(slot-.2));
 if(rate>1.5)throw Error('Narration is too long for scene '+(i+1));
 run(['-i',raw,'-af','atempo='+rate.toFixed(6)+',apad','-t',String(slot),'-ar','48000','-ac','2','part-'+i+'.wav']);
 ass+='Dialogue: 0,'+assTime(s.start)+','+assTime(s.end)+',Default,,0,0,0,,'+s.text+'\n';
 }
 fs.writeFileSync(path.join(dir,'captions.ass'),ass,'utf8');
 fs.writeFileSync(path.join(dir,'narration-script.json'),JSON.stringify({source:'homepage-text.txt',scenes},null,2));
 fs.writeFileSync(path.join(dir,'audio-list.txt'),["file 'lead.wav'",...scenes.map((_,i)=>"file 'part-"+i+".wav'"),"file 'lead.wav'"].join('\n'));
 run(['-f','concat','-safe','0','-i','audio-list.txt','-c:a','pcm_s16le','narration.wav']);
 console.log('Encoding Korean narration and subtitles...');
 run(['-i',source,'-i','narration.wav','-vf',"ass=captions.ass",'-map','0:v:0','-map','1:a:0','-c:v','libx264','-crf','19','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-t','20','-movflags','+faststart','cloudike-final-1080p.mp4']);
 const target=path.join(dir,'cloudike-final-1080p.mp4');
 const check=spawnSync(ffmpeg,['-hide_banner','-i',target,'-f','null','-'],{encoding:'utf8'});
 fs.writeFileSync(path.join(dir,'final-validation.txt'),check.stderr||'');
 if(check.status!==0||!check.stderr.includes('1920x1080')||!check.stderr.includes('00:00:20.00')||!check.stderr.includes('Audio: aac'))throw Error('Final verification failed');
 console.log('DONE: '+target);console.log('Verified: 1920x1080 / 20 seconds / AAC narration / decode passed.');
 console.log('Please play the MP4 to review Korean pronunciation and subtitle timing.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
