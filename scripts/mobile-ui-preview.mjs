// Visual fixture only: actual HomeView, synthetic data, no runtime/broker/clipboard APIs.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from '../apps/desktop/node_modules/vite/dist/node/index.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const mobile=path.join(root,'apps/mobile/node_modules');
const server=await createServer({root:path.join(root,'tests/ui'),configFile:false,esbuild:{jsx:'automatic'},resolve:{alias:[
 {find:/^react-native$/,replacement:path.join(mobile,'react-native-web/dist/index.js')},
 {find:/^react$/,replacement:path.join(mobile,'react/index.js')},
 {find:/^react\/jsx-runtime$/,replacement:path.join(mobile,'react/jsx-runtime.js')},
 {find:/^react\/jsx-dev-runtime$/,replacement:path.join(mobile,'react/jsx-dev-runtime.js')},
 {find:/^react-dom\/client$/,replacement:path.join(mobile,'react-dom/client.js')},
 {find:/^react-dom$/,replacement:path.join(mobile,'react-dom/index.js')},
 {find:'@expo/vector-icons',replacement:path.join(root,'tests/ui/icons.tsx')},
 {find:'lucide-react',replacement:path.join(root,'apps/desktop/node_modules/lucide-react/dist/esm/lucide-react.js')}
],dedupe:['react','react-dom']},server:{host:'127.0.0.1',port:18766,strictPort:true,fs:{allow:[root]}}});
await server.listen();server.printUrls();
const stop=async()=>{await server.close();process.exit(0);};process.on('SIGINT',stop);process.on('SIGTERM',stop);
