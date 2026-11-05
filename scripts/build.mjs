import {refreshStockQuotes} from './refresh-stock-quotes.mjs';
import {build} from 'esbuild';
import {mkdir,writeFile,readFile,readdir,unlink,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateCloudConfig} from '../dist/cloud-config.mjs';
await mkdir('dist/vendor',{recursive:true});
await build({stdin:{contents:"export {createClient} from '@supabase/supabase-js';",resolveDir:process.cwd()},outfile:'dist/vendor/supabase.mjs',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'eof'});
await build({stdin:{contents:"import jsQR from 'jsqr'; export default jsQR;",resolveDir:process.cwd()},outfile:'dist/vendor/jsqr.mjs',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'eof'});
const url=(process.env.SUPABASE_URL||'').trim(),key=(process.env.SUPABASE_PUBLISHABLE_KEY||'').trim();
if(Boolean(url)!==Boolean(key))throw Error('SUPABASE_URL 與 SUPABASE_PUBLISHABLE_KEY 必須一起設定');
const config=url?validateCloudConfig({url,publishableKey:key,provider:process.env.SUPABASE_AUTH_PROVIDER||'github'}):null;
await writeFile('dist/cloud-config.json',JSON.stringify(config,null,2)+'\n');
await writeFile('dist/.nojekyll','');
await refreshStockQuotes();
// Give the complete browser entry a content-based URL so a returning phone does
// not mix a new UI with old cached accounting/schema modules.
await build({entryPoints:['dist/app.mjs'],outfile:'dist/vendor/app.next.mjs',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'eof'});
const app=await readFile('dist/vendor/app.next.mjs'),css=await readFile('dist/style.css');
const hash=value=>createHash('sha256').update(value).digest('hex').slice(0,12);
const appPath='./vendor/app.'+hash(app)+'.mjs',stylePath='./style.css?v='+hash(css);
for(const name of await readdir('dist/vendor'))if(/^app\.[a-f0-9]+\.mjs$/.test(name))await unlink('dist/vendor/'+name);
await rename('dist/vendor/app.next.mjs','dist/'+appPath.slice(2));
const html=(await readFile('dist/index.html','utf8')).replace(/<script type="module" src="[^"]+"><\/script>/,'<script type="module" src="'+appPath+'"></script>').replace(/href="\.\/style\.css[^\"]*"/,'href="'+stylePath+'"');
await writeFile('dist/index.html',html);
const worker=await readFile('dist/sw.js','utf8');
const assets=JSON.parse('['+worker.match(/const ASSETS=\[([^\]]+)\]/)[1].replaceAll("'",'"')+']').filter(p=>!/^\.\/vendor\/app\./.test(p)&&!p.startsWith('./style.css?'));
assets.push(appPath,stylePath);
await writeFile('dist/sw.js',worker.replace(/const CACHE='[^']+'/,"const CACHE='yoyu-ledger-"+hash(app)+hash(css)+hash(JSON.stringify(config))+hash(await readFile('dist/stock-quotes.json'))+"'").replace(/const ASSETS=\[[^\]]+\]/,'const ASSETS='+JSON.stringify(assets)));
console.log(config?'網站已建立，已配置 Supabase 公開連線資訊。':'網站已建立：本機模式；尚未配置 Supabase。');
