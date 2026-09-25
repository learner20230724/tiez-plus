import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from '../apps/desktop/node_modules/vite/dist/node/index.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const deps=path.join(root,'apps/desktop/node_modules');
const server=await createServer({root:path.join(root,'tests/ui'),configFile:false,cacheDir:path.join(root,'.runtime/vite-desktop-preview'),optimizeDeps:{entries:[path.join(root,'tests/ui/desktop.html')]},esbuild:{jsx:'automatic'},resolve:{alias:[
 {find:/^@tauri-apps\/api\/(core|window|event)$/,replacement:path.join(root,'tests/ui/desktop-tauri-mock.ts')},
 ...['react','react/jsx-runtime','react/jsx-dev-runtime','react-dom/client','react-dom'].map(name=>({find:new RegExp('^'+name+'$'),replacement:path.join(deps,name+'.js').replace(/react\.js$/,'react/index.js').replace(/react-dom\.js$/,'react-dom/index.js')})),
],dedupe:['react','react-dom']},server:{host:'127.0.0.1',port:18767,strictPort:true,fs:{allow:[root]}}});
await server.listen();server.printUrls();
process.on('SIGINT',async()=>{await server.close();process.exit(0);});
